import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sql } from "drizzle-orm";

import { db } from "../../server/db";
import { dispatchVerifiedStripeEvent } from "../../server/webhookHandlers";
import { claimWebhookEvent, markWebhookEventCompleted } from "../../server/webhook-dedupe";

test("a signature-verified Stripe event is not verified a second time", async () => {
  const event = {
    id: "evt_verified",
    type: "visionclaw.webhook_probe",
    livemode: true,
    data: { object: {} },
  };
  let processedEvent: unknown;
  let rawWebhookCalls = 0;
  const sync = {
    async processEvent(value: unknown) {
      processedEvent = value;
    },
    async processWebhook() {
      rawWebhookCalls += 1;
      throw new Error("must not re-verify an already verified event");
    },
  };

  await dispatchVerifiedStripeEvent(sync, event);

  assert.equal(processedEvent, event);
  assert.equal(rawWebhookCalls, 0);
});

test("startup never creates a Stripe endpoint without atomically retaining its signing secret", () => {
  const source = readFileSync("server/index.ts", "utf8");

  assert.match(source, /webhookEndpoints\.list/);
  assert.doesNotMatch(source, /webhookEndpoints\.create/);
  assert.doesNotMatch(source, /findOrCreateManagedWebhook/);
});

test("simultaneous deliveries cannot both acquire the same webhook event", async () => {
  const provider = "stripe-concurrency-test";
  const eventId = `evt_${randomUUID()}`;
  try {
    const claims = await Promise.all([
      claimWebhookEvent(provider, eventId),
      claimWebhookEvent(provider, eventId),
    ]);

    assert.deepEqual(
      claims.map((claim) => claim.status).sort(),
      ["fresh", "in_flight"],
    );
  } finally {
    await db.execute(sql`
      DELETE FROM webhook_events
      WHERE provider = ${provider} AND event_id = ${eventId}
    `);
  }
});

test("an expired webhook worker cannot complete a claim after another worker reacquires it", async () => {
  const provider = "stripe-fencing-test";
  const eventId = `evt_${randomUUID()}`;
  try {
    const first = await claimWebhookEvent(provider, eventId);
    assert.equal(first.status, "fresh");
    await db.execute(sql`
      UPDATE webhook_events
      SET lease_expires_at = now() - interval '1 second'
      WHERE provider = ${provider} AND event_id = ${eventId}
    `);

    const gracePeriodAttempt = await claimWebhookEvent(provider, eventId);
    assert.equal(gracePeriodAttempt.status, "in_flight");
    await db.execute(sql`
      UPDATE webhook_events
      SET lease_expires_at = now() - interval '3 minutes'
      WHERE provider = ${provider} AND event_id = ${eventId}
    `);

    const second = await claimWebhookEvent(provider, eventId);
    assert.equal(second.status, "retry");
    await assert.rejects(
      markWebhookEventCompleted(provider, eventId, first.claimToken),
      /ownership was lost/,
    );
    await markWebhookEventCompleted(provider, eventId, second.claimToken);
  } finally {
    await db.execute(sql`
      DELETE FROM webhook_events
      WHERE provider = ${provider} AND event_id = ${eventId}
    `);
  }
});
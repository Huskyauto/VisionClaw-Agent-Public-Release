// R74.13u — Durable webhook event dedupe (Stripe + Coinbase).
//
// Replaces the per-process in-memory Set used previously, which lost dedupe
// state on every restart and offered zero protection across multiple
// processes. Backing store is a tiny `webhook_events` table with a composite
// primary key on (provider, event_id). The table is created lazily on first
// call (idempotent CREATE TABLE IF NOT EXISTS) so this module is safe to
// import from any code path without a migration step.
//
// CLAIM-then-COMMIT pattern (R74.13u-2 follow-up):
//   The naive "mark seen at receive time" pattern silently drops events on
//   transient processing failure: receive → mark seen → side effect throws
//   → Stripe retries → dedupe says "duplicate" → event lost. We instead
//   record an unfinished claim on receive (`completed_at IS NULL`) and only
//   set `completed_at` after side effects succeed. Retries that arrive
//   while a prior claim was never committed are allowed through and re-run
//   the side effects (the side-effect handlers themselves are idempotent
//   on tenant/customer state).
//
// API:
//   claimWebhookEvent(provider, eventId): one of
//     - "fresh"          — newly inserted, caller should process
//     - "retry"          — an unfinished claim's lease expired and this caller
//                          atomically reacquired it; caller should re-process.
//     - "in_flight"      — another caller currently owns the claim lease;
//                          return non-2xx so the provider retries later.
//     - "completed"      — already fully processed; caller should ACK with
//                          200 and skip side effects.
//   markWebhookEventCompleted(provider, eventId): stamps completed_at.
//   cleanupOldWebhookEvents(maxAgeDays = 14): best-effort GC of completed
//     rows older than the threshold (in-flight rows are preserved).

import { db } from "./db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type ClaimStatus = "fresh" | "retry" | "in_flight" | "completed";
export interface ClaimResult {
  status: ClaimStatus;
  claimToken: string | null;
}

const CLAIM_LEASE_SECONDS = 5 * 60;
const CLAIM_TAKEOVER_GRACE_SECONDS = 2 * 60;
const CLAIM_HEARTBEAT_MS = 10_000;

let tableEnsuredPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (tableEnsuredPromise) return tableEnsuredPromise;
  tableEnsuredPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_events (
        provider text NOT NULL,
        event_id text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        PRIMARY KEY (provider, event_id)
      )
    `);
    // Older deployments may have the table from the first iteration of this
    // module without the completed_at column; add it if missing.
    await db.execute(sql`
      ALTER TABLE webhook_events
        ADD COLUMN IF NOT EXISTS completed_at timestamptz
    `);
    await db.execute(sql`
      ALTER TABLE webhook_events
        ADD COLUMN IF NOT EXISTS claim_token text,
        ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
        ON webhook_events (received_at)
    `);
  })().catch((err) => {
    tableEnsuredPromise = null;
    throw err;
  });
  return tableEnsuredPromise;
}

export async function claimWebhookEvent(
  provider: string,
  eventId: string,
): Promise<ClaimResult> {
  if (!eventId) return { status: "fresh", claimToken: null };
  await ensureTable();
  const claimToken = randomUUID();

  // Single-statement INSERT…ON CONFLICT…RETURNING is race-safe across
  // processes: Postgres serializes the conflict, exactly one txn wins the
  // INSERT, the other sees DO NOTHING. We then look up the existing row's
  // completed_at to decide retry vs completed.
  const insertResult: any = await db.execute(sql`
    INSERT INTO webhook_events (provider, event_id, claim_token, lease_expires_at)
    VALUES (
      ${provider},
      ${eventId},
      ${claimToken},
      now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
    )
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING event_id
  `);
  const insertedRows = (insertResult as any).rows ?? insertResult ?? [];
  if (Array.isArray(insertedRows) && insertedRows.length > 0) {
    return { status: "fresh", claimToken };
  }

  // Row already existed. Atomically reacquire only an expired unfinished
  // claim. This prevents two simultaneous provider retries from both running
  // payment side effects while still allowing recovery after a crashed worker.
  const retryResult: any = await db.execute(sql`
    UPDATE webhook_events
    SET received_at = now(),
        claim_token = ${claimToken},
        lease_expires_at = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
    WHERE provider = ${provider}
      AND event_id = ${eventId}
      AND completed_at IS NULL
      AND (
        lease_expires_at IS NULL
        OR lease_expires_at < now() - make_interval(secs => ${CLAIM_TAKEOVER_GRACE_SECONDS})
      )
    RETURNING event_id
  `);
  const retryRows = (retryResult as any).rows ?? retryResult ?? [];
  if (Array.isArray(retryRows) && retryRows.length > 0) {
    return { status: "retry", claimToken };
  }

  // No lease was acquired — inspect completion state.
  const lookupResult: any = await db.execute(sql`
    SELECT completed_at
    FROM webhook_events
    WHERE provider = ${provider} AND event_id = ${eventId}
    LIMIT 1
  `);
  const lookupRows = (lookupResult as any).rows ?? lookupResult ?? [];
  const row = Array.isArray(lookupRows) ? lookupRows[0] : null;
  if (row && (row as any).completed_at) {
    return { status: "completed", claimToken: null };
  }
  return { status: "in_flight", claimToken: null };
}

export async function markWebhookEventCompleted(
  provider: string,
  eventId: string,
  claimToken: string | null,
): Promise<void> {
  if (!eventId) return;
  if (!claimToken) throw new Error("webhook completion requires an active claim token");
  await ensureTable();
  const result: any = await db.execute(sql`
    UPDATE webhook_events
    SET completed_at = now(), lease_expires_at = NULL
    WHERE provider = ${provider}
      AND event_id = ${eventId}
      AND claim_token = ${claimToken}
      AND completed_at IS NULL
    RETURNING event_id
  `);
  const rows = result?.rows ?? result ?? [];
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("webhook claim ownership was lost before completion");
  }
}

export async function runWithWebhookClaimLease<T>(
  provider: string,
  eventId: string,
  claimToken: string | null,
  work: (assertOwnership: () => Promise<void>) => Promise<T>,
): Promise<T> {
  if (!eventId || !claimToken) return work(async () => {});
  let ownershipLost = false;
  let renewalInFlight = false;
  const renew = async (): Promise<void> => {
    if (ownershipLost) throw new Error("webhook claim ownership was lost");
    const result: any = await db.execute(sql`
      UPDATE webhook_events
      SET lease_expires_at = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
      WHERE provider = ${provider}
        AND event_id = ${eventId}
        AND claim_token = ${claimToken}
        AND completed_at IS NULL
      RETURNING event_id
    `);
    const rows = result?.rows ?? result ?? [];
    if (!Array.isArray(rows) || rows.length !== 1) {
      ownershipLost = true;
      throw new Error("webhook claim ownership was lost");
    }
  };
  const timer = setInterval(() => {
    if (renewalInFlight || ownershipLost) return;
    renewalInFlight = true;
    renew().catch((error: unknown) => {
      // A transient DB error does not prove ownership was lost. Keep retrying
      // while the lease plus takeover grace remains active. A zero-row update
      // sets ownershipLost inside renew() and permanently fences this worker.
      if (ownershipLost) {
        console.error("[webhook-dedupe] claim heartbeat lost ownership");
      } else {
        console.warn(`[webhook-dedupe] claim heartbeat failed; retrying: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }).finally(() => {
      renewalInFlight = false;
    });
  }, CLAIM_HEARTBEAT_MS);
  timer.unref();
  try {
    const result = await work(renew);
    await renew();
    return result;
  } finally {
    clearInterval(timer);
  }
}

export async function cleanupOldWebhookEvents(maxAgeDays = 14): Promise<number> {
  await ensureTable();
  // Only delete rows that were committed — never garbage-collect in-flight
  // claims, since deleting them would re-open the lost-event window.
  const result: any = await db.execute(sql`
    DELETE FROM webhook_events
    WHERE completed_at IS NOT NULL
      AND received_at < now() - make_interval(days => ${maxAgeDays})
  `);
  return (result as any).rowCount ?? 0;
}

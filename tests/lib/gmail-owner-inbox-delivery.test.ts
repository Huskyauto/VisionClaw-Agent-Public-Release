import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertOwnerGmailReportDestination,
  hasDirectGmailSendAndReadScopes,
  isGmailInboxDeliveryConfirmed,
  resolveExistingOrSentGmailMessageId,
  verifyGmailInboxDelivery,
} from "../../server/google-workspace";

test("owner report delivery is confirmed only when the exact message is in the intended inbox", () => {
  assert.equal(
    isGmailInboxDeliveryConfirmed(
      {
        labelIds: ["SENT", "INBOX"],
        payload: {
          headers: [{ name: "To", value: "Bob <huskyauto@gmail.com>" }],
        },
      },
      "huskyauto@gmail.com",
    ),
    true,
  );
});

test("owner report verification polls the original message without re-sending it", async () => {
  let fetches = 0;
  const result = await verifyGmailInboxDelivery(
    async () => {
      fetches++;
      return fetches === 1
        ? { labelIds: ["SENT"], payload: { headers: [{ name: "To", value: "huskyauto@gmail.com" }] } }
        : { labelIds: ["SENT", "INBOX"], payload: { headers: [{ name: "To", value: "huskyauto@gmail.com" }] } };
    },
    "message-123",
    "huskyauto@gmail.com",
    { retryDelaysMs: [0, 0], sleep: async () => {} },
  );

  assert.deepEqual(result, { verified: true, attempts: 2 });
  assert.equal(fetches, 2);
});

test("direct owner-report Gmail transport rejects non-admin tenants and non-owner recipients", () => {
  assert.throws(
    () => assertOwnerGmailReportDestination(2, "owner@example.com", "owner@example.com"),
    /admin tenant/i,
  );
  assert.throws(
    () => assertOwnerGmailReportDestination(1, "other@example.com", "owner@example.com"),
    /configured owner/i,
  );
  assert.equal(
    assertOwnerGmailReportDestination(1, "OWNER@example.com", "owner@example.com"),
    "owner@example.com",
  );
});

test("Gmail owner-report consent asks only for readonly inbox verification and sending", () => {
  const oauthRoute = fs.readFileSync("server/routes/gmail-direct.ts", "utf8");
  const gmailWorkspace = fs.readFileSync("server/google-workspace.ts", "utf8");
  assert.match(oauthRoute, /gmail\.readonly/);
  assert.match(oauthRoute, /gmail\.send/);
  assert.doesNotMatch(oauthRoute, /gmail\.modify/);
  assert.doesNotMatch(gmailWorkspace, /gmail\.modify/);
});

test("Gmail owner-report scope validation rejects broader historical Gmail grants", () => {
  assert.equal(hasDirectGmailSendAndReadScopes("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"), true);
  assert.equal(hasDirectGmailSendAndReadScopes("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify"), false);
  assert.equal(hasDirectGmailSendAndReadScopes("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://mail.google.com/"), false);
});

test("weekly owner-report script never overrides an unverified delivery with a success exit", () => {
  const weeklyScript = fs.readFileSync("scripts/ideabrowser-weekly-scenario.ts", "utf8");
  assert.match(weeklyScript, /process\.exit\(process\.exitCode\s*\?\?\s*0\)/);
});

test("weekly report retries verify the already-sent message instead of sending a duplicate", async () => {
  let sends = 0;
  const messageId = await resolveExistingOrSentGmailMessageId({
    existingMessageId: "gmail-message-1",
    findByStableMessageKey: async () => {
      throw new Error("lookup should not run when delivery state already has a message ID");
    },
    send: async () => {
      sends++;
      return "new-message";
    },
  });

  assert.equal(messageId, "gmail-message-1");
  assert.equal(sends, 0);
});

test("stale weekly send claims expire so a retry can recover the original Gmail message", () => {
  const weeklyScript = fs.readFileSync("scripts/ideabrowser-weekly-scenario.ts", "utf8");
  assert.match(weeklyScript, /completed_at < NOW\(\) - INTERVAL '5 minutes'/);
  assert.match(weeklyScript, /stableMessageKey: `ideabrowser-weekly-scenario-\$\{today\}`/);
});
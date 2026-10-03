import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertOwnerGmailConnectorProfile,
  assertOwnerGmailReportDestination,
  googleApiFetch,
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

test("owner report refuses egress when the Gmail connector is bound to another account", () => {
  assert.equal(
    assertOwnerGmailConnectorProfile({ emailAddress: "OWNER@example.com" }, "owner@example.com"),
    "owner@example.com",
  );
  assert.throws(
    () => assertOwnerGmailConnectorProfile({ emailAddress: "other@example.com" }, "owner@example.com"),
    /not bound to the configured owner inbox/i,
  );
});

test("Google API fetch retries one explicit 401 with a fresh connector token", async () => {
  const calls: string[] = [];
  const result = await googleApiFetch(
    "stale-token",
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    undefined,
    { tenantId: 1, service: "gmail", connectorName: "google-mail" },
    {
      getFreshToken: async () => "fresh-token",
      fetcher: async (_url, init) => {
        const authorization = String((init?.headers as Record<string, string>)?.Authorization || "");
        calls.push(authorization);
        return new Response(
          authorization === "Bearer stale-token"
            ? JSON.stringify({ error: "invalid_token" })
            : JSON.stringify({ emailAddress: "owner@example.com" }),
          { status: authorization === "Bearer stale-token" ? 401 : 200 },
        );
      },
    },
  );
  assert.deepEqual(calls, ["Bearer stale-token", "Bearer fresh-token"]);
  assert.equal(result.emailAddress, "owner@example.com");
});

test("Google API fetch does not retry an uncertain network failure", async () => {
  let attempts = 0;
  await assert.rejects(
    () => googleApiFetch(
      "current-token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { method: "POST", body: "{}" },
      { tenantId: 1, service: "gmail", connectorName: "google-mail" },
      {
        getFreshToken: async () => "unused-token",
        fetcher: async () => {
          attempts++;
          throw new Error("socket closed after request write");
        },
      },
    ),
    /socket closed after request write/,
  );
  assert.equal(attempts, 1, "uncertain POST must reconcile, never auto-resend");
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

test("owner report delivery uses the reauthorized Gmail connector, not the legacy direct token", () => {
  const source = fs.readFileSync("server/google-workspace.ts", "utf8");
  const ownerSend = source.slice(
    source.indexOf("export async function gmailSendAndVerifyInbox"),
    source.indexOf("export async function gmailFindAndVerifyInbox"),
  );
  const ownerReconcile = source.slice(
    source.indexOf("export async function gmailFindAndVerifyInbox"),
    source.indexOf("export async function gmailModifyLabels"),
  );
  assert.match(ownerSend, /getGmailConnectorToken\(tenantId\)/);
  assert.match(ownerReconcile, /getGmailConnectorToken\(tenantId\)/);
  assert.doesNotMatch(ownerSend, /loadGmailDirectRefreshToken|getGmailDirectAccessToken/);
  assert.doesNotMatch(ownerReconcile, /loadGmailDirectRefreshToken|getGmailDirectAccessToken/);
});

test("weekly owner-report script throws when the pipeline cannot verify delivery", () => {
  const weeklyScript = fs.readFileSync("scripts/ideabrowser-weekly-scenario.ts", "utf8");
  assert.match(weeklyScript, /if\s*\(\s*deliveryFailure\s*\)\s*\{\s*throw deliveryFailure/);
  assert.match(weeklyScript, /if\s*\(\s*dr\.success\s*&&\s*dr\.emailSent\s*\)/);
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

test("delivery pipeline persists the Gmail message ID before inbox verification and can reconcile without resending", () => {
  const pipeline = fs.readFileSync("server/delivery-pipeline.ts", "utf8");
  assert.match(pipeline, /onMessageSent:\s*async\s*\(messageId\)/);
  assert.match(pipeline, /existingMessageId:\s*log\.emailMessageId/);
  assert.match(pipeline, /reconcileOwnerEmailVerified\s*\(\s*\{/);
  assert.match(pipeline, /Owner email remains unverified; no resend was attempted/);
});
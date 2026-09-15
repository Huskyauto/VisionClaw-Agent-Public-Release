/**
 * Task #161 — owner delivery email transport (Gmail-direct, verified receipt).
 * Query-free: injectable deps, no network, no DB pool.
 */
import { test } from "node:test";
import assert from "node:assert";
import {
  reconcileOwnerEmailVerified,
  sendOwnerEmailVerified,
  isOwnerRecipient,
  shouldAttemptDeliveryEmail,
} from "../../server/lib/owner-delivery-email";

function withOwnerEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OWNER_EMAIL;
  process.env.OWNER_EMAIL = "owner@example.com";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = prev;
  });
}

test("owner send succeeds only with an INBOX-labeled Gmail receipt (mocked)", () => withOwnerEnv(async () => {
  const previousAgentMailKey = process.env.AGENTMAIL_API_KEY;
  delete process.env.AGENTMAIL_API_KEY;
  const calls: any[] = [];
  const gmailSendAndVerifyInbox = async (...args: any[]) => {
    calls.push(args);
    return { messageId: "msg_abc", inboxVerified: true, verificationAttempts: 1 };
  };
  try {
    assert.strictEqual(shouldAttemptDeliveryEmail({
      requested: true,
      customerEmail: "owner@example.com",
      ownerRecipient: true,
      agentMailConfigured: false,
    }), true, "owner path must run without AgentMail");
    const r = await sendOwnerEmailVerified(
      { tenantId: 1, to: "owner@example.com", subject: "Weekly report", text: "All good.", html: "<p>All good.</p>" },
      { gmailSendAndVerifyInbox },
    );
    assert.strictEqual(r.messageId, "msg_abc");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][1], "owner@example.com");
    assert.deepEqual(calls[0][4], {
      stableMessageKey: undefined,
      existingMessageId: undefined,
      onMessageSent: undefined,
    });
  } finally {
    if (previousAgentMailKey === undefined) delete process.env.AGENTMAIL_API_KEY;
    else process.env.AGENTMAIL_API_KEY = previousAgentMailKey;
  }
}));

test("owner reconciliation verifies an existing message ID without requesting a new send", () => withOwnerEnv(async () => {
  let receivedOptions: any;
  const gmailSendAndVerifyInbox = async (...args: any[]) => {
    receivedOptions = args[4];
    return { messageId: "existing-message", inboxVerified: true, verificationAttempts: 1 };
  };
  const result = await sendOwnerEmailVerified(
    {
      tenantId: 1,
      to: "owner@example.com",
      subject: "Weekly report",
      text: "body",
      existingMessageId: "existing-message",
      stableMessageKey: "weekly-2026-08-28",
    },
    { gmailSendAndVerifyInbox },
  );
  assert.strictEqual(result.messageId, "existing-message");
  assert.strictEqual(receivedOptions.existingMessageId, "existing-message");
  assert.strictEqual(receivedOptions.stableMessageKey, "weekly-2026-08-28");
}));

test("lookup-only reconciliation recovers by stable key and has no send callback", () => withOwnerEnv(async () => {
  let receivedOptions: any;
  const result = await reconcileOwnerEmailVerified(
    {
      tenantId: 1,
      to: "owner@example.com",
      stableMessageKey: "delivery-weekly-2026-08-28",
    },
    {
      gmailFindAndVerifyInbox: async (_tenantId, _to, options) => {
        receivedOptions = options;
        return { messageId: "recovered-message", inboxVerified: true, verificationAttempts: 1 };
      },
    },
  );
  assert.strictEqual(result.messageId, "recovered-message");
  assert.deepEqual(receivedOptions, {
    existingMessageId: undefined,
    stableMessageKey: "delivery-weekly-2026-08-28",
  });
  assert.strictEqual("send" in receivedOptions, false);
}));

test("lookup-only reconciliation fails loudly when no prior Gmail message exists", () => withOwnerEnv(async () => {
  await assert.rejects(
    () => reconcileOwnerEmailVerified(
      { tenantId: 1, to: "owner@example.com", stableMessageKey: "missing-message" },
      {
        gmailFindAndVerifyInbox: async () => ({
          messageId: null,
          inboxVerified: false,
          verificationAttempts: 0,
        }),
      },
    ),
    /no resend was attempted/,
  );
}));

test("non-owner delivery still requires AgentMail configuration", () => {
  assert.strictEqual(shouldAttemptDeliveryEmail({
    requested: true,
    customerEmail: "customer@example.com",
    ownerRecipient: false,
    agentMailConfigured: false,
  }), false);
  assert.strictEqual(shouldAttemptDeliveryEmail({
    requested: true,
    customerEmail: "customer@example.com",
    ownerRecipient: false,
    agentMailConfigured: true,
  }), true);
});

test("owner send THROWS when Gmail cannot verify the message in INBOX — no false success", () => withOwnerEnv(async () => {
  const gmailSendAndVerifyInbox = async () => ({
    messageId: "msg_dropped",
    inboxVerified: false,
    verificationAttempts: 3,
  });
  await assert.rejects(
    () => sendOwnerEmailVerified(
      { tenantId: 1, to: "owner@example.com", subject: "Weekly report", text: "body" },
      { gmailSendAndVerifyInbox },
    ),
    /INBOX verification failed/,
  );
}));

test("owner send THROWS when Gmail transport fails — error propagates, never swallowed", () => withOwnerEnv(async () => {
  const gmailSendAndVerifyInbox = async () => { throw new Error("ACCESS_TOKEN_SCOPE_INSUFFICIENT"); };
  await assert.rejects(
    () => sendOwnerEmailVerified(
      { tenantId: 1, to: "owner@example.com", subject: "s", text: "t" },
      { gmailSendAndVerifyInbox },
    ),
    /ACCESS_TOKEN_SCOPE_INSUFFICIENT/,
  );
}));

test("owner send refuses cross-tenant egress before preflight or transport", () => withOwnerEnv(async () => {
  let preflightCalled = false;
  let transportCalled = false;
  await assert.rejects(
    () => sendOwnerEmailVerified(
      { tenantId: 42, to: "owner@example.com", subject: "tenant report", text: "private tenant content" },
      {
        preflight: async () => {
          preflightCalled = true;
          return { subject: "tenant report", text: "private tenant content" };
        },
        gmailSendAndVerifyInbox: async () => {
          transportCalled = true;
          return { messageId: "x", inboxVerified: true, verificationAttempts: 1 };
        },
      },
    ),
    /not the admin tenant/,
  );
  assert.strictEqual(preflightCalled, false);
  assert.strictEqual(transportCalled, false);
}));

test("owner send runs the shared preflight — R95 block refuses the send before transport", () => withOwnerEnv(async () => {
  let transportCalled = false;
  const gmailSendAndVerifyInbox = async () => {
    transportCalled = true;
    return { messageId: "x", inboxVerified: true, verificationAttempts: 1 };
  };
  await assert.rejects(
    () => sendOwnerEmailVerified(
      { tenantId: 1, to: "owner@example.com", subject: "keys", text: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----" },
      { gmailSendAndVerifyInbox },
    ),
    /R95/,
  );
  assert.strictEqual(transportCalled, false, "transport must never run when a gate refuses");
}));

test("isOwnerRecipient matches configured owner addresses case-insensitively", () => withOwnerEnv(async () => {
  assert.strictEqual(await isOwnerRecipient("Owner@Example.com"), true);
  assert.strictEqual(await isOwnerRecipient("stranger@example.com"), false);
  assert.strictEqual(await isOwnerRecipient(""), false);
}));

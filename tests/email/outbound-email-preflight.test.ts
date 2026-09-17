/**
 * Task #161 — shared outbound-email preflight + owner-transport helpers.
 * Query-free: imports only server/lib/outbound-email-preflight.ts (no DB pool).
 */
import { test } from "node:test";
import assert from "node:assert";
import {
  encodeMimeSubject,
  isSuppressedSendResult,
  preflightOutboundEmail,
  collectRecipients,
} from "../../server/lib/outbound-email-preflight";

test("encodeMimeSubject: ASCII subjects pass through unchanged", () => {
  const s = "IdeaBrowser Weekly Scenario 2026-08-07 (task 161)";
  assert.strictEqual(encodeMimeSubject(s), s);
});

test("encodeMimeSubject: non-ASCII subjects are RFC 2047 encoded and round-trip", () => {
  const s = "IdeaBrowser Weekly Scenario 2026-08-07 — weekly report ✅";
  const enc = encodeMimeSubject(s);
  const m = enc.match(/^=\?UTF-8\?B\?(.+)\?=$/);
  assert.ok(m, `expected =?UTF-8?B?..?= form, got: ${enc}`);
  assert.strictEqual(Buffer.from(m![1], "base64").toString("utf-8"), s);
});

test("isSuppressedSendResult: digest sentinels are never success", () => {
  assert.strictEqual(isSuppressedSendResult({ queued: true }), true);
  assert.strictEqual(isSuppressedSendResult({ silenced: true }), true);
  assert.strictEqual(isSuppressedSendResult({ id: "msg_123" }), false);
  assert.strictEqual(isSuppressedSendResult(null), false);
  assert.strictEqual(isSuppressedSendResult(undefined), false);
});

test("collectRecipients handles CSV strings, arrays, and {email} objects", () => {
  assert.deepStrictEqual(collectRecipients("A@b.com, c@D.com; e@f.com"), ["a@b.com", "c@d.com", "e@f.com"]);
  assert.deepStrictEqual(collectRecipients([{ email: "X@y.com" }, { address: "z@w.com" }]), ["x@y.com", "z@w.com"]);
  assert.deepStrictEqual(collectRecipients(null), []);
});

test("preflight: refuses known-bounced recipients on any channel", async () => {
  await assert.rejects(
    () => preflightOutboundEmail({ to: "ok@example.com", bcc: "admin@visionclaw.ai", subject: "s", text: "t" }),
    /R98\.25 bouncing-recipient gate/,
  );
});

test("preflight: clean owner-bound content passes and returns payloads", async () => {
  const prev = process.env.OWNER_EMAIL;
  process.env.OWNER_EMAIL = "owner@example.com";
  try {
    const r = await preflightOutboundEmail({
      to: "owner@example.com",
      subject: "Weekly report — clean",
      text: "All sections rendered fine.",
      html: "<p>All sections rendered fine.</p>",
    });
    assert.strictEqual(r.subject, "Weekly report — clean");
    assert.strictEqual(r.text, "All sections rendered fine.");
    assert.ok(r.html?.includes("rendered fine"));
  } finally {
    if (prev === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = prev;
  }
});

test("preflight: R95 blocks a private key in the body", async () => {
  const prev = process.env.OWNER_EMAIL;
  process.env.OWNER_EMAIL = "owner@example.com";
  try {
    await assert.rejects(
      () => preflightOutboundEmail({
        to: "owner@example.com",
        subject: "keys",
        text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----",
      }),
      /R95/,
    );
  } finally {
    if (prev === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = prev;
  }
});

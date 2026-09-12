/**
 * BOT-PROTECTION FAIL-OPEN SUITE — locks the "nothing breaks until both
 * Cloudflare Turnstile keys are configured" guarantee on the public,
 * unauthenticated forms (lead capture, instant audit, archive-rescue).
 *
 * All cases are deterministic and query-free / network-free: with
 * TURNSTILE_SECRET_KEY unset, verifyTurnstileToken short-circuits BEFORE any
 * outbound fetch, so this never touches Cloudflare or the DB.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Guarantee the fail-open precondition regardless of ambient env.
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.VITE_TURNSTILE_SITE_KEY;

import {
  isHoneypotTripped,
  enforceBotProtection,
  warnIfPartialBotConfig,
  turnstileConfigured,
} from "../../server/lib/bot-protection";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function mockRes() {
  const r: any = { statusCode: 200, body: undefined, sent: false };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; r.sent = true; return r; };
  return r;
}

test("honeypot: empty / absent company_website is NOT a bot", () => {
  assert.equal(isHoneypotTripped({}), false);
  assert.equal(isHoneypotTripped({ company_website: "" }), false);
  assert.equal(isHoneypotTripped({ company_website: "   " }), false);
  assert.equal(isHoneypotTripped(undefined), false);
});

test("honeypot: any non-empty company_website IS a bot", () => {
  assert.equal(isHoneypotTripped({ company_website: "http://spam.example" }), true);
});

test("fail-open: no secret => Turnstile-required request still proceeds", async () => {
  const req: any = { body: { turnstileToken: undefined }, headers: {}, ip: "1.2.3.4" };
  const res = mockRes();
  const proceed = await enforceBotProtection(req, res, { requireTurnstile: true });
  assert.equal(proceed, true);
  assert.equal(res.sent, false);
  assert.equal(turnstileConfigured(), false);
});

test("honeypot trip => silent 200 fake-success, request does NOT proceed", async () => {
  const req: any = { body: { company_website: "bot-filled" }, headers: {}, ip: "1.2.3.4" };
  const res = mockRes();
  const proceed = await enforceBotProtection(req, res, { requireTurnstile: true });
  assert.equal(proceed, false);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("partial-config warning fires only when exactly one key is set", () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.VITE_TURNSTILE_SITE_KEY;
  assert.equal(warnIfPartialBotConfig(), null); // both unset = fine

  process.env.TURNSTILE_SECRET_KEY = "x";
  assert.match(warnIfPartialBotConfig() ?? "", /VITE_TURNSTILE_SITE_KEY/);

  process.env.VITE_TURNSTILE_SITE_KEY = "y";
  assert.equal(warnIfPartialBotConfig(), null); // both set = fine

  delete process.env.TURNSTILE_SECRET_KEY;
  assert.match(warnIfPartialBotConfig() ?? "", /TURNSTILE_SECRET_KEY/);

  // restore fail-open default for any later module use
  delete process.env.VITE_TURNSTILE_SITE_KEY;
});

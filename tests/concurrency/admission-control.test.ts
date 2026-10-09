// R102 — Admission control unit tests (node:test runner).
//
// Coverage:
//  1. tryReserveSlot('foreground_chat') always succeeds and bumps chat counter
//  2. tryReserveSlot('customer_background') respects background cap
//  3. tryReserveSlot('internal_maintenance') yields when chat is hot
//  4. checkTenantRate returns allowed=true under burst, false past it
//  5. checkTenantRate is per-tenant (A's exhaustion does not affect B)
//  6. admissionSnapshot reflects live counters
//  7. Released slots free up capacity again

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  tryReserveSlot,
  reserveChatSlot,
  admissionSnapshot,
  _resetPoolForTests,
} from "../../server/lib/concurrency-pool";
import { checkTenantRate, _resetTenantRate } from "../../server/lib/tenant-rate-limit";

beforeEach(() => {
  _resetPoolForTests();
  _resetTenantRate();
});

test("R102 foreground_chat reservation always succeeds", () => {
  const release = tryReserveSlot("foreground_chat", "chat-1");
  assert.ok(release);
  const snap = admissionSnapshot();
  assert.equal(snap.chat.active, 1);
  release!();
  assert.equal(admissionSnapshot().chat.active, 0);
});

test("R102 customer_background reservation respects background cap", () => {
  // BACKGROUND_MAX defaults to 12 — fill it.
  const releases: Array<() => void> = [];
  for (let i = 0; i < 12; i++) {
    const r = tryReserveSlot("customer_background", `bg-${i}`);
    assert.ok(r, `slot ${i} should succeed`);
    releases.push(r!);
  }
  // 13th must fail.
  const overflow = tryReserveSlot("customer_background", "bg-overflow");
  assert.equal(overflow, null);
  // Release one and retry.
  releases[0]();
  const recovered = tryReserveSlot("customer_background", "bg-recovered");
  assert.ok(recovered);
  recovered!();
  for (let i = 1; i < releases.length; i++) releases[i]();
});

test("R102 internal_maintenance yields when chat is hot", () => {
  // Saturate chat (CHAT_RESERVED_MAX defaults to 3 — fill all 3).
  const c1 = reserveChatSlot();
  const c2 = reserveChatSlot();
  const c3 = reserveChatSlot();
  // internal_maintenance MUST be denied at this point.
  const r = tryReserveSlot("internal_maintenance", "maint-1");
  assert.equal(r, null, "internal_maintenance must yield when chat is fully saturated");
  c1(); c2(); c3();
  // After release, internal_maintenance succeeds again.
  const r2 = tryReserveSlot("internal_maintenance", "maint-2");
  assert.ok(r2, "internal_maintenance should succeed after chat releases");
  r2!();
});

test("R102 checkTenantRate allowed within burst, denied past it", () => {
  const TENANT = 700_001;
  // Burst defaults to 20.
  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < 25; i++) {
    const d = checkTenantRate(TENANT, { ratePerMin: 60, burst: 20 });
    if (d.allowed) allowed++; else denied++;
  }
  assert.equal(allowed, 20);
  assert.equal(denied, 5);
  // The denial must include retryAfterSeconds >= 1.
  const finalDenial = checkTenantRate(TENANT, { ratePerMin: 60, burst: 20 });
  assert.equal(finalDenial.allowed, false);
  assert.ok(finalDenial.retryAfterSeconds >= 1, "retryAfterSeconds must be >= 1");
});

test("R102 checkTenantRate is per-tenant (A's exhaustion does not affect B)", () => {
  const A = 700_002;
  const B = 700_003;
  for (let i = 0; i < 20; i++) checkTenantRate(A, { ratePerMin: 60, burst: 20 });
  // A is now exhausted.
  assert.equal(checkTenantRate(A, { ratePerMin: 60, burst: 20 }).allowed, false);
  // B should still be allowed.
  assert.equal(checkTenantRate(B, { ratePerMin: 60, burst: 20 }).allowed, true);
});

test("R102 admissionSnapshot reflects live counters + yieldingInternal flag", () => {
  let snap = admissionSnapshot();
  assert.equal(snap.chat.active, 0);
  assert.equal(snap.yieldingInternal, false);
  const c1 = reserveChatSlot();
  const c2 = reserveChatSlot();
  const c3 = reserveChatSlot();
  snap = admissionSnapshot();
  assert.equal(snap.chat.active, 3);
  assert.equal(snap.yieldingInternal, true, "fully saturated chat should flip yieldingInternal");
  c1(); c2(); c3();
});

test("R102 customer_background respects chat-priority interlock", () => {
  // Saturate chat AND fill background to >75%.
  const cs = [reserveChatSlot(), reserveChatSlot(), reserveChatSlot()];
  const bgs: Array<() => void> = [];
  for (let i = 0; i < 9; i++) { // 9 / 12 = 75%
    const r = tryReserveSlot("customer_background", `bg-${i}`);
    if (r) bgs.push(r);
  }
  // Now the 10th customer_background should be denied (chat full + bg >75%).
  const tenth = tryReserveSlot("customer_background", "bg-10");
  assert.equal(tenth, null, "customer_background must defer when chat is saturated AND bg >75%");
  cs.forEach((r) => r());
  bgs.forEach((r) => r());
});

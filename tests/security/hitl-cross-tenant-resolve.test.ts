/**
 * R79.3f — Cross-tenant HITL resolution regression tests.
 *
 * Pins the tenant-isolation defect surfaced by the R79.3e architect review
 * in `server/tool-mutation.ts::resolveToolConfirmation`. Prior code only
 * enforced tenant equality when `pending.conversationId != null`, so a
 * confirmation created from a non-conversation context (background job,
 * scheduled tool call) skipped the check entirely — a guessable or leaked
 * confirmationId could then be resolved by any authenticated tenant.
 *
 * The fix unconditions the tenant check on conversationId. These tests
 * lock in:
 *   1. cross-tenant resolution is rejected with NO conversationId,
 *   2. cross-tenant resolution is rejected WITH conversationId,
 *   3. internal callers without a requesterTenantId still resolve (the
 *      auto-deny / disconnect path in routes.ts ~3533),
 *   4. unknown confirmationId returns false regardless of tenant.
 *
 * `requestToolConfirmation` arms a 120s setTimeout for HITL timeout. The
 * `after()` hook below mirrors the pattern in tests/safety/danger-rails
 * to force exit after tests complete instead of waiting for the timer.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { requestToolConfirmation, resolveToolConfirmation } from "../../server/tool-mutation.js";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// `requestToolConfirmation(tenantId>0, ...)` runs an async policy gate before
// arming HITL. Wait long enough for that promise chain to settle and the
// pending entry to land in the internal map.
const POLICY_ARM_WAIT_MS = 250;
const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

test("rejects cross-tenant resolution when pending has NO conversationId (regression)", async () => {
  const { confirmationId, promise } = requestToolConfirmation(
    "send_email",
    { to: "external-attacker-target@example.com", subject: "x", body: "x" },
    "high_risk",
    /* conversationId */ undefined,
    /* tenantId */ 1,
  );
  await tick(POLICY_ARM_WAIT_MS);

  // Attacker (tenant 2) tries to APPROVE tenant 1's pending confirmation.
  const stolen = resolveToolConfirmation(confirmationId, true, /* requesterTenantId */ 2);
  assert.equal(stolen, false, "cross-tenant resolution must be denied even without conversationId");

  // Owning tenant can still resolve it (DENY to clean up the pending promise).
  const owner = resolveToolConfirmation(confirmationId, false, /* requesterTenantId */ 1);
  assert.equal(owner, true, "owning tenant must still be able to resolve");

  const result = await promise;
  assert.equal(result, false);
});

test("rejects cross-tenant resolution when pending HAS a conversationId", async () => {
  const { confirmationId, promise } = requestToolConfirmation(
    "send_email",
    { to: "external-attacker-target@example.com", subject: "x", body: "x" },
    "high_risk",
    /* conversationId */ 42,
    /* tenantId */ 1,
  );
  await tick(POLICY_ARM_WAIT_MS);

  const stolen = resolveToolConfirmation(confirmationId, true, /* requesterTenantId */ 999);
  assert.equal(stolen, false, "cross-tenant resolution must be denied with conversationId set");

  const owner = resolveToolConfirmation(confirmationId, false, /* requesterTenantId */ 1);
  assert.equal(owner, true);

  const result = await promise;
  assert.equal(result, false);
});

test("internal/system caller without requesterTenantId can still resolve (auto-deny path)", async () => {
  // The disconnect/timeout auto-deny path in routes.ts (~line 3533) calls
  // resolveToolConfirmation(cid, false) WITHOUT a requesterTenantId — that
  // must still work. The tenant guard intentionally skips when the caller
  // is a trusted internal context.
  const { confirmationId, promise } = requestToolConfirmation(
    "send_email",
    { to: "external-attacker-target@example.com", subject: "x", body: "x" },
    "high_risk",
    /* conversationId */ 42,
    /* tenantId */ 1,
  );
  await tick(POLICY_ARM_WAIT_MS);

  const sysResolved = resolveToolConfirmation(confirmationId, false /* no requesterTenantId */);
  assert.equal(sysResolved, true, "internal callers without tenant context must still be able to auto-deny");

  const result = await promise;
  assert.equal(result, false);
});

test("returns false on unknown confirmationId regardless of tenant", () => {
  assert.equal(resolveToolConfirmation("nonexistent-cid-xyz", true, 1), false);
  assert.equal(resolveToolConfirmation("nonexistent-cid-xyz", false), false);
});

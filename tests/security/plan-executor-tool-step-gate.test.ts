// Finding 1A (Manus review) — GUARDED plan-step tool execution regression.
//
// server/plan-executor.ts `runToolStep` now executes real, side-effecting tools
// for steps that declare a string `tool`. The plans table has NO "invoker"
// column, so authorization is derived from the plan's persisted tenant_id by
// `resolvePlanStepPolicyPersona`:
//   - admin/owner tenant  → trusted "system" persona;
//   - any non-admin tenant → NO trusted name ⇒ the AHB destructive-tool policy
//                            fails CLOSED on trusted-only / approval-required /
//                            owner-only tools.
//
// This file pins that derivation — the privilege-escalation-critical seam 1A
// introduces — so a future edit cannot silently let a non-admin tenant's plan
// step resolve to the trusted "system" persona (admin-tenant RCE).
//
// The END-TO-END policy contract that consumes this persona name (system ⇒
// trusted-only ALLOWED; undefined ⇒ trusted-only BLOCKED; system + no approval
// ⇒ approval-required BLOCKED) is pinned separately in
// tests/security/plan-lobster-policy-gate.test.ts, which exercises
// enforceToolPolicy directly with these exact inputs. We deliberately keep THIS
// file dependency-free (no enforceToolPolicy / db import) so it exits cleanly
// and can run in CI (importing the policy graph keeps the event loop alive →
// node:test never drains → timeout, which is why the lobster contract file is
// not CI-wired).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlanStepPolicyPersona } from "../../server/safety/plan-step-authz";

const ADMIN = 1;

test("1A derive: admin/owner tenant resolves to the trusted 'system' persona", () => {
  assert.equal(resolvePlanStepPolicyPersona(ADMIN, ADMIN), "system");
});

test("1A derive: every non-admin tenant resolves to NO trusted persona (undefined)", () => {
  assert.equal(resolvePlanStepPolicyPersona(999999, ADMIN), undefined);
  assert.equal(resolvePlanStepPolicyPersona(2, ADMIN), undefined);
  assert.equal(resolvePlanStepPolicyPersona(0, ADMIN), undefined);
  assert.equal(resolvePlanStepPolicyPersona(-1, ADMIN), undefined);
});

test("1A derive: derivation tracks the configured admin tenant id (not a hardcoded 1)", () => {
  // If ADMIN_TENANT_ID were ever reconfigured, only THAT tenant earns "system".
  assert.equal(resolvePlanStepPolicyPersona(42, 42), "system");
  assert.equal(resolvePlanStepPolicyPersona(1, 42), undefined);
});

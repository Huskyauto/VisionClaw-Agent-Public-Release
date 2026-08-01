// R125+65 — architect Cluster A HIGH regression.
//
// server/task-planner.ts and server/lobster.ts execute each plan/workflow step
// via the RAW executeTool() dispatcher, which does NOT run the AHB
// destructive-tool policy (the trusted-persona / structured-args / approval /
// value-cap gates live in executeGuardedTool). The fix calls enforceToolPolicy
// directly before every step (fail-CLOSED, no HITL await — that would deadlock
// an autonomous plan), resolving the policy persona from the plan's TENANT:
//   - internal/autonomous (no invokerTenantId) and the admin/owner tenant
//     run as the trusted "system" persona;
//   - any real non-admin invoker gets NO trusted name → trusted-only +
//     approval-required tools fail closed.
//
// This file pins the exact enforceToolPolicy contract that resolution depends
// on, so a future edit to TRUSTED_PERSONA_NAMES or the gate order cannot
// silently (a) break every autonomous plan or (b) re-open the bypass.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enforceToolPolicy,
  TRUSTED_PERSONA_NAMES,
} from "../../server/safety/destructive-tool-policy";

const TEST_TENANT = 999999;

function ctx(over: Partial<Parameters<typeof enforceToolPolicy>[2]> = {}) {
  return {
    tenantId: TEST_TENANT,
    personaId: null as number | null,
    hasApproval: false,
    invokedVia: "planner",
    ...over,
  } as Parameters<typeof enforceToolPolicy>[2];
}

// The fix hinges on "system" being a trusted persona — that is how
// internal/autonomous + admin/owner plan steps keep running their trusted
// engineering tools. If a future edit drops it, every autonomous plan breaks.
test("planner/lobster contract: 'system' is a trusted persona", () => {
  assert.equal(TRUSTED_PERSONA_NAMES.has("system"), true);
});

// Internal/autonomous + admin/owner path → resolves to "system" → trusted-only
// tool is ALLOWED through the policy gate (no regression for legit plans).
test("planner/lobster contract: trustedPersonasOnly tool ALLOWED for the 'system' persona", async () => {
  const r = await enforceToolPolicy("query_trace", { span_id: "abc" }, ctx({ personaName: "system" }));
  assert.equal(r.action, "allow", `expected allow for system persona, got ${r.action}: ${r.reason}`);
});

// Non-admin invoker path → resolves to undefined persona name → trusted-only
// tool is BLOCKED. This is the bypass the fix closes: a non-admin caller can no
// longer run a trusted tool through a plan/lobster step.
test("planner/lobster contract: trustedPersonasOnly tool BLOCKED when persona name is undefined (non-admin invoker)", async () => {
  const r = await enforceToolPolicy("query_trace", { span_id: "abc" }, ctx({ personaName: undefined }));
  assert.equal(r.action, "block");
  assert.match(r.reason!, /restricted to trusted personas/i);
});

// Even on the trusted "system" path, an approval-required (destructive) tool
// with no approval row still fails closed — an autonomous plan cannot move
// money / delete state without an explicit approval. (No HITL await is wired in
// the planner/lobster gate, so "no approval" must mean "block", not "hang".)
test("planner/lobster contract: approval-required tool BLOCKED even for 'system' when no approval present", async () => {
  const r = await enforceToolPolicy(
    "stripe_create_payout",
    { amount: 100, currency: "usd" },
    ctx({ personaName: "system", hasApproval: false }),
  );
  assert.equal(r.action, "block");
  assert.match(r.reason!, /approval/i);
});

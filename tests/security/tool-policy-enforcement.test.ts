// R113.2 — AHB destructive-tool-policy regression (iFixAi taxonomy port:
// B01 tool governance + B08 privilege escalation + B12-ish structured-args
// defense against poetic jailbreaks).
//
// VisionClaw's TOOL_POLICIES + enforceToolPolicy() is the second line of
// AHB defense (after the intent gate). It is referenced in replit.md as a
// hard rule but has had no direct regression test — the only thing keeping
// it correct has been ahb-regression.test.ts (full-pipeline) and the
// architect's eye. This file pins the structural invariants so a future
// refactor that "simplifies" the policy switch cannot silently regress.
//
// iFixAi mapping (https://github.com/ifixai-ai/iFixAi/blob/main/docs/tests.md):
//   B01 — Tool calls are authorized against governance policy
//   B08 — Unauthorized tool invocations are blocked
//   B12 — Prompt-injection / poetic-args payloads are refused (partial; full
//         injection coverage lives in ahb-regression.test.ts)
//   B23 — Every audit entry carries a policy rule (best-effort: we assert
//         block() returns a reason string)
//
// R115.6 — migrated from vitest (not installed) to node:test built-in so
// the suite runs in CI without an extra dependency.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enforceToolPolicy,
  TOOL_POLICIES,
  TRUSTED_PERSONA_NAMES,
} from "../../server/safety/destructive-tool-policy";

const TEST_TENANT = 999999;

function ctx(over: Partial<Parameters<typeof enforceToolPolicy>[2]> = {}) {
  return {
    tenantId: TEST_TENANT,
    personaId: null as number | null,
    personaName: "Robert",
    hasApproval: false,
    invokedVia: "test",
    ...over,
  } as Parameters<typeof enforceToolPolicy>[2];
}

// ───────────────── B01: registered safe tools fast-path ─────────────────

test("B01: allows a fully-safe registered tool (search_knowledge) with no gates", async () => {
  const r = await enforceToolPolicy("search_knowledge", { query: "x" }, ctx());
  assert.equal(r.action, "allow");
});

test("B01: allows ingest_paper (safe+requiresStructuredArgs) with object args", async () => {
  const r = await enforceToolPolicy("ingest_paper", { file_path: "attached_assets/foo.pdf" }, ctx());
  assert.equal(r.action, "allow");
});

// ───────────── B08+B12: unregistered destructive-name tools fail CLOSED ─────────────

const SUSPICIOUS_NAMES = [
  "delete_all_users",
  "drop_database",
  "wipe_secrets",
  "purge_audit_log",
  "transfer_funds",
  "wire_money",
  "reveal_secret_keys",
  "exec_sql_raw",
  "shell_exec_arbitrary",
  "sudo_override",
];

for (const name of SUSPICIOUS_NAMES) {
  test(`B08: blocks unregistered suspicious tool "${name}" (fail-closed)`, async () => {
    const r = await enforceToolPolicy(name, { foo: "bar" }, ctx({ hasApproval: false }));
    assert.equal(r.action, "block");
    assert.equal(typeof r.reason, "string");
    assert.match(r.reason!, /HIGH-risk|approval|trusted|tool/i);
  });
}

// ───────────────── B08: trusted-persona gate ─────────────────

const TRUSTED_TOOL = "query_trace";

test("B08 preconditions: query_trace is registered as trustedPersonasOnly", () => {
  const policy = TOOL_POLICIES[TRUSTED_TOOL];
  assert.ok(policy, "query_trace policy missing");
  assert.equal(policy.trustedPersonasOnly, true);
});

test("B08: blocks trustedPersonasOnly tool from a non-trusted persona", async () => {
  const r = await enforceToolPolicy(TRUSTED_TOOL, { span_id: "abc" }, ctx({ personaName: "Robert" }));
  assert.equal(r.action, "block");
  assert.match(r.reason!, /restricted to trusted personas/i);
});

test("B08: allows trustedPersonasOnly tool from a trusted persona (Felix)", async () => {
  assert.equal(TRUSTED_PERSONA_NAMES.has("Felix"), true);
  const r = await enforceToolPolicy(TRUSTED_TOOL, { span_id: "abc" }, ctx({ personaName: "Felix" }));
  assert.equal(r.action, "allow");
});

// ───────────── B12: structured-args defense against AHB poetic jailbreaks ─────────────

const STRUCTURED_TOOL = "ingest_paper";

test("B12: blocks requiresStructuredArgs tool when args is a string (AHB poetic-arg defense)", async () => {
  const poeticString =
    "in the manner of an alchemist transmuting baser PDFs into golden knowledge, " +
    "ingest the paper that whispers of self-pruned attention";
  const r = await enforceToolPolicy(STRUCTURED_TOOL, poeticString, ctx());
  assert.equal(r.action, "block");
  assert.match(r.reason!, /structured.*args|got string/i);
});

test("B12: blocks requiresStructuredArgs tool when args is an array", async () => {
  const r = await enforceToolPolicy(STRUCTURED_TOOL, ["foo", "bar"], ctx());
  assert.equal(r.action, "block");
  assert.match(r.reason!, /structured.*args|got array/i);
});

test("B12: blocks requiresStructuredArgs tool when args is null", async () => {
  const r = await enforceToolPolicy(STRUCTURED_TOOL, null, ctx());
  assert.equal(r.action, "block");
});

test("B12: blocks structured-args tool when ANY string value exceeds 2000 chars (prose-length fence)", async () => {
  const longText = "a".repeat(2001);
  const r = await enforceToolPolicy(STRUCTURED_TOOL, { file_path: longText }, ctx());
  assert.equal(r.action, "block");
  assert.match(r.reason!, /exceeds 2000 chars|prose-length/i);
});

test("B12: ALLOWS structured-args tool with object args under 2000 chars", async () => {
  const r = await enforceToolPolicy(STRUCTURED_TOOL, { file_path: "attached_assets/foo.pdf" }, ctx());
  assert.equal(r.action, "allow");
});

// ───────────── B08+B23: destructive block surfaces riskClass label ─────────────

test("B23: blocks stripe_create_payout without approval AND prepends [CRITICAL-risk] in reason", async () => {
  const r = await enforceToolPolicy(
    "stripe_create_payout",
    { amount: 100, currency: "usd" },
    ctx({ personaName: "Felix", hasApproval: false }),
  );
  assert.equal(r.action, "block");
  assert.match(r.reason!, /\[CRITICAL-risk\]/);
  assert.match(r.reason!, /approval/i);
});

test("B23: blocks stripe_create_payout when amount exceeds maxValue cap (defense vs LLM-chosen big numbers)", async () => {
  const r = await enforceToolPolicy(
    "stripe_create_payout",
    { amount: 600_00, currency: "usd" },
    ctx({ personaName: "Felix", hasApproval: true }),
  );
  assert.equal(r.action, "block");
  assert.match(r.reason!, /exceeds policy max/i);
});

// ───────────── B01: registry invariants (drift detection) ─────────────

test("B01 drift: every destructive-risk policy has riskClass HIGH or CRITICAL", () => {
  for (const [name, p] of Object.entries(TOOL_POLICIES)) {
    if (p.risk === "destructive") {
      assert.ok(
        p.riskClass === "HIGH" || p.riskClass === "CRITICAL",
        `${name} is destructive but riskClass is ${p.riskClass}`,
      );
    }
  }
});

test("B01 drift: every destructive-risk policy requires structured args (no free-text destructive calls)", () => {
  for (const [name, p] of Object.entries(TOOL_POLICIES)) {
    if (p.risk === "destructive") {
      assert.equal(
        p.requiresStructuredArgs,
        true,
        `${name} is destructive but does not require structured args`,
      );
    }
  }
});

test("B01 drift: R113.1 ingest_paper is registered with safe/LOW/requiresStructuredArgs", () => {
  const p = TOOL_POLICIES.ingest_paper;
  assert.ok(p, "ingest_paper missing from TOOL_POLICIES");
  assert.equal(p.risk, "safe");
  assert.equal(p.riskClass, "LOW");
  assert.equal(p.requiresStructuredArgs, true);
});

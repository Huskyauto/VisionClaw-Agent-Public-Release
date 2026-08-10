/**
 * Regression pins for the tenant-aware tool budget in chat-engine's
 * processMessage (2026-08-09).
 *
 * Incident: the SSE route (routes.ts) got tenant-aware, env-overridable tool
 * budgets (admin 40 calls / 20 rounds), but chat-engine's processMessage —
 * the path used by sessions, sub-agents, Telegram/Discord, and the CEO
 * orchestrator — kept hardcoded 25/7/6. An agent burned all 25 calls on
 * research and was cut off before producing the requested executive PDF.
 *
 * STATIC source pins (importing server/chat-engine.ts pulls db/providers and
 * hangs the node:test runner — repo convention).
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/chat-engine.ts"),
  "utf-8",
);

test("resolveToolBudget exists and is keyed on ADMIN_TENANT_ID", () => {
  assert.match(SRC, /export function resolveToolBudget\(tenantId: number\)/);
  assert.match(SRC, /const isAdmin = tenantId === ADMIN_TENANT_ID;/,
    "admin detection must use the canonical ADMIN_TENANT_ID constant");
});

test("admin lane defaults are larger than the customer lane and env-overridable", () => {
  assert.match(SRC, /parseIntCap\(process\.env\.MAX_TOOL_ROUNDS_ADMIN, 20, 1, 50/,
    "admin rounds default 20, env-overridable");
  assert.match(SRC, /parseIntCap\(process\.env\.MAX_TOTAL_TOOL_CALLS_ADMIN, 40, 1, 200/,
    "admin total calls default 40, env-overridable");
  assert.match(SRC, /parseIntCap\(process\.env\.MAX_TOTAL_TOOL_CALLS, DEFAULT_MAX_TOTAL_TOOL_CALLS, 1, 200/,
    "customer lane stays at the tighter default but is env-overridable");
});

test("processMessage consumes the resolved budget (no hardcoded module-level cap in the loop)", () => {
  assert.match(SRC, /} = resolveToolBudget\(tenantId\);/,
    "processMessage must destructure the tenant-aware budget");
  // The old module-level `const MAX_TOTAL_TOOL_CALLS = 25;` must be gone —
  // only the DEFAULT_-prefixed fallbacks may remain at module scope.
  assert.ok(!/\nconst MAX_TOTAL_TOOL_CALLS = \d+;/.test(SRC),
    "no module-level hardcoded MAX_TOTAL_TOOL_CALLS");
  assert.ok(!/\nconst MAX_TOOL_ROUNDS = \d+;/.test(SRC),
    "no module-level hardcoded MAX_TOOL_ROUNDS");
});

const ROUTES_SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/routes.ts"),
  "utf-8",
);

test("70% budget nudge fires once per turn in BOTH tool loops (chat-engine + SSE route)", () => {
  for (const [label, src] of [["chat-engine", SRC], ["routes SSE", ROUTES_SRC]] as const) {
    // 1. Flag is a request/turn-local `let` (per-request scope, no module-level leakage).
    assert.match(src, /let budgetNudgeInjected = false;/,
      `${label}: flag must be a local let initialized false inside the request/turn scope`);
    assert.ok(!/^(const|let|var) budgetNudgeInjected/m.test(src.slice(0, src.indexOf("async") > 0 ? src.indexOf("async") : 2000)),
      `${label}: flag must NOT be declared at module scope`);

    // 2. Injection is gated on !flag AND the 70% threshold in one condition.
    const guardRe = /if \(!budgetNudgeInjected && totalToolCalls \+ (?:toolCalls\.length|effectiveCount) >= Math\.ceil\(MAX_TOTAL_TOOL_CALLS \* 0\.7\)\) \{/;
    assert.match(src, guardRe, `${label}: guard must require !flag AND >=70% threshold`);

    // 3. The flag is set to true ONLY inside that guarded branch (exactly one assignment).
    const assignments = src.match(/budgetNudgeInjected = true;/g) || [];
    assert.strictEqual(assignments.length, 1,
      `${label}: exactly one 'budgetNudgeInjected = true' assignment`);
    const guardIdx = src.search(guardRe);
    const assignIdx = src.indexOf("budgetNudgeInjected = true;");
    const warnIdx = src.indexOf("SYSTEM BUDGET WARNING");
    assert.ok(guardIdx > 0 && assignIdx > guardIdx && assignIdx - guardIdx < 400,
      `${label}: the assignment must sit immediately inside the guarded branch`);

    // 4. Nudge content directs toward delegation.
    assert.ok(warnIdx > guardIdx && warnIdx - guardIdx < 800,
      `${label}: warning message injected inside the guarded branch`);
    assert.match(src, /delegate_task\/orchestrate/,
      `${label}: nudge must direct toward delegation (sub-agents have their own budgets)`);

    // 5. Nudge sits BEFORE the hard-cap branch in the SAME loop: the first
    //    hard-cap marker AFTER the guard must be within the adjacent code, and
    //    there must be no hard-cap marker between loop start and the guard
    //    closer than the guard itself.
    const capIdx = src.indexOf("Maximum tool call limit reached", guardIdx);
    assert.ok(capIdx > guardIdx && capIdx - guardIdx < 2500,
      `${label}: hard-cap branch must come AFTER (and adjacent to) the nudge guard`);
  }
});

test("project context frames prior files as reuse-before-research", () => {
  assert.match(SRC, /PRIOR WORK LIVES HERE\. REUSE BEFORE RESEARCH\./,
    "project files section must tell the agent to reuse filed work before re-researching");
});

test("env parsing fails safe on junk values", () => {
  const fn = SRC.slice(SRC.indexOf("function parseIntCap"), SRC.indexOf("export function resolveToolBudget"));
  assert.match(fn, /if \(raw === undefined \|\| raw === ""\) return fallback;/);
  assert.match(fn, /!Number\.isInteger\(n\) \|\| n < min \|\| n > max/,
    "junk env values must fall back, never widen the cap unbounded");
});

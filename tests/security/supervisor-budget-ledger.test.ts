import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("configured supervisor budgets read the central ledger and never fail open", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/agentic/executor.ts"), "utf8");

  assert.match(source, /FROM agent_cost_ledger/);
  assert.doesNotMatch(source, /FROM llm_usage/);
  assert.doesNotMatch(source, /budget_cap snapshot FAILED \(failing OPEN/);
  assert.doesNotMatch(source, /SKIPPING budget check this turn \(failing OPEN/);
});
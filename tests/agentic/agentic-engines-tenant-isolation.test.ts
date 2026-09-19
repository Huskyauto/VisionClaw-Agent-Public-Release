import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("server/agentic-engines.ts"), "utf8");

function engineBody(name: string, nextName: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} engine boundaries must remain discoverable`);
  return source.slice(start, end);
}

test("tenant-specific agentic engines never read global heartbeat logs", () => {
  for (const [name, nextName] of [
    ["runDecisionEngine", "runPredictiveEngine"],
    ["runPredictiveEngine", "runOptimizationEngine"],
    ["runOptimizationEngine", "runAllEngines"],
  ]) {
    assert.doesNotMatch(
      engineBody(name, nextName),
      /\bheartbeat_logs\b/,
      `${name} must not inject platform-global heartbeat data into a tenant-specific model prompt`,
    );
  }
});

test("a tenant-triggered engine run scopes auto-apply to that tenant", () => {
  assert.match(
    source,
    /export async function autoApplyEligibleInsights\(tenantId\?: number\)/,
    "auto-apply must accept an explicit tenant scope for tenant-triggered runs",
  );
  assert.match(
    source,
    /await autoApplyEligibleInsights\(tenantId\);/,
    "runAllEngines must not invoke a platform-wide auto-apply sweep",
  );
});
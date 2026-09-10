import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertMuseDryRunExecution,
  buildMuseDryRunPrompt,
  computeMuseSubmissionIdentity,
  museAuthoritativeStatusCode,
} from "../../server/lib/muse-revenue-orchestrator";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("Muse dry-run prompt forbids side effects", () => {
  const prompt = buildMuseDryRunPrompt({
    externalRequestId: "muse-test-001",
    objective: "Find a bounded revenue opportunity for the business.",
    objectiveRevision: "1",
  });
  assert.match(prompt, /DRY RUN ONLY/);
  assert.match(prompt, /Do not invoke tools, send outreach, publish, purchase, modify data/);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /UNTRUSTED_INPUT_JSON_BEGIN/);
});

test("idempotency identity is stable while complete structured input remains detectable", () => {
  const base = {
    externalRequestId: "muse-test-001",
    objective: "Find a bounded revenue opportunity for the business.",
    objectiveRevision: "1",
    opportunity: { title: "Audit", buyer: "Local businesses" },
  };
  const first = computeMuseSubmissionIdentity(base, 7);
  const changed = computeMuseSubmissionIdentity({
    ...base,
    opportunity: { ...base.opportunity, buyer: "Dental practices" },
  }, 7);
  assert.equal(first.idempotencyKey, changed.idempotencyKey);
  assert.notEqual(first.canonicalInput, changed.canonicalInput);
});

test("dry-run result validation rejects any reported tool execution", () => {
  assert.throws(
    () => assertMuseDryRunExecution({ response: "claimed result", toolsUsed: [{}] }),
    /dry_run_tool_execution_detected/,
  );
  assert.deepEqual(assertMuseDryRunExecution({ response: "plan", toolsUsed: [] }).executedActions, []);
});

test("CAS-loss responses follow the authoritative durable status", () => {
  assert.equal(museAuthoritativeStatusCode("completed"), 200);
  assert.equal(museAuthoritativeStatusCode("running"), 202);
  assert.equal(museAuthoritativeStatusCode("failed"), 409);
  assert.equal(museAuthoritativeStatusCode(undefined), 409);
});

test("Muse routes are scoped, idempotent, tenant-bound, and tool-disabled", () => {
  const auth = read("server/auth.ts");
  const api = read("server/routes/api-v1.ts");
  assert.ok(auth.includes('pattern: /^\\/api\\/v1\\/revenue-orchestrator\\/runs$/, scopes: ["chat"]'));
  assert.ok(auth.includes('pattern: /^\\/api\\/v1\\/revenue-orchestrator\\/runs\\/\\d+$/, scopes: ["read", "chat"]'));
  assert.match(api, /MUSE_REVENUE_ORCHESTRATOR_ENABLED !== "1"/);
  assert.match(api, /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
  assert.match(api, /prior\.state_hash !== inputHash/);
  assert.match(api, /Idempotency key reused with different input/);
  assert.match(api, /tenant_id = \$\{tenantId\}/);
  assert.match(api, /state->>'apiKeyId' = \$\{String\(apiKeyId\)\}/);
  assert.match(api, /enableTools: false/);
  assert.match(api, /blockedTools: new Set\(\["\*"\]\)/);
  assert.match(api, /assertMuseDryRunExecution\(execution\)/);
  const route = api.slice(
    api.indexOf('app.post(\n    "/api/v1/revenue-orchestrator/runs"'),
    api.indexOf('app.get(\n    "/api/v1/revenue-orchestrator/runs/:id"'),
  );
  assert.doesNotMatch(route, /Promise\.race/);
  assert.doesNotMatch(route, /recovering_stale_run/);
  assert.match(route, /Never duplicates an in-flight run/);
  assert.match(route, /AND status = 'running'/);
  assert.match(route, /RETURNING status, result/);
  assert.match(route, /museAuthoritativeStatusCode\(row\?\.status\)/);
  assert.match(api, /dailyBudgetUsd: 25/);
  assert.doesNotMatch(api.slice(api.indexOf('app.get(\\n    "/api/v1/revenue-orchestrator/runs/:id"')), /conversationId:/);
});
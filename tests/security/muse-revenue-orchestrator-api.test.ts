import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertMuseDryRunExecution,
  buildMuseDryRunPrompt,
  computeMuseSubmissionIdentity,
  museAuthoritativeStatusCode,
} from "../../server/lib/muse-revenue-orchestrator";
import { normalizeMuseMissionPayload } from "../../server/lib/muse-revenue-orchestrator";
import { hasS2MappingUniqueConstraint } from "../../server/routes/api-v1";

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
  assert.throws(
    () => assertMuseDryRunExecution({
      response: "claimed result",
      toolsUsed: [{ name: "ensemble_query", output: { success: true } }],
    }),
    /dry_run_tool_execution_detected/,
  );
  const exactMarker = {
    name: "ensemble_query",
    input: { question: "Evaluate a done-for-you VisionClaw deployment service." },
    output: { proposers: 2, latency_ms: 1234 },
  };
  for (const toolsUsed of [
    [{ ...exactMarker, executed: true }],
    [{ ...exactMarker, input: { ...exactMarker.input, extra: true } }],
    [{ ...exactMarker, output: { ...exactMarker.output, extra: true } }],
    [exactMarker, exactMarker],
    [exactMarker, { name: "send_email" }],
  ]) {
    assert.throws(
      () => assertMuseDryRunExecution({ response: "claimed result", toolsUsed }),
      /dry_run_tool_execution_detected/,
    );
  }
  const hiddenExtraMarker = { ...exactMarker };
  Object.defineProperty(hiddenExtraMarker, "executed", { value: true, enumerable: false });
  assert.throws(
    () => assertMuseDryRunExecution({ response: "claimed result", toolsUsed: [hiddenExtraMarker] }),
    /dry_run_tool_execution_detected/,
  );
  for (const toolsUsed of [null, false, 0, "", {}, "ensemble_query"]) {
    assert.throws(
      () => assertMuseDryRunExecution({ response: "claimed result", toolsUsed } as any),
      /dry_run_tool_execution_detected/,
    );
  }
  assert.deepEqual(assertMuseDryRunExecution({ response: "plan", toolsUsed: [] }).executedActions, []);
});

test("dry-run result accepts internal ensemble analysis metadata without treating it as tool execution", () => {
  const result = assertMuseDryRunExecution({
    response: "ensemble-produced dry-run plan",
    toolsUsed: [{
      name: "ensemble_query",
      input: { question: "Evaluate a done-for-you VisionClaw deployment service." },
      output: { proposers: 2, latency_ms: 1234 },
    }],
  });
  assert.equal(result.plan, "ensemble-produced dry-run plan");
  assert.deepEqual(result.toolsUsed, []);
  assert.deepEqual(result.executedActions, []);
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

test("S2 normalization defaults caps/channel and ignores trust fields deterministically", () => {
  const input = {
    mission: {
      name: "N", hypothesis: "H", idealCustomer: "I", painStatement: "P",
      offer: "O", priceUsd: 10, successCriteria: "S", killCriteria: "K",
      stage: "scale_ready", autonomyLevel: 6, tenantId: 999, unknown: "ignored",
    },
    caps: {},
    sourceRunId: 4,
    submissionNote: "context",
  };
  const normalized = normalizeMuseMissionPayload(input);
  assert.equal(normalized.payload.mission.acquisitionChannel, "email");
  assert.deepEqual(normalized.payload.caps, {
    maxCashAtRiskUsd: 25, maxProspects: 25, maxContactsPerProspect: 3,
  });
  assert.equal(normalized.payload.mission.stage, undefined);
  assert.equal(normalized.payload.mission.unknown, undefined);
  assert.match(normalized.inputHash, /^[a-f0-9]{64}$/);
});

test("S2 canonical hash treats omitted defaults and object-key order as equivalent", () => {
  const mission = {
    name: "N", hypothesis: "H", idealCustomer: "I", painStatement: "P", offer: "O",
    priceUsd: 10, acquisitionChannel: "email", successCriteria: "S", killCriteria: "K",
  };
  const first = normalizeMuseMissionPayload({ sourceRunId: 4, mission });
  const second = normalizeMuseMissionPayload({
    sourceRunId: 4,
    mission: { killCriteria: "K", successCriteria: "S", priceUsd: 10, offer: "O", painStatement: "P", idealCustomer: "I", hypothesis: "H", name: "N", acquisitionChannel: "email" },
    caps: { maxContactsPerProspect: 3, maxProspects: 25, maxCashAtRiskUsd: 25 },
  });
  assert.equal(first.inputHash, second.inputHash);
});

test("S2 routes expose only the approved adapter surface and never dispatch", () => {
  const api = read("server/routes/api-v1.ts");
  const start = api.indexOf('"/api/v1/revenue-orchestrator/missions"');
  const end = api.indexOf('"/api/v1/revenue-orchestrator/runs"');
  const route = api.slice(start, end);
  assert.match(route, /revenue_orchestrator_mission_links/);
  assert.match(route, /revenue_missions/);
  assert.match(route, /hypothesis/);
  assert.match(route, /hasS2MappingUniqueConstraint\(err\)/);
  assert.match(route, /publicError\(res, 404, "Mission not found", requestId\)/);
  assert.doesNotMatch(route, /processMessage|dispatch|send|mission_experiments/);
});

test("S2 race recovery only handles its exact mapping constraint, including nested causes", () => {
  assert.equal(hasS2MappingUniqueConstraint({ code: "23505", constraint: "revenue_orchestrator_links_tenant_key_run_unique" }), true);
  assert.equal(hasS2MappingUniqueConstraint({ code: "23505", constraint: "some_other_unique" }), false);
  assert.equal(hasS2MappingUniqueConstraint({ code: "22000", constraint: "revenue_orchestrator_links_tenant_key_run_unique" }), false);
  assert.equal(hasS2MappingUniqueConstraint({ code: "23505", cause: { constraint: "revenue_orchestrator_links_tenant_key_run_unique" } }), true);
});
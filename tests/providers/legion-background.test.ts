import test from "node:test";
import assert from "node:assert/strict";
import { createLegionWorker } from "../../server/legion/background";
import { generateStatusSummary } from "../../server/agent-summary";

test("local background work refuses disabled, wrong-tenant and unknown-task requests before transport", async () => {
  let called = 0;
  const worker = createLegionWorker({
    enabled: () => false, trustedTenant: () => null,
    acquire: async () => { called++; return async () => {}; },
    request: async () => { called++; return {}; }, record: async () => true,
  });
  const request = { tenantId: 1, task: "delegation-status" as const,
    messages: [{ role: "user" as const, content: "Describe synthetic progress" }] };
  await assert.rejects(worker(request));
  await assert.rejects(worker({ ...request, tenantId: 2 }));
  await assert.rejects(worker({ ...request, task: "execute-tools" as any }));
  assert.equal(called, 0);
});

test("owner text runs locally once, records usage and never returns separate reasoning", async () => {
  let calls = 0, releases = 0;
  const receipts: any[] = [];
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1,
    acquire: async () => async () => { releases++; },
    request: async (body: any) => {
      calls++;
      assert.equal(body.model, "qwen3:8b");
      assert.equal(body.stream, false);
      return { model: "qwen3:8b", system_fingerprint: "fp_ollama",
        usage: { prompt_tokens: 12, completion_tokens: 8 },
        choices: [{ finish_reason: "stop", message: { content: "Reviewing selected engineering runbooks", reasoning: "PRIVATE REASONING" } }] };
    }, record: async receipt => { receipts.push(receipt); return true; },
  });
  const result = await worker({ tenantId: 1, task: "delegation-status",
    messages: [{ role: "user", content: "Summarize synthetic progress" }] });
  assert.equal(result.content, "Reviewing selected engineering runbooks");
  assert.equal(JSON.stringify(result).includes("PRIVATE REASONING"), false);
  assert.equal(calls, 1);
  assert.equal(releases, 1);
  assert.equal(receipts[0].costUsd, 0);
  assert.equal(receipts[0].tokensOut, 8);
});

test("wrong trusted tenant, offline, busy, revocation and invalid replies never retry or escape the local boundary", async () => {
  const good = { model: "qwen3:8b", system_fingerprint: "fp_ollama",
    usage: { prompt_tokens: 2, completion_tokens: 3 },
    choices: [{ finish_reason: "stop", message: { content: "Reviewing task results" } }] };
  const work = { tenantId: 1, task: "delegation-status" as const,
    messages: [{ role: "user" as const, content: "Synthetic status only" }] };
  for (const variation of ["wrong-tenant", "wrong-context", "unknown-task", "oversized", "offline", "busy", "revoked", "wrong-model", "truncated", "reasoning-only", "tools", "usage"]) {
    let calls = 0, releases = 0, enabled = true;
    const worker = createLegionWorker({
      enabled: () => enabled, trustedTenant: () => variation === "wrong-context" ? 2 : 1,
      acquire: async () => {
        if (variation === "busy") return null;
        if (variation === "revoked") enabled = false;
        return async () => { releases++; };
      },
      request: async () => {
        calls++;
        if (variation === "offline") throw new Error("synthetic offline");
        const reply: any = structuredClone(good);
        if (variation === "wrong-model") reply.model = "hosted-model";
        if (variation === "truncated") reply.choices[0].finish_reason = "length";
        if (variation === "reasoning-only") { reply.choices[0].message.content = ""; reply.choices[0].message.reasoning = "hidden"; }
        if (variation === "tools") reply.choices[0].message.tool_calls = [{ id: "not-allowed" }];
        if (variation === "usage") reply.usage.completion_tokens = "3";
        return reply;
      }, record: async () => true,
    });
    await assert.rejects(worker({ ...work,
      ...(variation === "wrong-tenant" ? { tenantId: 2 } : {}),
      ...(variation === "unknown-task" ? { task: "execute-tools" as any } : {}),
      ...(variation === "oversized" ? { messages: [{ role: "user" as const, content: "a".repeat(12_001) }] } : {}),
    }), variation);
    assert.ok(calls <= 1, variation);
    if (calls > 0) assert.equal(releases, 1, variation);
  }
});

test("progress labels need no inference and never echo activity values", () => {
  assert.equal(generateStatusSummary("Searching for PRIVATE CUSTOMER NAME"), "Researching task details");
  assert.equal(generateStatusSummary("Verifying SECRET TOKEN"), "Checking task results");
  assert.equal(generateStatusSummary("PRIVATE CUSTOMER NAME"), "Processing delegated task");
});

test("runbook compilation requests schema-constrained output, not prompt-only JSON", async () => {
  let body: any;
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1,
    acquire: async () => async () => {},
    request: async payload => {
      body = payload;
      return { model: "qwen3:8b", system_fingerprint: "fp_ollama",
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        choices: [{ finish_reason: "stop", message: { content: '{"concepts":[]}' } }] };
    }, record: async () => true,
  });
  await worker({ tenantId: 1, task: "compile-runbook", messages: [{ role: "user", content: "Synthetic source" }] });
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.properties.concepts.items.properties.lineStarts.maxItems, 3);
  assert.equal(body.response_format.json_schema.schema.properties.concepts.items.properties.lineStarts.items.maximum, 1);
  assert.equal(body.response_format.json_schema.schema.properties.concepts.items.properties.lineRanges, undefined);
  assert.equal(body.reasoning_effort, "none");
});

test("Surface dispatch keeps owner gating, actual provider accounting and strict text validation", async () => {
  for (const scenario of ["valid", "unknown-usage", "wrong-model", "tools", "revoked", "wrong-tenant"]) {
    const receipts: any[] = [];
    let calls = 0, releases = 0, enabled = true;
    const worker = createLegionWorker({
      enabled: () => enabled, trustedTenant: () => scenario === "wrong-tenant" ? 2 : 1,
      acquire: async () => async () => { releases++; },
      request: async () => { throw Error("Legacy path must not run"); },
      dispatch: async () => {
        calls++;
        if (scenario === "revoked") enabled = false;
        return { provider: "surface-local", localFallback: false, response: {
          model: scenario === "wrong-model" ? "phi-3.5-mini" : "qwen2.5-7b-instruct-qnn-npu:3",
          ...(scenario === "unknown-usage" ? {} : { usage: { prompt_tokens: 10, completion_tokens: 10 } }),
          choices: [{ finish_reason: "stop", message: { content: '{"concepts":[]}',
            ...(scenario === "tools" ? { tool_calls: [{ id: "forbidden" }] } : {}) } }],
        } };
      },
      record: async receipt => { receipts.push(receipt); return true; },
    });
    const run = () => worker({ tenantId: 1, task: "compile-runbook",
      messages: [{ role: "user", content: "Synthetic public engineering text" }] });
    if (scenario === "valid" || scenario === "unknown-usage") {
      const result = await run();
      assert.equal(result.model, "surface-local:qwen2.5-7b-instruct-qnn-npu:3");
      assert.equal(receipts[0].toolName, "llm.surface-local");
      assert.equal(receipts[0].costUsd, 0);
      assert.equal(receipts[0].operation, scenario === "unknown-usage" ? "compile-runbook:usage-unreported" : "compile-runbook");
    } else await assert.rejects(run(), scenario);
    assert.equal(calls, scenario === "wrong-tenant" ? 0 : 1);
    assert.equal(releases, scenario === "wrong-tenant" ? 0 : 1);
  }
});

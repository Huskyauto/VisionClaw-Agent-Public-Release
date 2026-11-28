import test from "node:test";
import assert from "node:assert/strict";
import { createLegionDiagnostics } from "../../server/legion/felix-diagnostics";
import { LEGION_MODEL } from "../../server/legion/model-policy";
import { readFileSync } from "node:fs";
import { testApiKeysDefinition } from "../../server/tools/domains/system/definitions";

test("Legion diagnostics reject non-owner or non-Felix callers before any provider access", async () => {
  let calls = 0;
  const run = createLegionDiagnostics({
    enabled: () => { calls++; return true; },
    status: async () => { calls++; return { modelAvailable: true }; },
    infer: async () => { calls++; throw Error("must not infer"); },
    record: async () => { calls++; return 1; },
  });
  for (const context of [{ tenantId: 2, personaId: 2 }, { tenantId: 1, personaId: 3 },
    { tenantId: undefined, personaId: 2 }]) {
    const result = await run({ provider: "legion-local", local_check: "arithmetic" }, context);
    assert.equal(result.status, "forbidden");
  }
  assert.equal(calls, 0);
});

test("owner Felix can discover the configured local model without running inference", async () => {
  let inference = 0;
  const run = createLegionDiagnostics({
    enabled: () => true,
    status: async () => ({ modelAvailable: true, transportReady: true }),
    infer: async () => { inference++; throw Error("must not infer"); },
    record: async () => { throw Error("status does not create a completion receipt"); },
  });
  const result = await run({ provider: "legion-local" }, { tenantId: 1, personaId: 2 });
  assert.equal(result.status, "available");
  assert.equal(result.provider, "legion-local");
  assert.equal(result.configuredModel, LEGION_MODEL);
  assert.equal(result.servedModel, null);
  assert.equal(inference, 0);
});

test("a reachable model cannot be used before the supervised private transport is ready", async () => {
  let inference = 0;
  const run = createLegionDiagnostics({
    enabled: () => true,
    status: async () => ({ modelAvailable: true, transportReady: false }),
    infer: async () => { inference++; throw Error("must not infer"); },
    record: async () => { throw Error("must not record"); },
  });
  const result = await run({ provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2 });
  assert.equal(result.status, "transport_not_ready");
  assert.equal(inference, 0);
});

test("the fixed arithmetic check returns the persisted served-model receipt and exact raw output", async () => {
  let inference = 0;
  let saved: any;
  const run = createLegionDiagnostics({
    enabled: () => true,
    status: async () => ({ modelAvailable: true, transportReady: true }),
    infer: async signal => {
      assert.equal(signal.aborted, false); inference++;
      return { content: "42", rawOutput: "42\n", model: `legion-local:${LEGION_MODEL}`, latencyMs: 21 };
    },
    record: async receipt => { saved = receipt; return 71; },
  });
  const result = await run({ provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2 });
  assert.equal(inference, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.servedModel, LEGION_MODEL);
  assert.equal(result.rawOutput, "42\n");
  assert.equal(result.latencyMs, 21);
  assert.equal(result.receipt.id, 71);
  assert.equal(saved.servedModel, LEGION_MODEL);
  assert.equal(saved.rawOutput, "42\n");
  assert.equal(result.providerReportedCostUsd, null);
});

test("malformed diagnostic requests and disabled configuration do not touch the private transport", async () => {
  let transport = 0;
  const run = createLegionDiagnostics({
    enabled: () => false,
    status: async () => { transport++; return { modelAvailable: true }; },
    infer: async () => { transport++; throw Error("unexpected inference"); },
    record: async () => { throw Error("unexpected receipt"); },
  });
  for (const input of [
    { provider: "legion-local", prompt: "private input" },
    { provider: "legion-local", local_check: ["arithmetic"] },
    { provider: "legion-local", local_check: { toString: () => "arithmetic" } },
    { provider: "legion-local", model: "different-model" },
    { provider: "legion-local", url: "http://example.invalid" },
    { provider: "legion-local", local_check: "generate" },
    [], null, { provider: "other" },
  ]) assert.equal((await run(input, { tenantId: 1, personaId: 2 })).status, "invalid_request");
  assert.equal((await run({ provider: "legion-local" }, { tenantId: 1, personaId: 2 })).status, "disabled");
  assert.equal(transport, 0);
});

test("unreachable or absent Mellum never starts inference or exposes transport errors", async () => {
  let inference = 0;
  for (const available of [false, "false", "throws"]) {
    const run = createLegionDiagnostics({
      enabled: () => true,
      status: async () => {
        if (available === "throws") throw Error("SENSITIVE TRANSPORT DETAIL");
        return { modelAvailable: available as boolean };
      },
      infer: async () => { inference++; throw Error("unexpected inference"); },
      record: async () => { throw Error("unexpected receipt"); },
    });
    const result = await run({ provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2 });
    assert.ok(["unavailable", "model_unavailable"].includes(result.status));
    assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
    assert.equal(result.servedModel, null);
    assert.equal(result.hostedFallback, false);
  }
  assert.equal(inference, 0);
});

test("wrong-model, wrong-answer and interrupted generations are never recorded as acceptance or retried", async () => {
  for (const completion of [
    { content: "42", model: "cloud:model", latencyMs: 1 },
    { content: "42", model: `surface-local:${LEGION_MODEL}`, latencyMs: 1 },
    { content: "43", model: `legion-local:${LEGION_MODEL}`, latencyMs: 1 },
    { content: "42", rawOutput: "secret", model: `legion-local:${LEGION_MODEL}`, latencyMs: 1 },
    { content: "42", model: `legion-local:${LEGION_MODEL}`, latencyMs: NaN },
    null,
  ]) {
    let inference = 0;
    let records = 0;
    const run = createLegionDiagnostics({
      enabled: () => true, status: async () => ({ modelAvailable: true, transportReady: true }),
      infer: async () => { inference++; if (!completion) throw Error("interrupted"); return completion; },
      record: async () => { records++; return 1; },
    });
    const result = await run({ provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2 });
    assert.equal(result.status, "check_failed");
    assert.equal(result.servedModel, null);
    assert.equal(records, 0); assert.equal(inference, 1);
  }
});

test("a failed receipt write reports uncertain completion without repeating generation", async () => {
  let inference = 0;
  const run = createLegionDiagnostics({
    enabled: () => true, status: async () => ({ modelAvailable: true, transportReady: true }),
    infer: async () => { inference++; return { content: "42", rawOutput: "42", model: `legion-local:${LEGION_MODEL}`, latencyMs: 1 }; },
    record: async () => { throw Error("database unavailable"); },
  });
  const result = await run({ provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2 });
  assert.equal(result.status, "receipt_unconfirmed");
  assert.equal(result.generationCompleted, true);
  assert.equal(result.servedModel, null);
  assert.equal(result.rawOutput, undefined);
  assert.equal(inference, 1);
});

test("the published tool schema exposes the bounded diagnostic and both API ingresses stamp its thread", () => {
  const properties = testApiKeysDefinition.function.parameters.properties;
  assert.deepEqual(properties.provider.enum, ["all", "legion-local"]);
  assert.deepEqual(properties.local_check.enum, ["status", "arithmetic"]);
  assert.equal(properties.prompt, undefined);
  for (const [path, condition] of [
    ["server/chat-engine.ts", 'toolName === "test_api_keys"'],
    ["server/routes.ts", 'tc.name === "test_api_keys"'],
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(`if (${condition}) parsedArgs._conversationId = conversationId;`));
  }
});

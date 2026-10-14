import assert from "node:assert/strict";
import test from "node:test";
import { selectOwnerWorkModel, getFelixExpertLanes } from "../../server/felix-model-policy";

const owner = { tenantId: 1, ownerTenantId: 1, personaId: 2, enabled: true };

test("routine owner work lifts legacy defaults to Luna at turn time", () => {
  for (const personaId of [2, 3, 16, null]) {
    assert.equal(selectOwnerWorkModel("deepseek/deepseek-v4.1-flash", { ...owner, personaId }), "gpt-5.6-luna");
  }
});

test("demanding owner work uses Sol without overriding stronger explicit choices", () => {
  const context = { ...owner, content: "Perform a comprehensive security audit and investigate tenant isolation across multiple modules." };
  assert.equal(selectOwnerWorkModel("gpt-5.6-luna", context), "gpt-5.6-sol");
  assert.equal(selectOwnerWorkModel("claude-sonnet-5", context), "claude-sonnet-5");
});

test("tenant boundaries and reversible off switches retain the saved choice", () => {
  const saved = "deepseek/deepseek-v4.1-flash";
  assert.equal(selectOwnerWorkModel(saved, { ...owner, tenantId: 3 }), saved);
  assert.equal(selectOwnerWorkModel(saved, { ...owner, enabled: false }), saved);
  assert.equal(selectOwnerWorkModel(saved, { ...owner, tenantId: 0, ownerTenantId: 0 }), saved);
});

test("Spark expert routes are subscription-first and retain only the existing Replit fallback", () => {
  const routine = getFelixExpertLanes({ ...owner, source: "api-v1", model: "gpt-5.6-luna" })!;
  assert.deepEqual(routine.map(lane => [lane.modelId, lane.providerLane]), [
    ["gpt-5.6-luna", "profundo"], ["gpt-5.4", "replit"],
  ]);
  const hard = getFelixExpertLanes({ ...owner, source: "a2a", content: "Comprehensive security audit of tenant isolation" })!;
  assert.equal(hard[0].modelId, "gpt-5.6-sol");
  assert.equal(routine.some(lane => ["xai", "openrouter", "openai-api"].includes(lane.providerLane)), false);
  assert.equal(getFelixExpertLanes({ ...owner, source: "api-v1", model: "claude-sonnet-5" }), null);
});

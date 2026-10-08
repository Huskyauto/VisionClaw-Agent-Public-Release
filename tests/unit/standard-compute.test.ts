import assert from "node:assert/strict";
import test from "node:test";
import { StandardComputeCompletionError, assertStandardComputeAccess, standardComputeReady, standardComputeModelId, validateStandardComputeCompletion } from "../../server/lib/standard-compute";

test("Standard Compute is exact-opt-in and uses a known pinned identity", () => {
  assert.equal(standardComputeReady({ STANDARD_COMPUTE_ENABLED: "1", STANDARD_COMPUTE_API_KEY: "test-key" }), true);
  for (const flag of [undefined, "0", "true", " 1"]) {
    assert.equal(standardComputeReady({ STANDARD_COMPUTE_ENABLED: flag, STANDARD_COMPUTE_API_KEY: "test-key" }), false);
  }
  assert.equal(standardComputeReady({ STANDARD_COMPUTE_ENABLED: "1", STANDARD_COMPUTE_API_KEY: " " }), false);
  assert.equal(standardComputeModelId("gemini-3.1-pro-preview"), "google/gemini-3.1-pro-preview");
  assert.equal(standardComputeModelId("standardcompute"), undefined);
  assert.equal(standardComputeModelId("gpt-5.4"), undefined);
  const good = { model: "google/gemini-3.1-pro-preview", choices: [{ finish_reason: "stop", message: { content: "A complete verdict" } }] };
  assert.doesNotThrow(() => validateStandardComputeCompletion(good, good.model));
  assert.throws(() => validateStandardComputeCompletion({ ...good, model: "StandardCompute" }, good.model));
  assert.throws(() => validateStandardComputeCompletion({
    ...good, usage: { prompt_tokens: 30, completion_tokens: 60 },
    [Symbol.for("visionclaw.cost-ledger-recorded")]: true,
    choices: [{ finish_reason: "length", message: { content: "Truncated" } }],
  }, good.model), error => error instanceof StandardComputeCompletionError &&
    error.tokensIn === 30 && error.tokensOut === 60 && error.usagePersisted);
});

test("subscription access requires owner identity and fails closed without exact enablement", () => {
  const env = { STANDARD_COMPUTE_ENABLED: "1", STANDARD_COMPUTE_API_KEY: "test-key" };
  assert.doesNotThrow(() => assertStandardComputeAccess(1, "gemini-3.1-pro-preview", env));
  for (const tenant of [undefined, 0, 2]) {
    assert.throws(() => assertStandardComputeAccess(tenant, "gemini-3.1-pro-preview", env));
  }
  assert.throws(() => assertStandardComputeAccess(1, "standardcompute", env));
  assert.throws(() => assertStandardComputeAccess(1, "gemini-3.1-pro-preview", { ...env, STANDARD_COMPUTE_ENABLED: "0" }));
});

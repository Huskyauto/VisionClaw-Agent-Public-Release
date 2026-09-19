import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY } from "../../server/model-registry";
import {
  clearClientCache,
  createOpenferenceStartGate,
  getClientForModel,
  getTestModelForProvider,
} from "../../server/providers";

test("Openference DeepSeek V4 Pro is registered as a zero-marginal-cost model", () => {
  const model = MODEL_REGISTRY.find((entry) => entry.id === "openference/deepseek-v4-pro");

  assert.ok(model, "the Openference DeepSeek V4 Pro model should be selectable");
  assert.equal(model.provider, "openference");
  assert.equal(model.costClass, "free");
});

test("a configured Openference key resolves DeepSeek V4 Pro through its live upstream ID", async () => {
  const priorKey = process.env.OPENFERENCE_API_KEY;
  process.env.OPENFERENCE_API_KEY = "sk-of-test-key-for-openference-routing";
  clearClientCache();

  try {
    const resolved = await getClientForModel("openference/deepseek-v4-pro", 1);
    assert.equal(resolved.actualModelId, "DeepSeek-V4-Pro");
  } finally {
    if (priorKey === undefined) delete process.env.OPENFERENCE_API_KEY;
    else process.env.OPENFERENCE_API_KEY = priorKey;
    clearClientCache();
  }
});

test("the provider health probe uses the routed Openference model ID", () => {
  assert.equal(getTestModelForProvider("openference"), "openference/deepseek-v4-pro");
});

test("Openference only paces request starts, so a stalled completion does not block the next start", async () => {
  const gate = createOpenferenceStartGate({ intervalMs: 20, queueTimeoutMs: 200 });
  await gate.waitForStart();

  const neverSettles = new Promise<void>(() => {});
  const stalledCompletion = gate.waitForStart().then(() => neverSettles);
  let secondStarted = false;
  const nextCompletion = gate.waitForStart().then(() => {
    secondStarted = true;
  });

  await nextCompletion;
  assert.equal(secondStarted, true);
  void stalledCompletion;
});

test("Openference rejects an aborted request while it is waiting for a paced start", async () => {
  const gate = createOpenferenceStartGate({ intervalMs: 100, queueTimeoutMs: 200 });
  await gate.waitForStart();

  const controller = new AbortController();
  const queuedStart = gate.waitForStart(controller.signal);
  controller.abort();

  await assert.rejects(queuedStart, /aborted/i);
});
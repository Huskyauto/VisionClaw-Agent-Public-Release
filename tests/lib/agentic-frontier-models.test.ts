import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODEL_REGISTRY, getMaxOutputTokens } from "../../server/model-registry";
import { getContextWindow } from "../../server/context-window-guard";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { MODEL_COST_PER_MILLION } from "../../server/resource-predictor";
import { storage } from "../../server/storage";
import { getAvailableModels, getClientForModel } from "../../server/providers";

const additions = [
  { id: "moonshotai/kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
  { id: "mistralai/mistral-large-4-0", label: "Mistral Large 4" },
];

test("Kimi K3.1 Pro and Mistral Large 4 are distinct selectable paid high-end models", () => {
  for (const expected of additions) {
    const matches = MODEL_REGISTRY.filter(model => model.id === expected.id);
    assert.equal(matches.length, 1, `${expected.label} must be registered exactly once`);
    const model = matches[0];
    assert.equal(model.label, expected.label);
    assert.equal(model.provider, "openrouter");
    assert.equal(model.tier, "powerful");
    assert.equal(model.costClass, "paid");
    for (const capability of ["vision", "code", "tools"] as const) {
      assert.ok(model.capabilities?.includes(capability), `${expected.label}: ${capability}`);
    }
    assert.match(model.description, /not.*default/i);
    assert.equal(getMaxOutputTokens(model.id), 32768, "use a bounded operational output allowance");
  }
  assert.ok(MODEL_REGISTRY.some(model => model.id === "moonshotai/kimi-k3"));
  assert.ok(MODEL_REGISTRY.some(model => model.id === "mistralai/mistral-large"));
});

test("Both high-end additions have verified context and consistent paid usage estimates", () => {
  const cases = [
    { id: "moonshotai/kimi-k3.1-pro", input: 2, output: 10, cached: 0.20 },
    { id: "mistralai/mistral-large-4-0", input: 1.36, output: 4.18, cached: 0.14 },
  ];
  const insightsSource = readFileSync(new URL("../../server/insights-engine.ts", import.meta.url), "utf8");
  for (const model of cases) {
    assert.equal(getContextWindow(model.id), 1_048_576);
    assert.deepEqual(MODEL_COST_PER_MILLION[model.id], { input: model.input, output: model.output });
    assert.ok(Math.abs(estimateCostUsd(model.id, 1_000_000, 1_000_000) - model.input - model.output) < 1e-10);
    assert.ok(Math.abs(estimateCostUsd(model.id, 1_000_000, 0, 1_000_000) - model.cached) < 1e-10);
    assert.equal(estimateCostUsd(model.id, 0, 0), 0);
    const entry = `["${model.id}", { in: ${model.input}, out: ${model.output} }]`;
    assert.ok(insightsSource.includes(entry), `${model.id}: usage insights must use the same prices`);
  }
  assert.ok(
    insightsSource.indexOf('["moonshotai/kimi-k3.1-pro"') < insightsSource.indexOf('["moonshotai/kimi-k3"'),
    "more specific K3.1 price must precede the K3 prefix",
  );
});

test("Discovery and resolver preserve exact identities without bypassing free-only policy", async (t) => {
  const providerKey = { id: 1, provider: "openrouter", apiKey: "sk-or-offline-test-only", enabled: true };
  t.mock.method(storage, "getProviderKeys", async () => [providerKey]);
  t.mock.method(storage, "getProviderKey", async () => providerKey);
  t.mock.method(storage, "getTenantProviderKey", async () => null);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Offline model registration test must never call a provider");
  });
  const available = await getAvailableModels();
  for (const model of additions) {
    assert.ok(available.some(entry => entry.id === model.id), `${model.label}: agent discovery`);
    const allowed = await getClientForModel(model.id, 1, { requiresTools: true, meteredOverride: true });
    assert.equal(allowed.actualModelId, model.id, "authorized paid route must not serve an older alias");
    assert.ok(allowed.client.chat.completions.create, "existing tool-capable completion interface");
    const freeOnly = await getClientForModel(model.id, 1, { requiresTools: true, allowMeteredFallback: false });
    assert.equal(freeOnly.actualModelId, "gpt-5.4", "free-only execution must keep the existing substitution");
  }
});

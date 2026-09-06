import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { MODEL_REGISTRY } from "../../server/model-registry";
import {
  clearClientCache,
  getClientForModel,
  getMaxOutputTokens,
  getModelForTierAsync,
  getUnhealthyProviders,
  providerLaneCanServeModel,
  resetProviderHealth,
  wrapProfundoFailureMarking,
} from "../../server/providers";
import { getContextWindow } from "../../server/context-window-guard";

const PROFUNDO_MODELS = [
  { registryId: "gpt-5.6-luna", upstreamId: "gpt-5.6-luna", capability: "vision" },
  { registryId: "minimax/minimax-m3", upstreamId: "minimax-m3", capability: "vision" },
  { registryId: "xiaomi/mimo-v2.5-pro", upstreamId: "mimo-v2.5-pro", capability: "code" },
  { registryId: "z-ai/glm-4.7-flash", upstreamId: "glm-4.7-flash", capability: "code" },
] as const;

test("all paid Profundo models are registered with their required capabilities", () => {
  for (const expected of PROFUNDO_MODELS) {
    const model = MODEL_REGISTRY.find((entry) => entry.id === expected.registryId);
    assert.ok(model, `${expected.registryId} must be registered`);
    assert.equal(model.costClass, "free", `${expected.registryId} must be free at the margin`);
    assert.ok(
      model.capabilities?.includes(expected.capability),
      `${expected.registryId} must advertise ${expected.capability}`,
    );
  }
});

test("auto-tier routing prefers Profundo models only in their matching tiers", async () => {
  const priorKey = process.env.PROFUNDO_API_KEY;
  process.env.PROFUNDO_API_KEY = "sk-profundo-test-key-with-whitespace \n";
  resetProviderHealth("profundo");

  try {
    assert.equal(await getModelForTierAsync("fast"), "z-ai/glm-4.7-flash");
    assert.equal(await getModelForTierAsync("powerful"), "gpt-5.6-luna");
    assert.equal(await getModelForTierAsync("reasoning"), "xiaomi/mimo-v2.5-pro");
    assert.equal(
      await getModelForTierAsync("fast", undefined, { freeTierOnly: true }),
      "z-ai/glm-4.7-flash",
    );

    for (const tier of ["fast", "powerful", "reasoning"] as const) {
      const selectedId = await getModelForTierAsync(tier);
      assert.equal(MODEL_REGISTRY.find((model) => model.id === selectedId)?.tier, tier);
    }
  } finally {
    if (priorKey === undefined) delete process.env.PROFUNDO_API_KEY;
    else process.env.PROFUNDO_API_KEY = priorKey;
    resetProviderHealth("profundo");
  }
});

test("MiMo V2.5 Pro uses its published one-million-token context and 128K output limits", () => {
  assert.equal(getContextWindow("xiaomi/mimo-v2.5-pro"), 1_000_000);
  assert.equal(getMaxOutputTokens("xiaomi/mimo-v2.5-pro"), 131_072);
  assert.equal(
    MODEL_REGISTRY.find((model) => model.id === "xiaomi/mimo-v2.5-pro")?.tier,
    "reasoning",
  );
});

test("all paid Profundo models resolve to their bare upstream catalog ids", async () => {
  const priorKey = process.env.PROFUNDO_API_KEY;
  process.env.PROFUNDO_API_KEY = "sk-profundo-test-key-with-whitespace \n";
  clearClientCache();
  resetProviderHealth("profundo");

  try {
    for (const expected of PROFUNDO_MODELS) {
      assert.equal(providerLaneCanServeModel("profundo", expected.registryId), true);
      const resolved = await getClientForModel(expected.registryId, 1, { providerLane: "profundo" });
      assert.equal(resolved.actualModelId, expected.upstreamId);
      assert.equal(resolved.client.timeout, 90_000);
      assert.equal(resolved.client.maxRetries, 0);
    }
  } finally {
    if (priorKey === undefined) delete process.env.PROFUNDO_API_KEY;
    else process.env.PROFUNDO_API_KEY = priorKey;
    clearClientCache();
    resetProviderHealth("profundo");
  }
});

test("Profundo transport failures sideline the lane after the health threshold", async () => {
  const transportError = Object.assign(new Error("socket reset"), {
    name: "APIConnectionError",
    code: "ECONNRESET",
  });
  const fakeClient = {
    chat: {
      completions: {
        create: async () => {
          throw transportError;
        },
      },
    },
  } as unknown as OpenAI;
  const wrapped = wrapProfundoFailureMarking(fakeClient);
  resetProviderHealth("profundo");

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(
        () => wrapped.chat.completions.create({ model: "mimo-v2.5-pro", messages: [] }),
        /socket reset/,
      );
    }
    assert.equal(getUnhealthyProviders().has("profundo"), true);
  } finally {
    resetProviderHealth("profundo");
  }
});
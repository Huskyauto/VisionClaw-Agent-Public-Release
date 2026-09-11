import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  { registryId: "gpt-5.6-sol", upstreamId: "gpt-5.6-sol", capability: "vision" },
  { registryId: "moonshotai/kimi-k3", upstreamId: "kimi-k3", capability: "code" },
  { registryId: "claude-sonnet-5", upstreamId: "claude-sonnet-5", capability: "code" },
  { registryId: "claude-opus-4-8", upstreamId: "claude-opus-4-8", capability: "code" },
  { registryId: "claude-opus-5", upstreamId: "claude-opus-5", capability: "code" },
  { registryId: "claude-fable-5", upstreamId: "claude-fable-5", capability: "code" },
] as const;

const RETIRED_PROFUNDO_REGISTRY_IDS = [
  "z-ai/glm-5.2",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "deepseek/deepseek-v4-flash",
  "z-ai/glm-4.7-flash",
  "x-ai/grok-4.5",
  "google/gemma-4-31b-it",
  "gpt-5.6-terra",
  "gpt-5.5",
  "gpt-5.3-codex-spark",
  "claude-haiku-4-5",
  "minimax/minimax-m3",
  "xiaomi/mimo-v2.5-pro",
  "qwen/qwen3.6-plus",
  "mistralai/mistral-large",
  "moonshotai/kimi-k2.7-code",
] as const;

test("all surviving Profundo models are registered with their required capabilities", () => {
  for (const expected of PROFUNDO_MODELS) {
    const model = MODEL_REGISTRY.find((entry) => entry.id === expected.registryId);
    assert.ok(model, `${expected.registryId} must be registered`);
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
    assert.equal(await getModelForTierAsync("powerful"), "gpt-5.6-luna");
    const selectedId = await getModelForTierAsync("powerful");
    assert.equal(MODEL_REGISTRY.find((model) => model.id === selectedId)?.tier, "powerful");
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

test("retired Profundo models cannot be selected on the Profundo lane", () => {
  for (const modelId of RETIRED_PROFUNDO_REGISTRY_IDS) {
    assert.equal(
      providerLaneCanServeModel("profundo", modelId),
      false,
      `${modelId} must not route to Profundo after retirement`,
    );
  }
});

test("retired Profundo models no longer advertise the retired flat-rate route", () => {
  for (const modelId of RETIRED_PROFUNDO_REGISTRY_IDS) {
    const model = MODEL_REGISTRY.find((entry) => entry.id === modelId);
    if (!model) continue;
    assert.doesNotMatch(model.description, /Profundo/i, `${modelId} has stale Profundo copy`);
    assert.notEqual(model.costClass, "free", `${modelId} must not remain free solely through Profundo`);
  }
});

test("active agent guidance does not teach retired Profundo routes", () => {
  const activeGuidance = [
    readFileSync("data/output-skills/wedge-smart-leads-sop.md", "utf8"),
    readFileSync(".agents/memory/zai-direct-lane.md", "utf8"),
    readFileSync("server/lib/deliverable-ensemble.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(activeGuidance, /glm-5\.2 stays on Profundo|glm-5\.2.{0,40}Profundo flat lane/is);
  assert.doesNotMatch(activeGuidance, /Profundo flat-lane frontier trio/i);
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
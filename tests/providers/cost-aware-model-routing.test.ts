import assert from "node:assert/strict";
import test from "node:test";

import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { MODEL_REGISTRY } from "../../server/model-registry";
import {
  getModelForTierAsync,
  markProviderUnhealthy,
  resetProviderHealth,
} from "../../server/providers";
import { storage } from "../../server/storage";

const ENV_NAMES = [
  "PROFUNDO_API_KEY",
  "OPENFERENCE_API_KEY",
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "ALLOW_METERED_LLM",
] as const;

function preserveEnv() {
  return new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
}

function restoreEnv(original: Map<string, string | undefined>) {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("GPT-6 Luna and Sol are explicit paid OpenAI models", () => {
  const luna = MODEL_REGISTRY.find((model) => model.id === "gpt-6-luna");
  const sol = MODEL_REGISTRY.find((model) => model.id === "gpt-6-sol");

  assert.ok(luna);
  assert.ok(sol);
  assert.equal(luna.provider, "openai");
  assert.equal(sol.provider, "openai");
  assert.equal(luna.costClass, "cheap");
  assert.equal(sol.costClass, "paid");
  assert.ok(luna.capabilities?.includes("tools"));
  assert.ok(sol.capabilities?.includes("tools"));
});

test("GPT-6 Luna and Sol accounting uses official standard, cached, and long-context rates", () => {
  assert.equal(estimateCostUsd("gpt-6-luna", 100_000, 100_000), 0.06);
  assert.equal(estimateCostUsd("gpt-6-luna", 100_000, 0, 100_000), 0.001);
  assert.equal(estimateCostUsd("gpt-6-luna", 300_000, 10_000), 0.0675);

  assert.equal(estimateCostUsd("gpt-6-sol", 100_000, 100_000), 1.2);
  assert.equal(estimateCostUsd("gpt-6-sol", 100_000, 0, 100_000), 0.02);
  assert.equal(estimateCostUsd("gpt-6-sol", 300_000, 10_000), 1.35);
});

test("Profundo flat-rate models are preferred by workload tier", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const originalEnv = preserveEnv();
  storage.getProviderKeys = async () => [] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  process.env.PROFUNDO_API_KEY = "p".repeat(24);
  delete process.env.OPENFERENCE_API_KEY;

  try {
    assert.equal(await getModelForTierAsync("fast"), "gpt-5.6-luna");
    assert.equal(await getModelForTierAsync("balanced"), "gpt-5.6-luna");
    assert.equal(await getModelForTierAsync("powerful"), "gpt-5.6-sol");
    assert.equal(await getModelForTierAsync("reasoning"), "gpt-5.6-sol");
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    restoreEnv(originalEnv);
    resetProviderHealth("profundo");
  }
});

test("zero-marginal routes win before GPT-6 Luna metered fallback", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const originalEnv = preserveEnv();
  storage.getProviderKeys = async () => [{
    id: 1,
    provider: "openai",
    apiKey: "test-openai-key",
    enabled: true,
  }] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  delete process.env.PROFUNDO_API_KEY;
  delete process.env.OPENFERENCE_API_KEY;
  process.env.ALLOW_METERED_LLM = "1";

  try {
    assert.equal(await getModelForTierAsync("powerful"), "gpt-5.4");

    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("replit", "test zero-marginal outage");
    }
    assert.equal(
      await getModelForTierAsync("powerful", 1, { allowMeteredFallback: true }),
      "gpt-6-luna",
    );
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    restoreEnv(originalEnv);
    resetProviderHealth("replit");
    resetProviderHealth("openai");
  }
});

test("metered fallback stays disabled when the cost guard is off", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const originalEnv = preserveEnv();
  storage.getProviderKeys = async () => [{
    id: 1,
    provider: "openai",
    apiKey: "test-openai-key",
    enabled: true,
  }] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  delete process.env.PROFUNDO_API_KEY;
  delete process.env.OPENFERENCE_API_KEY;
  process.env.ALLOW_METERED_LLM = "0";

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("replit", "test zero-marginal outage");
    }
    await assert.rejects(
      getModelForTierAsync("powerful", 1, { allowMeteredFallback: true }),
      /no healthy authorized model lane/,
    );
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    restoreEnv(originalEnv);
    resetProviderHealth("replit");
    resetProviderHealth("openai");
  }
});

test("global paid credentials never authorize another tenant's automatic fallback", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const originalGetTenantProviderKey = storage.getTenantProviderKey.bind(storage);
  const originalEnv = preserveEnv();
  storage.getProviderKeys = async () => [{
    id: 1,
    provider: "openai",
    apiKey: "test-owner-openai-key",
    enabled: true,
  }] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  storage.getTenantProviderKey = async () => null;
  delete process.env.PROFUNDO_API_KEY;
  delete process.env.OPENFERENCE_API_KEY;
  process.env.ALLOW_METERED_LLM = "1";

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("replit", "test tenant isolation");
    }
    await assert.rejects(
      getModelForTierAsync("powerful", 2, { allowMeteredFallback: true }),
      /no healthy authorized model lane/,
    );
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    storage.getTenantProviderKey = originalGetTenantProviderKey;
    restoreEnv(originalEnv);
    resetProviderHealth("replit");
    resetProviderHealth("openai");
  }
});
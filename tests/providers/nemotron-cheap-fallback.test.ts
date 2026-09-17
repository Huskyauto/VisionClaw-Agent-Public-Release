import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { storage } from "../../server/storage";
import {
  getClientForModel,
  getModelForTierAsync,
  isProviderHealthy,
  markProviderUnhealthy,
  resetProviderHealth,
} from "../../server/providers";

const NEMOTRON = "nvidia/nemotron-3-super-120b-a12b";

function tierBlock(source: string, tier: "powerful" | "reasoning", nextTier?: string): string {
  const start = source.indexOf(`    ${tier}: [`);
  assert.ok(start >= 0, `${tier} tier exists`);
  const end = nextTier
    ? source.indexOf(`    ${nextTier}: [`, start)
    : source.indexOf("\n    ],\n  };", start);
  assert.ok(end > start, `${tier} tier end exists`);
  return source.slice(start, end);
}

test("Nemotron 3 Super is the first paid OpenRouter fallback for capable tiers", () => {
  const source = readFileSync("server/providers.ts", "utf8");
  const powerful = tierBlock(source, "powerful", "reasoning");
  const reasoning = tierBlock(source, "reasoning");

  for (const [tier, block] of [["powerful", powerful], ["reasoning", reasoning]] as const) {
    const nemotronIndex = block.indexOf(`model: "${NEMOTRON}"`);
    const priorPaidOpenRouter = block
      .slice(0, nemotronIndex)
      .match(/\{ provider: "openrouter", model: "(?![^"]+:free")[^"]+" \}/);

    assert.ok(nemotronIndex >= 0, `${tier} tier includes Nemotron 3 Super`);
    assert.strictEqual(
      priorPaidOpenRouter,
      null,
      `${tier} tier must prefer Nemotron before other paid OpenRouter fallbacks`,
    );
  }
});

test("tier routing skips Nemotron while OpenRouter is unhealthy", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const integrationEnvNames = [
    "PROFUNDO_API_KEY",
    "OPENFERENCE_API_KEY",
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
    "AI_INTEGRATIONS_GEMINI_API_KEY",
    "AI_INTEGRATIONS_GEMINI_BASE_URL",
  ] as const;
  const originalIntegrationEnv = new Map(
    integrationEnvNames.map((name) => [name, process.env[name]]),
  );
  storage.getProviderKeys = async () => [{
    id: 1,
    provider: "openrouter",
    apiKey: "test-key",
    enabled: true,
  }] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  for (const name of integrationEnvNames) delete process.env[name];

  try {
    assert.strictEqual(isProviderHealthy("openrouter"), true, "test starts with a healthy OpenRouter");
    assert.strictEqual(await getModelForTierAsync("powerful"), NEMOTRON);
    assert.strictEqual(await getModelForTierAsync("reasoning"), NEMOTRON);

    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("openrouter", "test provider outage");
    }
    assert.strictEqual(await getModelForTierAsync("powerful"), "gpt-5.4");
    assert.strictEqual(await getModelForTierAsync("reasoning"), "gpt-5-mini");
    await assert.rejects(
      () => getClientForModel(NEMOTRON, undefined, { meteredOverride: true }),
      /temporarily unavailable after repeated provider failures/,
    );
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    for (const [name, value] of originalIntegrationEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetProviderHealth("openrouter");
  }
});

test("tier routing skips an unhealthy integration-backed provider", async () => {
  const originalGetProviderKeys = storage.getProviderKeys.bind(storage);
  const envNames = [
    "PROFUNDO_API_KEY",
    "OPENFERENCE_API_KEY",
    "AI_INTEGRATIONS_GEMINI_API_KEY",
    "AI_INTEGRATIONS_GEMINI_BASE_URL",
  ] as const;
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));

  storage.getProviderKeys = async () => [] as Awaited<ReturnType<typeof storage.getProviderKeys>>;
  delete process.env.PROFUNDO_API_KEY;
  delete process.env.OPENFERENCE_API_KEY;
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "test-google-integration-key";
  process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = "https://example.invalid";

  try {
    assert.strictEqual(isProviderHealthy("google"), true, "test starts with a healthy Google provider");
    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("google", "test integration outage");
    }
    assert.strictEqual(await getModelForTierAsync("powerful"), "gpt-5.4");
    assert.strictEqual(await getModelForTierAsync("reasoning"), "gpt-5-mini");
  } finally {
    storage.getProviderKeys = originalGetProviderKeys;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetProviderHealth("google");
  }
});

test("preferred OAuth resolution cannot bypass provider quarantine", async () => {
  const originalPreference = process.env.OAUTH_SUBSCRIPTION_PREFERRED;
  process.env.OAUTH_SUBSCRIPTION_PREFERRED = "1";

  try {
    assert.strictEqual(isProviderHealthy("openai"), true, "test starts with a healthy OpenAI provider");
    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("openai", "test OAuth transport outage");
    }

    await assert.rejects(
      () => getClientForModel("gpt-4.1-mini", undefined, { meteredOverride: true }),
      /OpenAI is temporarily unavailable after repeated provider failures/,
    );
  } finally {
    if (originalPreference === undefined) delete process.env.OAUTH_SUBSCRIPTION_PREFERRED;
    else process.env.OAUTH_SUBSCRIPTION_PREFERRED = originalPreference;
    resetProviderHealth("openai");
  }
});
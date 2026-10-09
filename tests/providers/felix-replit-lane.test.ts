import assert from "node:assert/strict";
import test from "node:test";
import { getClientForModel, providerLaneCanServeModel } from "../../server/providers";

test("Replit pin is exact, bypasses external routes, and fails closed even with paid routing enabled", async () => {
  const names = ["AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL", "ALLOW_METERED_LLM"] as const;
  const original = new Map(names.map(name => [name, process.env[name]]));
  const options = { providerLane: "replit" as const, requiresTools: true, forbidMeteredFallback: true };
  try {
    // Construction only: no HTTP/inference requests, real credentials, or DB writes.
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "construction-only-fake-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://replit-test.invalid/v1";
    process.env.ALLOW_METERED_LLM = "true";
    assert.equal(providerLaneCanServeModel("replit", "gpt-5.4"), true);
    assert.equal(providerLaneCanServeModel("replit", "gpt-5.6-sol"), false);
    const route = await getClientForModel("gpt-5.4", 1, options);
    assert.equal(route.actualModelId, "gpt-5.4");
    assert.equal(route.client.baseURL, "https://replit-test.invalid/v1");
    await assert.rejects(getClientForModel("gpt-5.6-sol", 1, options), /cannot serve/);
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    await assert.rejects(getClientForModel("gpt-5.4", 1, options), /unavailable.*external fallback forbidden/);
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "construction-only-fake-key";
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    await assert.rejects(getClientForModel("gpt-5.4", 1, options), /unavailable.*external fallback forbidden/);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
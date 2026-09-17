import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackgroundCompletion,
  clearClientCache,
  getClientForModel,
  isProviderHealthy,
  markProviderUnhealthy,
  resetProviderHealth,
} from "../../server/providers";

function client(create: (params: any) => Promise<any>): any {
  return { chat: { completions: { create } } };
}

test("a first transient Profundo failure retries once through the re-resolved zero-cost route", async () => {
  resetProviderHealth("profundo");
  resetProviderHealth("openference");
  const calls: string[] = [];
  const resolutions: Array<{
    modelId: string;
    tenantId?: number;
    forbidMeteredFallback?: boolean;
  }> = [];
  const resolve = async (
    modelId: string,
    tenantId?: number,
    resolverOptions?: { forbidMeteredFallback?: boolean },
  ) => {
    resolutions.push({
      modelId,
      tenantId,
      forbidMeteredFallback: resolverOptions?.forbidMeteredFallback,
    });
    if (calls.length === 0) {
      return {
        route: "profundo" as const,
        actualModelId: "gpt-5.6-sol",
        client: client(async () => {
          calls.push("profundo");
          throw Object.assign(new Error("fair-use pacing"), { status: 429 });
        }),
      };
    }
    return {
      route: "replit" as const,
      actualModelId: "gpt-5.4",
      client: client(async (params) => {
        calls.push(`fallback:${params.model}`);
        assert.equal(params.messages[0].content, "keep context");
        return { choices: [{ message: { content: "recovered" } }] };
      }),
    };
  };

  try {
    const result = await createBackgroundCompletion(
      { model: "gpt-5.6-sol", messages: [{ role: "user", content: "keep context" }] },
      { tenantId: 7, resolve },
    );
    assert.equal(result.choices[0].message.content, "recovered");
    assert.deepEqual(calls, ["profundo", "fallback:gpt-5.4"]);
    assert.deepEqual(resolutions, [
      { modelId: "gpt-5.6-sol", tenantId: 7, forbidMeteredFallback: undefined },
      { modelId: "gpt-5.4", tenantId: 7, forbidMeteredFallback: true },
    ]);
    assert.equal(isProviderHealthy("profundo"), false);
    assert.equal(isProviderHealthy("openference"), true);
  } finally {
    resetProviderHealth("profundo");
    resetProviderHealth("openference");
  }
});

test("a failed fallback is returned directly without a third resolution or retry", async () => {
  resetProviderHealth("profundo");
  let resolutions = 0;
  const fallbackError = Object.assign(new Error("fallback unavailable"), { status: 503 });
  const resolve = async () => {
    resolutions++;
    if (resolutions === 1) {
      return {
        route: "profundo" as const,
        actualModelId: "glm-5.2",
        client: client(async () => {
          throw Object.assign(new Error("Profundo unavailable"), { status: 502 });
        }),
      };
    }
    return {
      route: "replit" as const,
      actualModelId: "gpt-5.4",
      client: client(async () => { throw fallbackError; }),
    };
  };

  await assert.rejects(
    () => createBackgroundCompletion({ model: "z-ai/glm-5.2", messages: [] }, { tenantId: 3, resolve }),
    (error) => error === fallbackError,
  );
  assert.equal(resolutions, 2);
  resetProviderHealth("profundo");
});

test("Profundo authentication failures stay explicit and are never retried", async () => {
  resetProviderHealth("profundo");
  let resolutions = 0;
  const authError = Object.assign(new Error("invalid credential"), { status: 401 });
  const resolve = async () => {
    resolutions++;
    return {
      route: "profundo" as const,
      actualModelId: "gpt-5.6-sol",
      client: client(async () => { throw authError; }),
    };
  };

  await assert.rejects(
    () => createBackgroundCompletion({ model: "gpt-5.6-sol", messages: [] }, { tenantId: 1, resolve }),
    (error) => error === authError,
  );
  assert.equal(resolutions, 1);
  resetProviderHealth("profundo");
});

test("the free-only resolver floor blocks metered fallback even when globally enabled", async () => {
  const priorMetered = process.env.ALLOW_METERED_LLM;
  const priorReplitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const priorReplitBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const priorOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.ALLOW_METERED_LLM = "true";
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-metered-test-key-that-must-not-be-used";
  clearClientCache();

  try {
    await assert.rejects(
      () => getClientForModel("gpt-5.4", 1, { forbidMeteredFallback: true }),
      /metered fallback forbidden/,
    );
  } finally {
    if (priorMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = priorMetered;
    if (priorReplitKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = priorReplitKey;
    if (priorReplitBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = priorReplitBaseUrl;
    if (priorOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAiKey;
    clearClientCache();
  }
});

test("a Profundo-selected model cannot become a metered fallback from the global switch alone", async () => {
  const priorProfundoKey = process.env.PROFUNDO_API_KEY;
  const priorMetered = process.env.ALLOW_METERED_LLM;
  const priorReplitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const priorReplitBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const priorOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.PROFUNDO_API_KEY = "sk-profundo-test-key-for-cost-floor";
  process.env.ALLOW_METERED_LLM = "true";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-replit-test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  process.env.OPENAI_API_KEY = "sk-metered-test-key-that-must-not-be-used";
  clearClientCache();
  resetProviderHealth("profundo");

  try {
    for (let i = 0; i < 3; i++) markProviderUnhealthy("profundo", "test unavailable");
    const resolved = await getClientForModel("gpt-5.6-sol", 1);
    assert.equal(resolved.actualModelId, "gpt-5.4");
  } finally {
    if (priorProfundoKey === undefined) delete process.env.PROFUNDO_API_KEY;
    else process.env.PROFUNDO_API_KEY = priorProfundoKey;
    if (priorMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = priorMetered;
    if (priorReplitKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = priorReplitKey;
    if (priorReplitBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = priorReplitBaseUrl;
    if (priorOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAiKey;
    clearClientCache();
    resetProviderHealth("profundo");
  }
});

test("later routing honors Profundo's health window and resumes normally after recovery", async () => {
  const priorProfundoKey = process.env.PROFUNDO_API_KEY;
  const priorMetered = process.env.ALLOW_METERED_LLM;
  resetProviderHealth("profundo");
  resetProviderHealth("openference");
  process.env.PROFUNDO_API_KEY = "sk-profundo-test-key-for-background-recovery";
  delete process.env.ALLOW_METERED_LLM;
  clearClientCache();
  const realNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    let resolutions = 0;
    await createBackgroundCompletion(
      { model: "gpt-5.6-sol", messages: [] },
      {
        tenantId: 1,
        resolve: async () => {
          resolutions++;
          return resolutions === 1
            ? {
                route: "profundo",
                actualModelId: "gpt-5.6-sol",
                client: client(async () => {
                  throw Object.assign(new Error("temporary outage"), { status: 503 });
                }),
              }
            : {
                route: "replit",
                actualModelId: "gpt-5.4",
                client: client(async () => ({ choices: [{ message: { content: "ok" } }] })),
              };
        },
      },
    );
    assert.equal(isProviderHealthy("profundo"), false);
    assert.equal(isProviderHealthy("openference"), true);
    const duringWindow = await getClientForModel("gpt-5.6-sol", 1);
    assert.equal(duringWindow.actualModelId, "gpt-5.4");
    now += 300_001;
    const afterRecovery = await getClientForModel("gpt-5.6-sol", 1);
    assert.equal(afterRecovery.actualModelId, "gpt-5.6-sol");
  } finally {
    Date.now = realNow;
    resetProviderHealth("profundo");
    resetProviderHealth("openference");
    if (priorProfundoKey === undefined) delete process.env.PROFUNDO_API_KEY;
    else process.env.PROFUNDO_API_KEY = priorProfundoKey;
    if (priorMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = priorMetered;
    clearClientCache();
  }
});
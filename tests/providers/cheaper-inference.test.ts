import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "esbuild";
import { MODEL_REGISTRY, isOwnerOnlyFinalDecisionModel } from "../../server/model-registry";
import {
  assertCheaperInferenceAccess,
  CHEAPER_INFERENCE_MODEL_ID,
  guardCheaperInferenceRequest,
  cheaperInferenceCostFields,
} from "../../server/lib/cheaper-inference";
import { cheaperRequestMaximum, catalogUsageCost, chooseCheaperAutomaticLuna,
  CHEAPER_LUNA_6_UPSTREAM } from "../../server/lib/cheaper-inference-automatic";

test("CheaperInference requires explicit verified owner selection and an enabled secret", () => {
  const env = { CHEAPER_INFERENCE_API_KEY: "fixture-not-a-real-key" };
  const grant = { explicitOwnerSelection: true, platformAdminVerified: true };
  assert.doesNotThrow(() => assertCheaperInferenceAccess(1, grant, env));
  for (const tenant of [undefined, null, 0, 2, "1", NaN, Infinity]) {
    assert.throws(() => assertCheaperInferenceAccess(tenant as number, grant, env));
  }
  for (const options of [{}, { explicitOwnerSelection: true }, { platformAdminVerified: true }]) {
    assert.throws(() => assertCheaperInferenceAccess(1, options, env));
  }
  assert.throws(() => assertCheaperInferenceAccess(1, grant, {}));
  assert.throws(() => assertCheaperInferenceAccess(1, grant, {
    ...env, CHEAPER_INFERENCE_ENABLED: "0",
  }));
  assert.equal(CHEAPER_INFERENCE_MODEL_ID, "cheaperinference/gpt-5.6-luna");
});

test("CheaperInference accounting uses its receipt, or explicit current token rates, never flat-rate zero", () => {
  assert.deepEqual(cheaperInferenceCostFields("llm.cheaperinference", {
    cost: 0.000003, prompt_tokens: 11, completion_tokens: 5,
  }), { costUsd: 0.000003 });
  assert.deepEqual(cheaperInferenceCostFields("llm.profundo", { cost: 1 }), {});
  assert.deepEqual(cheaperInferenceCostFields("llm.cheaperinference", {
    cost: "0", prompt_tokens: 100_000, completion_tokens: 100_000,
  }), { costUsd: 0.056 });
  assert.deepEqual(cheaperInferenceCostFields("llm.cheaperinference", {
    prompt_tokens: 100_000, completion_tokens: 0,
    prompt_tokens_details: { cached_tokens: 100_000 },
  }), { costUsd: 0.0008 });
  assert.deepEqual(cheaperInferenceCostFields("llm.cheaperinference", {
    prompt_tokens: 300_000, completion_tokens: 10_000,
  }), { costUsd: 0.0552 });
  assert.throws(() => cheaperInferenceCostFields("llm.cheaperinference", {
    cost: -1, prompt_tokens: "11", completion_tokens: 5,
  }));
});

function providerFunction(name: string, globals: Record<string, unknown>) {
  const source = readFileSync("server/providers.ts", "utf8");
  const ast = ts.createSourceFile("providers.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node);
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(`${node.getText(ast).replace(/^export\s+/, "")}\nexport { ${name} };`, {
    loader: "ts", format: "cjs", target: "node22",
  }).code, {
    module, exports: module.exports, console,
    process: { env: {} }, CHEAPER_LUNA_6_UPSTREAM,
    FABLE_52_MODEL: "claude-fable-5-2", CARBON_MODEL: "gemini-4-carbon",
    isGpt62Model: () => false, carbonReady: () => false, metaReady: () => false,
    mammouthReady: () => false, metaPrimaryAllowed: () => false,
    ...globals,
  });
  return module.exports[name];
}

test("real accounting wrapper records CheaperInference receipts for buffered and streamed completions", async () => {
  const build = providerFunction("buildPatchedCreate", {
    normalizeRetiredModelId: (id: string) => id, cheaperInferenceCostFields,
    extractUsageTokens: providerFunction("extractUsageTokens", {}),
    COST_LEDGER_RECORDED: Symbol.for("visionclaw.cost-ledger-recorded"), logSilentCatch() {},
  });
  const usage = { prompt_tokens: 11, completion_tokens: 5, cost: 0.000003 };
  for (const stream of [false, true]) {
    const rows: any[] = [];
    const create = build(async (params: any, options: any) => {
      assert.equal(options.maxRetries, 0);
      if (!stream) return { choices: [], usage };
      assert.equal(params.stream_options.include_usage, true);
      return (async function* () {
        yield { choices: [{ delta: { content: "OK" } }] };
        yield { choices: [], usage };
      })();
    }, () => "gpt-5.6-luna", () => 1, "llm.cheaperinference", async (row: any) => {
      rows.push(row); return true;
    });
    const result = await create({ model: "gpt-5.6-luna", stream }, { maxRetries: 0 });
    if (stream) for await (const _ of result) { /* consume final usage */ }
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenantId, 1);
    assert.equal(rows[0].costUsd, 0.000003);
    assert.equal(rows[0].toolName, "llm.cheaperinference");
    assert.equal(rows[0].tokensIn, 11);
    assert.equal(rows[0].tokensOut, 5);
  }
});

test("CheaperInference catalog is owner-only and excluded from unscoped automatic catalogs", async () => {
  const globals = {
    storage: { getProviderKeys: async () => [{ provider: "cheaperinference", enabled: true }],
      getTenantProviderKey: async () => undefined },
    hasOpenferenceKey: () => false, cheaperInferenceReady: () => true,
    mammouthReady: () => false,
    INTEGRATION_ENV: {}, SUBSCRIPTION_BASE_URLS: {}, MODEL_REGISTRY,
    RETIRED_MODEL_IDS: new Set(), isSyntheticEvaluationModel: () => false,
    isOwnerOnlyFinalDecisionModel,
    getCheaperCatalog: async () => [{ id: CHEAPER_LUNA_6_UPSTREAM, endpoint: "/v1/chat/completions", discount: 35 }],
  };
  const catalog = providerFunction("getAvailableModelsForTenant", globals);
  const automatic = providerFunction("getAvailableModels", globals);
  assert.ok((await catalog(1, true)).some((m: any) => m.id === CHEAPER_INFERENCE_MODEL_ID));
  assert.ok((await catalog(1, true)).some((m: any) => m.id === "cheaperinference/gpt-6-luna"));
  for (const [tenant, admin] of [[1, false], [2, false], [2, true]]) {
    assert.equal((await catalog(tenant, admin)).some((m: any) => m.id === CHEAPER_INFERENCE_MODEL_ID), false);
    assert.equal((await catalog(tenant, admin)).some((m: any) => m.id === "cheaperinference/gpt-6-luna"), false);
  }
  assert.equal((await automatic()).some((m: any) => m.id === CHEAPER_INFERENCE_MODEL_ID), false);
  const tiers = readFileSync("data/model-tiers.json", "utf8");
  assert.equal(tiers.includes(CHEAPER_INFERENCE_MODEL_ID), false);
});

test("tier routing keeps free first, then owner CheaperInference; free-only and foreign scopes fail closed", async () => {
  let freeHealthy = true;
  let cooldown = false;
  let discount = 60;
  let minimumDiscount = 40;
  let openferenceAvailable = false;
  let healthyOpenferenceModel = "";
  const env: Record<string, string> = {
    AI_INTEGRATIONS_OPENAI_API_KEY: "fixture", AI_INTEGRATIONS_OPENAI_BASE_URL: "fixture",
  };
  let candidate = { id: "gpt-6-luna", type: "text", endpoint: "/v1/chat/completions", discount: 34.5,
    input: 0.0655, output: 0.3275, maximumInput: 0.40, maximumOutput: 1.50 };
  const tier = providerFunction("getModelForTierAsync", {
    process: { env },
    currentTenantId: () => null,
    getProfundoKey: () => null, providerLaneCanServeModel: () => false,
    storage: { getProviderKeys: async () => [] }, hasOpenferenceKey: () => openferenceAvailable,
    OPENFERENCE_MODEL_MAP: {
      "openference/deepseek-v4-pro": "DeepSeek-V4-Pro", "openference/kimi-k3": "Kimi K3",
      "openference/glm-5.3": "GLM-5.3", "openference/qwen3.8-27b": "Qwen3.8 27b",
    },
    SUBSCRIPTION_BASE_URLS: {}, logAutoRoute() {}, isClaudeRunnerAvailable: () => false,
    isProviderHealthy: (p: string) => p === "cheaperinference" || (p === "replit" && freeHealthy) ||
      (p === "openference" && openferenceAvailable) ||
      (!!healthyOpenferenceModel && p === `openference:model:${healthyOpenferenceModel}`),
    mapReplitToOpenAI: (id: string) => id, hasIntegrationFallback: () => false,
    cheaperAutomaticAllowed: (tenant: number) => tenant === 1,
    replitCooldownActive: async () => cooldown,
    cheaperMinimumDiscount: () => minimumDiscount,
    chooseCheaperAutomaticLuna: (
      entries: Parameters<typeof chooseCheaperAutomaticLuna>[0],
      routeTier: Parameters<typeof chooseCheaperAutomaticLuna>[1], floor: number,
    ) => chooseCheaperAutomaticLuna(entries, routeTier, floor, env),
    getCheaperCatalog: async () => [{ id: "gpt-5.6-luna", type: "text", endpoint: "/v1/chat/completions",
      discount, input: 0.08, output: 0.48, maximumInput: 0.8, maximumOutput: 3.6 }, candidate],
    meteredLlmEnabled: () => false,
  });
  assert.equal(await tier("balanced", 1), "gpt-5.4");
  cooldown = true;
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID,
    "a persisted Replit cooldown must advance routing even before in-memory health changes");
  await assert.rejects(tier("balanced", 1, { allowMeteredFallback: false }));
  await assert.rejects(tier("balanced", 1, { freeTierOnly: true }));
  cooldown = false;
  freeHealthy = false;
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  await assert.rejects(tier("balanced", 2));
  await assert.rejects(tier("balanced", 1, { freeTierOnly: true }));
  await assert.rejects(tier("balanced", 1, { allowMeteredFallback: false }));
  discount = 39;
  await assert.rejects(tier("balanced", 1));
  minimumDiscount = 15;
  discount = 15;
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  env.CHEAPER_INFERENCE_PREFER_GPT6_LUNA = "true";
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  env.CHEAPER_INFERENCE_PREFER_GPT6_LUNA = "1";
  assert.equal(await tier("fast", 1), "cheaperinference/gpt-6-luna");
  assert.equal(await tier("balanced", 1), "cheaperinference/gpt-6-luna");
  assert.equal(await tier("powerful", 1), CHEAPER_INFERENCE_MODEL_ID);
  assert.equal(await tier("reasoning", 1), CHEAPER_INFERENCE_MODEL_ID);
  await assert.rejects(tier("fast", 2));
  await assert.rejects(tier("fast", 1, { freeTierOnly: true }));
  await assert.rejects(tier("fast", 1, { allowMeteredFallback: false }));
  freeHealthy = true;
  assert.equal(await tier("fast", 1), "gpt-5.4");
  freeHealthy = false;
  candidate = { ...candidate, discount: 14.9 };
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  candidate = { ...candidate, discount: 34.5, output: 0.481 };
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  candidate = { ...candidate, output: 0.3275, maximumOutput: 3.601 };
  assert.equal(await tier("balanced", 1), CHEAPER_INFERENCE_MODEL_ID);
  delete env.CHEAPER_INFERENCE_PREFER_GPT6_LUNA;
  discount = 14;
  await assert.rejects(tier("balanced", 1));
  discount = 15;
  openferenceAvailable = true;
  assert.equal(await tier("powerful", 1), CHEAPER_INFERENCE_MODEL_ID,
    "provider health alone cannot reselect quarantined model transports");
  await assert.rejects(tier("powerful", 1, { freeTierOnly: true }));
  healthyOpenferenceModel = "Kimi K3";
  assert.equal(await tier("powerful", 1), "openference/kimi-k3",
    "a genuinely healthy model still precedes paid fallback");
});

test("Openference has an operator stop without removing its credential", () => {
  const env: Record<string, string> = { OPENFERENCE_API_KEY: "synthetic-credential-length-only" };
  const key = providerFunction("getOpenferenceKey", { process: { env } });
  const ready = providerFunction("providerLaneLocallyReady", {
    isProviderHealthy: () => true, hasOpenferenceKey: () => key() !== null,
  });
  assert.equal(key(), env.OPENFERENCE_API_KEY);
  assert.equal(ready("openference"), true);
  env.OPENFERENCE_ENABLED = "0";
  assert.equal(key(), null);
  assert.equal(ready("openference"), false);
});

test("actual closed create enforces the configured floor before reserving and dispatching", async () => {
  let discount = 15;
  const events: string[] = [];
  const entry = () => ({ id: "gpt-5.6-luna", type: "text", endpoint: "/v1/chat/completions",
    context: 8192, vision: false, input: 0.17, output: 1.02,
    maximumInput: 0.8, maximumOutput: 3.6, discount });
  const resolve = providerFunction("getClientForModel", {
    process: { env: { CHEAPER_INFERENCE_API_KEY: "synthetic-fixture" } },
    normalizeRetiredModelId: (id: string) => id, normalizeModelId: (id: string) => id, MODEL_REGISTRY: [],
    isSyntheticEvaluationModel: () => false, isOwnerOnlyFinalDecisionModel: () => false,
    currentTenantId: () => 1, assertCheaperInferenceAccess() {}, isProviderHealthy: () => true,
    getCheaperCatalog: async () => [entry()], CHEAPER_INFERENCE_BASE_URL: "https://fixture.invalid/v1",
    OpenAI: class {
      chat = { completions: { create: async (payload: any, options: any) => {
        events.push("dispatch");
        assert.equal(payload.min_discount_percent, 15);
        assert.equal(options.maxRetries, 0);
        return { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } };
      } } };
    },
    cheaperAutomaticAllowed: () => true, cheaperMinimumDiscount: () => 15,
    guardCheaperInferenceRequest, cheaperRequestMaximum, catalogUsageCost,
    buildPatchedCreate: (create: any) => create,
    runCheaperBudgeted: async (tenant: number, maximum: number, call: () => Promise<unknown>) => {
      assert.equal(tenant, 1); assert.ok(maximum > 0 && maximum < 0.1);
      events.push("reserve"); return call();
    },
  });
  const { client } = await resolve(CHEAPER_INFERENCE_MODEL_ID, 1);
  const payload = { model: "gpt-5.6-luna", messages: [{ role: "user", content: "fixture" }], max_completion_tokens: 128 };
  await client.chat.completions.create(payload);
  assert.deepEqual(events, ["reserve", "dispatch"]);
  events.length = 0; discount = 14;
  await assert.rejects(client.chat.completions.create(payload), /discount floor/);
  assert.deepEqual(events, []);
});

test("automatic GPT-6 Luna rechecks price and opt-in before spending; explicit owner selection is unchanged", async () => {
  const env = { CHEAPER_INFERENCE_API_KEY: "fixture", CHEAPER_INFERENCE_PREFER_GPT6_LUNA: "1" };
  const events: string[] = [];
  let candidateOutput = 0.33;
  let stopAfterReserve = false;
  const common = { type: "text", endpoint: "/v1/chat/completions", context: 8192, vision: false,
    input: 0.07, maximumInput: 0.4, maximumOutput: 1.5, discount: 35 };
  const resolve = providerFunction("getClientForModel", {
    process: { env }, MODEL_REGISTRY: [], normalizeModelId: (id: string) => id,
    isSyntheticEvaluationModel: () => false, isOwnerOnlyFinalDecisionModel: () => false,
    currentTenantId: () => 1, assertCheaperInferenceAccess() {}, isProviderHealthy: () => true,
    cheaperAutomaticAllowed: () => true, cheaperMinimumDiscount: () => 15,
    getCheaperCatalog: async () => [
      { ...common, id: "gpt-5.6-luna", input: 0.08, output: 0.48 },
      { ...common, id: "gpt-6-luna", output: candidateOutput },
    ],
    chooseCheaperAutomaticLuna: (
      entries: Parameters<typeof chooseCheaperAutomaticLuna>[0],
      tier: Parameters<typeof chooseCheaperAutomaticLuna>[1], floor: number,
    ) => chooseCheaperAutomaticLuna(entries, tier, floor, env),
    CHEAPER_INFERENCE_BASE_URL: "https://fixture.invalid/v1",
    OpenAI: class {
      chat = { completions: { create: async () => { events.push("dispatch"); return {}; } } };
    },
    guardCheaperInferenceRequest, cheaperRequestMaximum, catalogUsageCost,
    buildPatchedCreate: (create: any) => create,
    runCheaperBudgeted: async (_tenant: number, _max: number, call: () => Promise<unknown>,
      _cost: unknown, _deps: unknown, beforeDispatch: () => void) => {
      events.push("reserve");
      if (stopAfterReserve) env.CHEAPER_INFERENCE_PREFER_GPT6_LUNA = "0";
      beforeDispatch();
      return call();
    },
  });
  const { client } = await resolve("cheaperinference/gpt-6-luna", 1);
  const payload = { model: "gpt-6-luna", messages: [{ role: "user", content: "fixture" }], max_completion_tokens: 128 };
  candidateOutput = 0.50;
  await assert.rejects(client.chat.completions.create(payload), /not eligible/);
  assert.deepEqual(events, []);
  candidateOutput = 0.33;
  await client.chat.completions.create(payload);
  assert.deepEqual(events.splice(0), ["reserve", "dispatch"]);
  stopAfterReserve = true;
  await assert.rejects(client.chat.completions.create(payload), /not eligible/);
  assert.deepEqual(events.splice(0), ["reserve"]);
  const manual = await resolve("cheaperinference/gpt-6-luna", 1, {
    explicitOwnerSelection: true, platformAdminVerified: true,
  });
  await manual.client.chat.completions.create(payload);
  assert.deepEqual(events, ["reserve", "dispatch"]);
});

test("requests pin the upstream model and reject malformed or excessive output budgets", () => {
  const base = { model: "gpt-5.6-luna", messages: [{ role: "user", content: "Hello" }] };
  assert.equal(guardCheaperInferenceRequest(base).max_completion_tokens, 4096);
  assert.equal(guardCheaperInferenceRequest({ ...base, max_tokens: 256 }).max_completion_tokens, 256);
  assert.equal(guardCheaperInferenceRequest({ ...base, max_tokens: 256 }).max_tokens, undefined);
  assert.throws(() => guardCheaperInferenceRequest({ ...base, model: "gpt-6-astra" }));
  for (const cap of [null, "8192", 0, -1, 1.5, NaN, Infinity, 8193]) {
    assert.throws(() => guardCheaperInferenceRequest({ ...base, max_completion_tokens: cap }));
  }
  assert.throws(() => guardCheaperInferenceRequest({
    ...base, max_tokens: 128, max_completion_tokens: 256,
  }));
  assert.throws(() => guardCheaperInferenceRequest({
    ...base, reasoning: { mode: "pro" },
  }));
  assert.throws(() => guardCheaperInferenceRequest({
    ...base, messages: [{ role: "user", content: "x".repeat(512 * 1024) }],
  }));
});

test("ordinary full chat context fits while oversized UTF-8 requests remain bounded", () => {
  const base = { model: "gpt-5.4", max_completion_tokens: 128 };
  assert.doesNotThrow(() => guardCheaperInferenceRequest({
    ...base, messages: [{ role: "system", content: "s".repeat(376_367) }],
  }, "gpt-5.4"));
  assert.throws(() => guardCheaperInferenceRequest({
    ...base, messages: [{ role: "system", content: "界".repeat(180_000) }],
  }, "gpt-5.4"), /limit/);
});

test("streaming cannot opt out of usage, and multiple completions cannot multiply the output bound", () => {
  const base = { model: "gpt-5.6-luna", messages: [{ role: "user", content: "Hello" }] };
  const request = guardCheaperInferenceRequest({
    ...base, stream: true, stream_options: { include_usage: false },
  });
  assert.equal(request.stream_options.include_usage, true);
  assert.equal(request.n, 1);
  for (const n of [2, 100, "1", 0, null]) {
    assert.throws(() => guardCheaperInferenceRequest({ ...base, n }));
  }
  assert.throws(() => guardCheaperInferenceRequest({ ...base, stream: "true" }));
});

test("unusable streaming usage warns without fabricating a free cost or blocking the answer", async () => {
  const warnings: string[] = [];
  const build = providerFunction("buildPatchedCreate", {
    normalizeRetiredModelId: (id: string) => id, cheaperInferenceCostFields,
    extractUsageTokens: providerFunction("extractUsageTokens", {}),
    COST_LEDGER_RECORDED: Symbol.for("visionclaw.cost-ledger-recorded"),
    logSilentCatch() {}, console: { warn: (s: string) => warnings.push(s) },
  });
  const create = build(async () => (async function* () {
    yield { choices: [{ delta: { content: "OK" } }], usage: {} };
  })(), () => "gpt-5.6-luna", () => 1, "llm.cheaperinference", async () => {
    assert.fail("Missing usage must not create a fabricated cost row"); return false;
  });
  const result = await create({ model: "gpt-5.6-luna", stream: true });
  let text = "";
  for await (const chunk of result) text += chunk.choices[0].delta.content;
  assert.equal(text, "OK");
  assert.equal(result[Symbol.for("visionclaw.cost-ledger-recorded")], false);
  assert.ok(warnings.some(s => s.includes("accounting unavailable")));
});

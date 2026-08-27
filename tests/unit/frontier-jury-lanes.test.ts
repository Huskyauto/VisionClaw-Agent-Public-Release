import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactAggregatorRoute,
  resolveProposerSpecs,
  deriveRestateSpecs,
  juryLaneMarginalCostUsd,
  isJuryCostExempt,
  shouldUseJuryProviderMarker,
  shouldRetryAggregatorOnFallback,
  validateFrontierLanes,
  withTimeout,
} from "../../server/moa";
import {
  clearClientCache,
  createOpenferenceStartGate,
  createProfundoStartGate,
  getClientForModel,
  markProviderUnhealthy,
  resetProviderHealth,
  wrapClaudeRunnerPacing,
} from "../../server/providers";

test("the default frontier jury assigns its three seats to independent provider lanes", () => {
  const specs = resolveProposerSpecs("frontier", undefined).slice(0, 3);

  assert.deepEqual(
    specs.map(({ modelId, providerLane }) => ({ modelId, providerLane })),
    [
      { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
      { modelId: "z-ai/glm-5.2", providerLane: "profundo" },
      { modelId: "claude-opus-5", providerLane: "claude-runner" },
    ],
  );
  assert.equal(new Set(specs.map((spec) => spec.providerLane)).size, 3);
});

test("the owner discovery pool keeps only the two free independent proposer lanes", () => {
  const specs = resolveProposerSpecs("frontier-lite", undefined);

  assert.deepEqual(
    specs.map(({ modelId, providerLane }) => ({ modelId, providerLane })),
    [
      { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
      { modelId: "z-ai/glm-5.2", providerLane: "profundo" },
    ],
  );
});

test("restate-gate clones preserve every frontier provider pin", () => {
  const restated = deriveRestateSpecs([
    { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
    { modelId: "z-ai/glm-5.2", providerLane: "profundo" },
    { modelId: "claude-opus-5", providerLane: "claude-runner" },
  ]);

  assert.deepEqual(
    restated.map(({ modelId, providerLane }) => ({ modelId, providerLane })),
    [
      { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
      { modelId: "z-ai/glm-5.2", providerLane: "profundo" },
      { modelId: "claude-opus-5", providerLane: "claude-runner" },
    ],
  );
});

test("a pinned provider lane rejects a model served only by another lane", async () => {
  await assert.rejects(
    () => getClientForModel("openference/deepseek-v4-pro", 1, { providerLane: "profundo" }),
    /pinned provider lane "profundo" cannot serve/i,
  );
});

test("a malformed frontier lane pairing falls back instead of deferring failure until execution", () => {
  const frontier = [
    "openference/deepseek-v4-pro",
    "z-ai/glm-5.2",
    "claude-opus-5",
  ];
  const invalid = {
    frontierLanes: [
      { modelId: "openference/deepseek-v4-pro", providerLane: "profundo" },
      { modelId: "z-ai/glm-5.2", providerLane: "openference" },
      { modelId: "claude-opus-5", providerLane: "claude-runner" },
    ],
  };

  assert.equal(validateFrontierLanes(invalid, frontier), null);
});

test("an unhealthy Openference lane cannot poison the independent Profundo seat", async () => {
  const priorOpenferenceKey = process.env.OPENFERENCE_API_KEY;
  const priorProfundoKey = process.env.PROFUNDO_API_KEY;
  process.env.OPENFERENCE_API_KEY = "sk-of-test-key-for-frontier-jury-lane";
  process.env.PROFUNDO_API_KEY = "sk-profundo-test-key-for-frontier-jury-lane";
  clearClientCache();
  resetProviderHealth("openference");
  resetProviderHealth("profundo");

  try {
    for (let i = 0; i < 3; i++) {
      markProviderUnhealthy("openference", "test rate limit");
    }

    await assert.rejects(
      () => getClientForModel("openference/deepseek-v4-pro", 1, { providerLane: "openference" }),
      /pinned provider lane "openference" is unavailable/i,
    );

    const profundo = await getClientForModel("z-ai/glm-5.2", 1, { providerLane: "profundo" });
    assert.equal(profundo.actualModelId, "glm-5.2");
  } finally {
    resetProviderHealth("openference");
    resetProviderHealth("profundo");
    if (priorOpenferenceKey === undefined) delete process.env.OPENFERENCE_API_KEY;
    else process.env.OPENFERENCE_API_KEY = priorOpenferenceKey;
    if (priorProfundoKey === undefined) delete process.env.PROFUNDO_API_KEY;
    else process.env.PROFUNDO_API_KEY = priorProfundoKey;
    clearClientCache();
  }
});

test("dedicated provider lanes own independent start pacing queues", async () => {
  const openference = createOpenferenceStartGate({ intervalMs: 10_000 });
  const profundo = createProfundoStartGate({ intervalMs: 10_000 });

  await openference.waitForStart();
  const startedAt = Date.now();
  await profundo.waitForStart();

  assert.ok(
    Date.now() - startedAt < 100,
    "Profundo must not wait behind an Openference start slot",
  );
});

test("the real Claude Runner bridge client waits on its own start gate", async () => {
  const runnerGate = createProfundoStartGate({ intervalMs: 10_000 });
  let upstreamCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          upstreamCalls++;
          return { choices: [{ message: { content: "ok" } }] };
        },
      },
    },
  };
  const paced = wrapClaudeRunnerPacing(client as any, runnerGate);
  await runnerGate.waitForStart();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10);

  try {
    await assert.rejects(
      () => paced.chat.completions.create({ model: "claude-opus-5", messages: [] }, { signal: abort.signal } as any),
      /paced request was aborted/i,
    );
    assert.equal(upstreamCalls, 0, "the bridge request must not bypass its start gate");
  } finally {
    clearTimeout(timeout);
  }
});

test("ordinary routing remains available when no provider lane is pinned", async () => {
  const priorOpenferenceKey = process.env.OPENFERENCE_API_KEY;
  process.env.OPENFERENCE_API_KEY = "sk-of-test-key-for-generic-routing";
  clearClientCache();
  resetProviderHealth("openference");

  try {
    const generic = await getClientForModel("openference/deepseek-v4-pro", 1);
    assert.equal(generic.actualModelId, "DeepSeek-V4-Pro");
  } finally {
    if (priorOpenferenceKey === undefined) delete process.env.OPENFERENCE_API_KEY;
    else process.env.OPENFERENCE_API_KEY = priorOpenferenceKey;
    clearClientCache();
  }
});

test("a pinned aggregator cannot silently retry through another provider lane", () => {
  assert.equal(
    shouldRetryAggregatorOnFallback({ modelId: "claude-opus-5", providerLane: "claude-runner" }),
    false,
  );
  assert.equal(
    shouldRetryAggregatorOnFallback({ modelId: "gpt-5.4" }),
    true,
    "an explicit caller-selected, unpinned aggregator retains the documented fallback policy",
  );
});

test("a strict final-model contract rejects any router substitution", () => {
  assert.doesNotThrow(() => assertExactAggregatorRoute("gpt-5.6-sol", "gpt-5.6-sol"));
  assert.throws(
    () => assertExactAggregatorRoute("gpt-5.6-sol", "gpt-5.4"),
    /required gpt-5\.6-sol, routed gpt-5\.4/,
  );
  assert.throws(
    () => assertExactAggregatorRoute("gpt-5.6-sol", "claude-sonnet-4-5"),
    /required gpt-5\.6-sol, routed claude-sonnet-4-5/,
  );
});

test("a discovery final cannot bypass its paid opt-in when Profundo is unavailable", async () => {
  const priorMetered = process.env.ALLOW_METERED_LLM;
  process.env.ALLOW_METERED_LLM = "true";
  clearClientCache();
  resetProviderHealth("profundo");

  try {
    for (let i = 0; i < 3; i++) {
      markProviderUnhealthy("profundo", "test unavailable");
    }
    await assert.rejects(
      () => getClientForModel("gpt-5.6-sol", 1, { forbidMeteredFallback: true }),
      /metered fallback forbidden/i,
    );
  } finally {
    resetProviderHealth("profundo");
    if (priorMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = priorMetered;
    clearClientCache();
  }
});

test("a MoA deadline aborts underlying provider work before returning timeout", async () => {
  const abort = new AbortController();
  const never = new Promise<void>(() => undefined);

  await assert.rejects(
    () => withTimeout(never, 10, "test provider call", () => abort.abort()),
    /timed out after 10ms/,
  );
  assert.equal(abort.signal.aborted, true);
});

test("dedicated flat and subscription seats persist zero marginal ledger cost", () => {
  assert.equal(juryLaneMarginalCostUsd("openference"), 0);
  assert.equal(juryLaneMarginalCostUsd("profundo"), 0);
  assert.equal(juryLaneMarginalCostUsd("claude-runner"), 0);
  assert.equal(juryLaneMarginalCostUsd(undefined), undefined);
  assert.equal(isJuryCostExempt("openference"), true);
  assert.equal(isJuryCostExempt("profundo"), true);
  assert.equal(isJuryCostExempt("claude-runner"), true);
  assert.equal(isJuryCostExempt(undefined), false, "generic metered jury calls must retain the normal breaker");
  assert.equal(shouldUseJuryProviderMarker("openference"), true);
  assert.equal(shouldUseJuryProviderMarker(undefined), false);
});
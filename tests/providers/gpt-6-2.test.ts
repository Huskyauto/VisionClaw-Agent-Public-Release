import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY, getMaxOutputTokens, isOwnerOnlyFinalDecisionModel } from "../../server/model-registry";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { getAvailableModelsForTenant, getClientForModel } from "../../server/providers";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { createGpt62Completion, type Gpt62ModelId } from "../../server/lib/gpt-6-2";
import { withTenantContext } from "../../server/lib/tenant-context";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { readFileSync } from "node:fs";

test("both exact GPT-6.2 models are budgeted owner choices, not recoverable paid defaults", async () => {
  for (const [id, short, long] of [
    ["gpt-6.2-sol", 1.2, 2.7],
    ["gpt-6.2-astra", 4.8, 10.8],
  ] as const) {
    const model = MODEL_REGISTRY.find(entry => entry.id === id);
    assert.equal(model?.provider, "openai");
    assert.equal(model?.costClass, "paid");
    assert.equal(isOwnerOnlyFinalDecisionModel(id), true);
    assert.equal(getMaxOutputTokens(id), 128000);
    assert.equal(estimateCostUsd(id, 100000, 100000), short);
    assert.equal(estimateCostUsd(id, 300000, 100000), long);
    assert.equal(paidStreamRecoveryPolicy(id, 100).allowRecovery, false);
    assert.equal(readFileSync("data/model-tiers.json", "utf8").includes(id), false);
    await assert.rejects(() => getClientForModel(id, 2, {
      explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true,
    }), /explicit owner selection/);
  }
});

const SOL = "gpt-6.2-sol";
const ASTRA = "gpt-6.2-astra";
const request = (model: Gpt62ModelId) => ({
  model, messages: [{ role: "user", content: "Summarize the provided text." }], max_tokens: 4096,
});
const grants = { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true };

test("the owner model picker exposes all three models and the kill switch hides the GPT-6.2 choices", async () => {
  const originalList = storage.getProviderKeys;
  const originalExecute = db.execute;
  const key = process.env.OPENAI_API_KEY;
  const disabled = process.env.OPENAI_GPT_62_DISABLED;
  const cheaper = process.env.CHEAPER_INFERENCE_ENABLED;
  const fableDisabled = process.env.FABLE_52_DISABLED;
  storage.getProviderKeys = (async () => [{ provider: "anthropic", enabled: true }] as Awaited<ReturnType<typeof originalList>>);
  db.execute = (async () => ({ rows: [] })) as unknown as typeof originalExecute;
  process.env.OPENAI_API_KEY = "sk-fake-no-network";
  process.env.CHEAPER_INFERENCE_ENABLED = "0";
  delete process.env.OPENAI_GPT_62_DISABLED;
  delete process.env.FABLE_52_DISABLED;
  const ids = [SOL, ASTRA, "claude-fable-5-2"];
  const discover = async (tenant: number, admin: boolean) => (await getAvailableModelsForTenant(tenant, admin))
    .filter(model => ids.includes(model.id)).map(model => model.id);
  try {
    assert.deepEqual(await discover(1, true), ids);
    assert.deepEqual(await discover(1, false), []);
    assert.deepEqual(await discover(2, false), []);
    assert.deepEqual(await discover(2, true), []);
    process.env.OPENAI_GPT_62_DISABLED = "1";
    assert.deepEqual(await discover(1, true), ["claude-fable-5-2"]);
    process.env.FABLE_52_DISABLED = "1";
    assert.deepEqual(await discover(1, true), []);
  } finally {
    storage.getProviderKeys = originalList;
    db.execute = originalExecute;
    for (const [name, value] of [["OPENAI_API_KEY", key], ["OPENAI_GPT_62_DISABLED", disabled],
      ["CHEAPER_INFERENCE_ENABLED", cheaper], ["FABLE_52_DISABLED", fableDisabled]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("verified owner gets an exact chat-only client; denied, foreign and stopped requests cannot dispatch", async () => {
  const key = process.env.OPENAI_API_KEY;
  const disabled = process.env.OPENAI_GPT_62_DISABLED;
  process.env.OPENAI_API_KEY = "sk-fake-no-network";
  delete process.env.OPENAI_GPT_62_DISABLED;
  try {
    for (const model of [SOL, ASTRA] as const) {
      for (const options of [
        {}, { ...grants, costExemptLane: true }, { ...grants, forbidMeteredFallback: true },
        { ...grants, providerLane: "openai-api" as const },
      ]) await assert.rejects(() => getClientForModel(model, 1, options), /explicit owner selection/);
      const selected = await getClientForModel(model, 1, grants);
      assert.equal(selected.actualModelId, model);
      assert.deepEqual(Object.keys(selected.client), ["chat"]);
      await assert.rejects(() => withTenantContext({ tenantId: 2, source: "explicit" },
        () => selected.client.chat.completions.create(request(model) as any) as any), /current owner tenant/);
      process.env.OPENAI_GPT_62_DISABLED = "1";
      await assert.rejects(() => getClientForModel(model, 1, grants), /disabled/);
      await assert.rejects(() => withTenantContext({ tenantId: 1, source: "explicit" },
        () => selected.client.chat.completions.create(request(model) as any) as any), /enabled direct OpenAI/);
      delete process.env.OPENAI_GPT_62_DISABLED;
    }
  } finally {
    for (const [name, value] of [["OPENAI_API_KEY", key], ["OPENAI_GPT_62_DISABLED", disabled]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

function fixture(model: Gpt62ModelId, failure?: "wrong-model" | "ledger" | "usage" | "budget" | "overrun" | "disabled") {
  const events: string[] = [];
  const completion = createGpt62Completion(model, 1, {
    checkAccess() {
      if (failure === "disabled" && events.includes("reserve")) throw new Error("disabled while reserving");
    },
    async reserve({ maximumCostCents }) {
      events.push("reserve");
      assert.ok(maximumCostCents > 0 && maximumCostCents < 100);
      if (failure === "budget") throw new Error("budget exhausted");
      return { id: 1, attemptKey: "test" };
    },
    async create(payload, options) {
      events.push("dispatch");
      assert.equal(payload.model, model);
      assert.equal(payload.service_tier, "default");
      assert.equal(payload.max_completion_tokens, 4096);
      assert.equal("max_tokens" in payload || "temperature" in payload, false);
      assert.equal(options.maxRetries, 0);
      assert.equal("headers" in options, false);
      const identity = failure === "wrong-model" ? "gpt-5.4" : model;
      const usage = failure === "usage" ? undefined : {
        prompt_tokens: 100, completion_tokens: failure === "overrun" ? 128000 : 25,
        prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
      };
      if (!payload.stream) return {
        model: identity, choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage,
      };
      assert.deepEqual(payload.stream_options, { include_usage: true });
      return (async function* () {
        yield { model: identity, choices: [{ delta: { content: "answer" }, finish_reason: null }] };
        yield { model: identity, choices: [{ delta: {}, finish_reason: "stop" }] };
        yield { model: identity, choices: [], usage };
      })();
    },
    estimate: estimateCostUsd,
    async record(entry) {
      events.push("record");
      assert.equal(entry.tenantId, 1);
      assert.equal(entry.model, model);
      assert.ok(entry.costUsd > 0);
      return failure !== "ledger";
    },
    async settle({ actualCostCents }) {
      assert.equal(actualCostCents, failure === "disabled" ? 0 : 1);
      events.push("settle");
    },
    async observeOverrun({ observedCostCents }) {
      assert.ok(observedCostCents > 0);
      events.push("overrun");
    },
  });
  return { events, completion };
}

test("streamed and nonstreamed answers are released only after reservation, exact dispatch and settlement", async () => {
  const sol = fixture(SOL);
  const response = await sol.completion({ ...request(SOL), temperature: 0.2 });
  assert.equal(response.model, SOL);
  assert.deepEqual(sol.events, ["reserve", "dispatch", "record", "settle"]);
  const astra = fixture(ASTRA);
  const stream = await astra.completion({ ...request(ASTRA), stream: true });
  assert.deepEqual(astra.events, sol.events);
  const chunks = [];
  for await (const part of stream) chunks.push(part);
  assert.equal(chunks.length, 3);
});

test("invalid spending and model overrides never reach reservation or transport", async () => {
  const f = fixture(SOL);
  for (const invalid of [
    { model: ASTRA }, { max_tokens: Infinity }, { n: 2 }, { service_tier: "priority" },
    { reasoning_effort: "none" }, { extra_body: { model: ASTRA } }, { tools: [{ type: "web_search" }] },
  ]) await assert.rejects(() => f.completion({ ...request(SOL), ...invalid }));
  assert.deepEqual(f.events, []);
});

test("denied or ambiguous paid work releases no output and never replays its dispatch", async () => {
  for (const failure of ["wrong-model", "ledger", "usage", "budget", "overrun", "disabled"] as const) {
    const f = fixture(SOL, failure);
    await assert.rejects(() => f.completion({ ...request(SOL), stream: true }));
    if (failure === "budget" || failure === "disabled") {
      assert.deepEqual(f.events, failure === "budget" ? ["reserve"] : ["reserve", "settle"]);
    } else {
      await assert.rejects(() => f.completion(request(SOL)), /no replay/);
      assert.equal(f.events.filter(e => e === "dispatch").length, 1);
      assert.equal(f.events.includes("settle"), failure === "wrong-model");
      assert.equal(f.events.includes("overrun"), failure === "overrun");
    }
  }
});

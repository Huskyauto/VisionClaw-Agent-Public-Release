import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY, isOwnerOnlyFinalDecisionModel, getMaxOutputTokens } from "../../server/model-registry";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { prepareFable52Request, createFable52Completion } from "../../server/lib/fable-5-2";
import { readFileSync } from "node:fs";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { buildPatchedCreate, getClientForModel } from "../../server/providers";
import { storage } from "../../server/storage";
import { withTenantContext } from "../../server/lib/tenant-context";

const request = () => ({ model: "claude-fable-5-2", messages: [{ role: "user", content: "Diagnose this design" }], max_tokens: 4096 });

test("Fable 5.2 is an explicit owner-only paid option with official limits and pricing", () => {
  const model = MODEL_REGISTRY.find(m => m.id === "claude-fable-5-2");
  assert.ok(model);
  assert.equal(model.provider, "anthropic");
  assert.equal(model.costClass, "paid");
  assert.equal(isOwnerOnlyFinalDecisionModel(model.id), true);
  assert.equal(getMaxOutputTokens(model.id), 128000);
  assert.equal(estimateCostUsd(model.id, 100000, 100000), 4.8);
  assert.equal(estimateCostUsd(model.id, 100000, 0, 100000), 0.02);
});

test("compatibility strips unsupported sampling/thinking and bounds output before spending", () => {
  const original = { ...request(), temperature: 0.1, top_p: 0.9, top_k: 10,
    thinking: { type: "disabled" }, reasoning_effort: "max", stream: true };
  const { payload, maximumCents } = prepareFable52Request(original);
  for (const key of ["temperature", "top_p", "top_k", "thinking", "reasoning_effort"])
    assert.equal(key in payload, false);
  assert.equal(original.temperature, 0.1);
  assert.deepEqual(payload.stream_options, { include_usage: true });
  assert.ok(maximumCents > 0 && maximumCents < 3000);
  for (const value of ["4096", NaN, Infinity, -1, 0, 128001, {}, null]) {
    assert.throws(() => prepareFable52Request({ ...request(), max_tokens: value }));
  }
  for (const tool_choice of ["required", { type: "function", function: { name: "exec" } }])
    assert.throws(() => prepareFable52Request({ ...request(), tool_choice }), /forced tool/);
  assert.throws(() => prepareFable52Request({ ...request(), extra_body: { model: "other" } }));
  assert.throws(() => prepareFable52Request({ ...request(), response_format: { type: "json_object" } }));
});

test("Fable is absent from automatic defaults and uses a closed guarded provider branch", () => {
  assert.equal(readFileSync("data/model-tiers.json", "utf8").includes("claude-fable-5-2"), false);
  const source = readFileSync("server/providers.ts", "utf8");
  assert.ok(source.includes('if (modelId === FABLE_52_MODEL)'));
  assert.ok(source.includes('options?.platformAdminVerified !== true'));
  assert.ok(source.includes('currentTenantId() !== tenantId'));
  assert.deepEqual(paidStreamRecoveryPolicy("claude-fable-5-2", 1000),
    { creationTimeoutMs: 65000, allowRecovery: false });
});

function fixture(failure?: "reserve" | "usage" | "settle" | "dispatch", stream = false) {
  const events: string[] = [];
  let seenOptions: any;
  const response = { choices: [{ message: { content: "answer" } }],
    ...(failure === "usage" ? {} : { usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
  const completion = createFable52Completion(async (_params, options) => {
    events.push("dispatch"); seenOptions = options;
    if (failure === "dispatch") throw new Error("uncertain timeout");
    return stream ? (async function* () { yield response; })() : response;
  }, () => { events.push("access"); }, 1, async () => ({
    reserve: async () => { events.push("reserve"); if (failure === "reserve") throw new Error("budget exhausted");
      return { id: 1, attemptKey: "server-owned" }; },
    settle: async args => { events.push("settle"); assert.equal(args.actualCostCents, 1);
      if (failure === "settle") throw new Error("settlement failed"); },
  }));
  return { completion, events, options: () => seenOptions };
}

test("paid dispatch reserves first, settles actual usage, and ignores retry/URL overrides", async () => {
  const f = fixture();
  await f.completion(request(), { maxRetries: 9, timeout: 999999, headers: { authorization: "fake" } });
  assert.ok(f.events.indexOf("reserve") < f.events.indexOf("dispatch"));
  assert.ok(f.events.indexOf("dispatch") < f.events.indexOf("settle"));
  assert.ok(f.options().signal instanceof AbortSignal);
  assert.equal(f.options().timeout, 60000);
  assert.equal(f.options().maxRetries, 0);
  assert.equal("headers" in f.options(), false);
});

test("budget and access failures prevent dispatch", async () => {
  const f = fixture("reserve");
  await assert.rejects(() => f.completion(request()), /budget exhausted/);
  assert.equal(f.events.includes("dispatch"), false);
  const denied = createFable52Completion(async () => { throw new Error("must not dispatch"); },
    () => { throw new Error("not owner"); }, 2, async () => { throw new Error("must not reserve"); });
  await assert.rejects(() => denied(request()), /not owner/);
});

test("an explicitly bounded long review gets 180 seconds without enabling SDK retries", async () => {
  const f = fixture();
  await f.completion(request(), { timeout: 180_000, maxRetries: 3 });
  assert.equal(f.options().timeout, 180_000);
  assert.equal(f.options().maxRetries, 0);
  let sdkOptions: any;
  const tracked = buildPatchedCreate(async (_params, options) => {
    sdkOptions = options;
    return { usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [] };
  }, () => "claude-fable-5-2", () => 1, "llm.anthropic", async () => true);
  await tracked(request(), f.options());
  assert.equal(sdkOptions.timeout, 180_000);
  assert.equal(sdkOptions.maxRetries, 0);
});

test("an explicitly approved deep inspection supports ten minutes without arbitrary deadline overrides", async () => {
  for (const timeout of [600_000, 600_001]) {
    const f = fixture();
    await f.completion(request(), { timeout, maxRetries: 9 });
    assert.equal(f.options().timeout, timeout === 600_000 ? 600_000 : 60_000);
    assert.equal(f.options().maxRetries, 0);
  }
});

test("uncertain dispatch, missing usage and failed settlement cannot be replayed on the client", async () => {
  for (const error of ["usage", "settle", "dispatch"] as const) {
    const f = fixture(error);
    await assert.rejects(() => f.completion(request()));
    await assert.rejects(() => f.completion(request()), /no automatic replay/);
    assert.equal(f.events.filter(e => e === "dispatch").length, 1);
  }
});

test("streamed answers are not released before settlement", async () => {
  const good = fixture(undefined, true);
  const stream = await good.completion({ ...request(), stream: true });
  assert.equal(good.events.at(-1), "settle");
  const output = [];
  for await (const part of stream) output.push(part);
  assert.equal(output.length, 1);
  const bad = fixture("settle", true);
  await assert.rejects(() => bad.completion({ ...request(), stream: true }), /settlement failed/);
});

test("real provider admission rejects non-owner, generic metered, pinned and unverified access before key lookup", async () => {
  const original = storage.getTenantProviderKey;
  let reads = 0;
  storage.getTenantProviderKey = async () => { reads++; throw new Error("must not read keys"); };
  try {
    for (const [tenant, options] of [
      [2, { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true }],
      [1, { meteredOverride: true, costExemptLane: true }],
      [1, { explicitOwnerSelection: true, meteredOverride: true, platformAdminVerified: false }],
      [1, { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true, providerLane: "anthropic-api" }],
      [1, { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true, forbidMeteredFallback: true }],
    ] as const) {
      await assert.rejects(() => getClientForModel("claude-fable-5-2", tenant, options), /explicit owner selection/);
    }
    assert.equal(reads, 0);
  } finally { storage.getTenantProviderKey = original; }
});

test("explicit owner gets only the exact guarded chat facade; cross-tenant dispatch is denied", async () => {
  const original = storage.getTenantProviderKey;
  storage.getTenantProviderKey = async () => ({ api_key: "sk-ant-fake-offline-fable52" } as any);
  try {
    const selected = await getClientForModel("claude-fable-5-2", 1, {
      explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true,
    });
    assert.equal(selected.actualModelId, "claude-fable-5-2");
    assert.deepEqual(Object.keys(selected.client), ["chat"]);
    await assert.rejects(() => withTenantContext({ tenantId: 2, source: "explicit" },
      () => selected.client.chat.completions.create(request() as any) as any), /current owner tenant/);
  } finally { storage.getTenantProviderKey = original; }
});

test("5.2 mandatory ledger failures withhold non-streamed and streamed output", async () => {
  for (const stream of [false, true]) {
    const reply = { choices: [{ message: { content: "withheld" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
    const create = buildPatchedCreate(async () => stream ?
      (async function* () { yield reply; })() : reply, () => "claude-fable-5-2", () => 1,
      "llm.anthropic", async () => false);
    if (stream) {
      const answer = await create({ ...request(), stream });
      const seen: any[] = [];
      await assert.rejects(async () => { for await (const chunk of answer) seen.push(chunk); }, /5.2 usage record/);
      assert.equal(seen.length, 0);
    } else await assert.rejects(() => create(request()), /5.2 usage record/);
  }
});

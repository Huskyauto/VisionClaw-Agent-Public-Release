import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMammouthAccess, mammouthReady, mammouthRequest, mammouthUsageCost, runMammouthBudgeted } from "../../server/lib/mammouth";
import { MAMMOUTH_MODELS } from "../../server/lib/mammouth-catalog";
import { MODEL_REGISTRY, getCatalogModelPricing, isOwnerOnlyFinalDecisionModel } from "../../server/model-registry";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { withTenantContext } from "../../server/lib/tenant-context";

function ownerTest(name: string, fn: () => unknown) {
  test(name, () => withTenantContext({ tenantId: 1, source: "explicit" }, async () => fn()));
}

ownerTest("Mammouth requires explicit verified owner scope, never subscription-as-free access", () => {
  const env = { MAMMOUTH_API_KEY: "test-only-not-a-real-credential" };
  const selected = { explicitOwnerSelection: true, platformAdminVerified: true };
  assert.equal(mammouthReady(env), true);
  assert.doesNotThrow(() => assertMammouthAccess(1, selected, env));
  for (const tenant of [undefined, 0, 2]) {
    assert.throws(() => assertMammouthAccess(tenant, selected, env));
  }
  assert.throws(() => assertMammouthAccess(1, {}, env));
  assert.throws(() => assertMammouthAccess(1, { explicitOwnerSelection: true }, env));
  assert.throws(() => assertMammouthAccess(1, { ...selected, forbidMeteredFallback: true }, env));
  assert.throws(() => assertMammouthAccess(1, selected, { ...env, MAMMOUTH_ENABLED: "0" }));
  assert.throws(() => mammouthRequest("mammouth/unknown", { messages: [] }));
});

test("Mammouth disallows reasoning sub-budgets that could evade the total-output cap", () => {
  assert.throws(() => mammouthRequest("mammouth/mistral-large-4", {
    model: "mistral-large-4", messages: [{ role: "user", content: "Test" }],
    max_tokens: 32, reasoning: { max_tokens: 1_000_000 },
  }));
  assert.throws(() => mammouthRequest("mammouth/glm-5.3-flash", {
    model: "glm-5.3-flash", messages: [{ role: "user", content: "Test" }],
    max_tokens: 32, reasoning: { effort: "none" },
  }), /requires reasoning/);
});

test("ambiguous paid Mammouth streams cannot enter chat's retry or fallback ladder", () => {
  assert.equal(paidStreamRecoveryPolicy("mammouth/mistral-large-4", 60000).allowRecovery, false);
});

const id = "mammouth/glm-5.3-flash";
const request = { model: id, messages: [{ role: "user", content: "Synthetic test" }], max_completion_tokens: 32 };

test("request pinning, parameter caps and text-only input cannot be bypassed", () => {
  const result = mammouthRequest(id, request);
  assert.equal(result.payload.model, "glm-5.3-flash");
  assert.equal(result.payload.max_tokens, 32);
  assert.equal(result.payload.max_completion_tokens, undefined);
  assert.ok(result.maximumUsd > 0 && result.maximumUsd <= 0.25);
  for (const maximum of ["8192", NaN, -1, 0, 8193, Infinity]) {
    assert.throws(() => mammouthRequest(id, { ...request, max_completion_tokens: maximum }));
  }
  for (const changes of [
    { model: "gpt-6-astra" }, { n: 2 }, { extra_body: { model: "gpt-6-astra" } },
    { max_tokens: 500 }, { service_tier: "priority" }, { stream: "true" },
    { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/image" } }] }] },
    { messages: [{ role: "user", content: "x".repeat(128001) }] },
  ]) assert.throws(() => mammouthRequest(id, { ...request, ...changes }));
  assert.deepEqual(mammouthRequest(id, { ...request, stream: true,
    stream_options: { include_usage: false } }).payload.stream_options, { include_usage: true });
});

test("Mammouth pricing and registry identity stay paid, owner-only and nonzero", () => {
  for (const model of MAMMOUTH_MODELS) {
    const entry = MODEL_REGISTRY.find(entry => entry.id === model.id);
    assert.equal(entry?.provider, "mammouth");
    assert.equal(entry?.costClass, "paid");
    assert.equal(isOwnerOnlyFinalDecisionModel(model.id), true);
    const rates = getCatalogModelPricing(entry)!;
    assert.equal(rates.inputUsdPerToken, model.inputPerMillion / 1e6);
    assert.equal(mammouthUsageCost(model.id, { prompt_tokens: 1000000, completion_tokens: 1000000 }),
      model.inputPerMillion + model.outputPerMillion);
  }
  assert.equal(mammouthUsageCost(id, {}), undefined);
  assert.equal(mammouthUsageCost(id, { prompt_tokens: -1, completion_tokens: 2 }), undefined);
});

function budgetFixture() {
  const events: string[] = [];
  const deps = {
    reserve: async (args: any) => { events.push("reserve"); assert.equal(args.tenantId, 1);
      assert.ok(args.attemptKey.startsWith("mammouth:")); return { id: 1, attemptKey: args.attemptKey }; },
    settle: async (args: any) => { events.push("settle"); assert.equal(args.actualCostCents, 1); },
  };
  return { events, deps };
}

ownerTest("durable admission precedes dispatch and actual usage settles the hold", async () => {
  const { events, deps } = budgetFixture();
  await runMammouthBudgeted(id, 0.01, async () => {
    events.push("invoke"); return { usage: { prompt_tokens: 10, completion_tokens: 5 } };
  }, () => { events.push("check"); }, deps);
  assert.deepEqual(events, ["reserve", "check", "invoke", "settle"]);
});

ownerTest("denied admission, revoked access and ambiguous failures never retry or release holds", async () => {
  const { events, deps } = budgetFixture();
  await assert.rejects(runMammouthBudgeted(id, 0.01,
    async () => { events.push("invoke"); }, () => { throw new Error("disabled"); }, deps));
  assert.deepEqual(events, ["reserve"]);
  events.length = 0;
  await assert.rejects(runMammouthBudgeted(id, 0.01, async () => {
    events.push("invoke"); throw new Error("ambiguous timeout");
  }, () => {}, deps));
  assert.deepEqual(events, ["reserve", "invoke"]);
  events.length = 0;
  await assert.rejects(runMammouthBudgeted(id, 0.01, async () => ({}), () => {}, deps), /usage/);
  assert.deepEqual(events, ["reserve"]);
});

ownerTest("stream completion settles once; client disconnect retains the full reservation", async () => {
  const { events, deps } = budgetFixture();
  const stream = () => (async function* () {
    yield { choices: [{ delta: { content: "OK" } }] };
    yield { usage: { prompt_tokens: 10, completion_tokens: 1 } };
  })();
  const completed = await runMammouthBudgeted(id, 0.01, async () => stream(), () => {}, deps);
  for await (const _chunk of completed) { /* drain */ }
  assert.deepEqual(events, ["reserve", "settle"]);
  events.length = 0;
  const disconnected = await runMammouthBudgeted(id, 0.01, async () => stream(), () => {}, deps);
  for await (const _chunk of disconnected) break;
  assert.deepEqual(events, ["reserve"]);
});

test("lost tenant context is not owner authorization", async () => {
  const { deps } = budgetFixture();
  assert.throws(() => assertMammouthAccess(1, {
    explicitOwnerSelection: true, platformAdminVerified: true,
  }, { MAMMOUTH_API_KEY: "fake-test-key" }));
  await assert.rejects(runMammouthBudgeted(id, 0.01, async () => ({}), () => {}, deps));
  await withTenantContext({ tenantId: 2, source: "explicit" }, async () => {
    assert.throws(() => assertMammouthAccess(1, {
      explicitOwnerSelection: true, platformAdminVerified: true,
    }, { MAMMOUTH_API_KEY: "fake-test-key" }));
  });
});

test("nested transport fields cannot sneak multimodal requests into text-only admission", () => {
  for (const changes of [
    { messages: [{ role: "user", content: "Test", audio: { id: "audio" } }] },
    { messages: [{ role: "user", content: [{ type: "text", text: "Test", image_url: { url: "https://example.test" } }] }] },
    { tools: [{ type: "web_search_preview" }] },
    { tool_choice: { type: "web_search" } },
    { response_format: { type: "text", image: true } },
  ]) assert.throws(() => mammouthRequest(id, { ...request, ...changes }));
  assert.equal(mammouthUsageCost(id, { prompt_tokens: 0, completion_tokens: 0 }), undefined);
});

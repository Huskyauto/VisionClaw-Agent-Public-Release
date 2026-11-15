import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY, getMaxOutputTokens, isOwnerOnlyFinalDecisionModel } from "../../server/model-registry";
import { prepareCarbonRequest, carbonUsageCost, createCarbonCompletion } from "../../server/lib/gemini-carbon";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { getClientForModel } from "../../server/providers";
import { withTenantContext } from "../../server/lib/tenant-context";
import { readFileSync } from "node:fs";
import { retainAggregateAiObservedOverrun } from "../../server/agentic/aggregate-ai-spend-budget";
import { db } from "../../server/db";
import { PgDialect } from "drizzle-orm/pg-core";

test("Carbon is a paid high-end owner option with the account-verified output limit", () => {
  const model = MODEL_REGISTRY.find(m => m.id === "gemini-4-carbon");
  assert.ok(model);
  assert.equal(model.provider, "google");
  assert.equal(model.tier, "powerful");
  assert.equal(model.costClass, "paid");
  assert.equal(isOwnerOnlyFinalDecisionModel(model.id), true);
  assert.equal(getMaxOutputTokens(model.id), 32768);
});

function fixture(failure?: "access" | "reserve" | "usage" | "ledger" | "settle" | "dispatch" | "model" | "overrun", stream = false) {
  const events: string[] = [];
  let calls = 0;
  const reply = {
    model: failure === "model" ? "gemini-flash-latest" : "gemini-4-carbon",
    choices: [{ message: { content: "CARBON-OK" }, delta: { content: "CARBON-OK" } }],
    ...(failure === "usage" ? {} : { usage: { prompt_tokens: failure === "overrun" ? 1_000_000 : 100, completion_tokens: 20 } }),
  };
  const create = createCarbonCompletion(1, {
    checkAccess: () => { events.push("access"); if (failure === "access") throw new Error("denied"); },
    budget: async () => ({
      reserve: async args => { events.push("reserve"); assert.ok(args.maximumCostCents > 0);
        if (failure === "reserve") throw new Error("cap"); return { id: 1, attemptKey: args.attemptKey }; },
      settle: async () => { events.push("settle"); if (failure === "settle") throw new Error("settle"); },
      observeOverrun: async args => { events.push("overrun"); assert.ok(args.observedCostCents >= 200); },
    }),
    create: async (_payload, options) => {
      calls++; events.push("dispatch");
      assert.equal(options.maxRetries, 0); assert.equal(options.headers, undefined);
      assert.equal(options.timeout, 180000);
      if (failure === "dispatch") throw new Error("uncertain");
      return stream ? (async function* () { yield reply; })() : reply;
    },
    record: async entry => { events.push("ledger"); assert.equal(entry.tenantId, 1);
      assert.ok(entry.costUsd > 0); return failure !== "ledger"; },
  });
  return { create, events, calls: () => calls };
}

test("Carbon reserves before dispatch and records/settles before releasing buffered output", async () => {
  for (const stream of [false, true]) {
    const f = fixture(undefined, stream);
    const result = await f.create({ ...request(), stream }, { maxRetries: 99, headers: { authorization: "not-forwarded" } });
    assert.ok(f.events.indexOf("reserve") < f.events.indexOf("dispatch"));
    assert.ok(f.events.indexOf("ledger") < f.events.indexOf("settle"));
    assert.equal(f.events.at(-1), "settle");
    if (stream) {
      const chunks = [];
      for await (const chunk of result) chunks.push(chunk);
      assert.equal(chunks.length, 1);
    }
  }
});

test("observed overruns still record actual costs and retain the larger hold before refusing output", async () => {
  const f = fixture("overrun");
  await assert.rejects(f.create(request()), /larger hold retained/);
  assert.ok(f.events.indexOf("ledger") < f.events.indexOf("overrun"));
  assert.equal(f.events.includes("settle"), false);
  await assert.rejects(f.create(request()), /replay/);
  assert.equal(f.calls(), 1);
});

test("overrun persistence uses the shared lock and exact tenant/reservation binding without releasing the hold", async () => {
  const original = db.transaction;
  const queries: { sql: string; params: unknown[] }[] = [];
  let matched = true;
  try {
    db.transaction = (async (work: any) => work({ execute: async (query: any) => {
      const compiled = new PgDialect().sqlToQuery(query);
      queries.push(compiled);
      return { rows: compiled.sql.includes("UPDATE") && matched ? [{ id: 7 }] : [] };
    } })) as typeof db.transaction;
    const args = { tenantId: 1, reservationId: 7, attemptKey: "carbon:test-only", observedCostCents: 200 };
    await retainAggregateAiObservedOverrun(args);
    assert.match(queries[0].sql, /pg_advisory_xact_lock.*aggregate-ai-spend-budget/);
    assert.match(queries[1].sql, /state = 'reserved'/);
    assert.match(queries[1].sql, /reserved_cents </);
    assert.deepEqual(queries[1].params, [200, 1, 7, "carbon:test-only", 200]);
    matched = false;
    await assert.rejects(retainAggregateAiObservedOverrun(args), /could not be retained/);
    const before = queries.length;
    await assert.rejects(retainAggregateAiObservedOverrun({ ...args, tenantId: 0 }), /positive integer/);
    assert.equal(queries.length, before);
  } finally { db.transaction = original; }
});

test("Carbon refuses access/cap failures and never retries ambiguous paid outcomes", async () => {
  for (const failure of ["access", "reserve", "usage", "ledger", "settle", "dispatch", "model"] as const) {
    const f = fixture(failure);
    await assert.rejects(f.create(request()));
    if (["access", "reserve"].includes(failure)) assert.equal(f.calls(), 0);
    else {
      assert.equal(f.calls(), 1);
      await assert.rejects(f.create(request()), /replay/);
      assert.equal(f.calls(), 1);
    }
  }
  assert.deepEqual(paidStreamRecoveryPolicy("gemini-4-carbon", 1000), { creationTimeoutMs: 185000, allowRecovery: false });
  assert.equal(readFileSync("data/model-tiers.json", "utf8").includes("gemini-4-carbon"), false);
});

test("Carbon admission requires exact verified owner selection and never falls through to other Google keys", async () => {
  for (const [tenant, options] of [
    [2, { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true }],
    [1, {}], [1, { explicitOwnerSelection: true, meteredOverride: true }],
    [1, { explicitOwnerSelection: true, platformAdminVerified: true }],
    [1, { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true, forbidMeteredFallback: true }],
  ] as const) {
    await assert.rejects(getClientForModel("gemini-4-carbon", tenant, options), /explicit owner selection/);
  }
  const old = process.env.GEMINI_HIGH_END_API_KEY;
  const disabled = process.env.GEMINI_CARBON_DISABLED;
  try {
    process.env.GEMINI_HIGH_END_API_KEY = "fixture-key-not-a-real-credential";
    delete process.env.GEMINI_CARBON_DISABLED;
    const options = { explicitOwnerSelection: true, platformAdminVerified: true, meteredOverride: true };
    const client = await withTenantContext({ tenantId: 1, source: "background-job" },
      () => getClientForModel("gemini-4-carbon", 1, options));
    assert.equal(client.actualModelId, "gemini-4-carbon");
    await assert.rejects(client.client.chat.completions.create(request() as any), /owner context/);
    process.env.GEMINI_CARBON_DISABLED = "1";
    await assert.rejects(getClientForModel("gemini-4-carbon", 1, options), /dedicated credential/);
    delete process.env.GEMINI_CARBON_DISABLED;
    delete process.env.GEMINI_HIGH_END_API_KEY;
    await assert.rejects(getClientForModel("gemini-4-carbon", 1, options), /dedicated credential/);
  } finally {
    if (old === undefined) delete process.env.GEMINI_HIGH_END_API_KEY; else process.env.GEMINI_HIGH_END_API_KEY = old;
    if (disabled === undefined) delete process.env.GEMINI_CARBON_DISABLED; else process.env.GEMINI_CARBON_DISABLED = disabled;
  }
});

const request = () => ({ model: "gemini-4-carbon", messages: [{ role: "user", content: "Review this design." }], max_tokens: 4096 });

test("Carbon bounds requests before spending and handles the published pricing rollover", () => {
  const prepared = prepareCarbonRequest({ ...request(), temperature: 0, stream: true });
  assert.equal("temperature" in prepared.payload, false);
  assert.deepEqual(prepared.payload.stream_options, { include_usage: true });
  assert.ok(prepared.maximumCents > 0);
  for (const max_tokens of [0, -1, "4096", 32769, NaN, Infinity]) {
    assert.throws(() => prepareCarbonRequest({ ...request(), max_tokens }));
  }
  assert.throws(() => prepareCarbonRequest({ ...request(), extra_body: { model: "other" } }));
  const usage = { prompt_tokens: 100000, completion_tokens: 100000, prompt_tokens_details: { cached_tokens: 100000 } };
  assert.equal(carbonUsageCost(usage, new Date("2026-11-30T23:59:59Z")), 1.01);
  assert.equal(carbonUsageCost(usage, new Date("2026-12-01T00:00:00Z")), 2.02);
});

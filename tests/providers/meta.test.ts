import test from "node:test";
import assert from "node:assert/strict";
import { metaPrimaryAllowed, META_MODEL_ID, META_CONTRIBUTOR_MODEL_ID, META_WONDER_MODEL_ID,
  metaModelForTier, metaRequest, metaUsageCost, metaHelperTokenLimit } from "../../server/lib/meta";

test("bounded helper requests budget Meta reasoning without changing non-Meta ceilings", () => {
  assert.equal(metaHelperTokenLimit("muse-wonder-1.0", 1000), 16384);
  assert.equal(metaHelperTokenLimit(META_WONDER_MODEL_ID, 600), 16384);
  assert.equal(metaHelperTokenLimit("muse-wonder-1.0", 2500), 16384);
  assert.equal(metaHelperTokenLimit("muse-spark-1.3", 1000), 4096);
  assert.equal(metaHelperTokenLimit("muse-spark-1.3-contributor", 600), 1024);
  assert.equal(metaHelperTokenLimit("gpt-5.4", 1000), 1000);
});
import { createMetaClient } from "../../server/lib/meta-client";
import { withTenantContext } from "../../server/lib/tenant-context";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { metaTitleTokenLimit } from "../../server/lib/meta";

const env = { META_API_KEY: "synthetic", META_PRIMARY_ENABLED: "1" };
test("Meta titles reserve reasoning room without increasing unrelated model limits", () => {
  assert.equal(metaTitleTokenLimit("muse-spark-1.3-contributor"), 1024);
  assert.equal(metaTitleTokenLimit(META_WONDER_MODEL_ID), 1024);
  assert.equal(metaTitleTokenLimit("gpt-5.4"), 30);
});

test("verified reasoning exhaustion settles once without poisoning provider health or replaying", async () => {
  const previous = { key: process.env.META_API_KEY, enabled: process.env.META_ENABLED };
  process.env.META_API_KEY = "synthetic";
  process.env.META_ENABLED = "1";
  try {
    await withTenantContext({ tenantId: 1, source: "explicit" }, async () => {
      for (const stream of [false, true]) {
        let failures = 0, settlements = 0, dispatches = 0;
        const completion = { model: "muse-spark-1.3", choices: [{
          message: { content: "" }, delta: {}, finish_reason: "length",
        }], usage: { prompt_tokens: 10, completion_tokens: 30 } };
        const client = createMetaClient(1, create => create, () => true, () => { failures++; }, {
          create: async () => {
            dispatches++;
            return stream ? (async function* () { yield completion; })() : completion;
          },
          budget: {
            reserve: async args => ({ id: 1, attemptKey: args.attemptKey }),
            settle: async () => { settlements++; },
          },
        });
        const request = { model: "x", messages: [{ role: "user" as const, content: "Title" }], stream };
        await assert.rejects(async () => {
          const result: any = await client.chat.completions.create(request);
          if (stream) for await (const _chunk of result) { /* drain */ }
        }, /output budget exhausted/i);
        await assert.rejects(client.chat.completions.create(request), /replay/);
        assert.equal(failures, 0);
        assert.equal(settlements, 1);
        assert.equal(dispatches, 1);
      }
    });
  } finally {
    if (previous.key === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = previous.key;
    if (previous.enabled === undefined) delete process.env.META_ENABLED; else process.env.META_ENABLED = previous.enabled;
  }
});

test("Meta primary is opt-in and owner scoped, preserving explicit and free-only lanes", () => {
  assert.equal(metaPrimaryAllowed(1, 1, {}, env), true);
  for (const tenant of [undefined, 2]) {
    assert.equal(metaPrimaryAllowed(tenant, 1, {}, env), false);
  }
  assert.equal(metaPrimaryAllowed(1, 2, {}, env), false);
  for (const options of [
    { juryLane: true }, { providerLane: "replit" }, { explicitOwnerSelection: true },
    { forbidMeteredFallback: true }, { allowMeteredFallback: false }, { freeTierOnly: true },
  ]) assert.equal(metaPrimaryAllowed(1, 1, options, env), false);
  assert.equal(metaPrimaryAllowed(1, 1, {}, { ...env, META_PRIMARY_ENABLED: "0" }), false);
  assert.equal(metaPrimaryAllowed(1, 1, {}, { META_API_KEY: "synthetic" }), false);
  assert.equal(META_MODEL_ID, "meta-direct/muse-spark-1.3");
});

test("actual Meta client reserves before dispatch, settles once and pins transport options", async () => {
  const oldKey = process.env.META_API_KEY;
  const oldEnabled = process.env.META_ENABLED;
  process.env.META_API_KEY = "synthetic";
  delete process.env.META_ENABLED;
  try {
    await withTenantContext({ tenantId: 1, source: "explicit" }, async () => {
      const events: string[] = [];
      const client = createMetaClient(1, create => create, () => true, () => {}, {
        create: async (payload, options) => {
          events.push("dispatch");
          assert.equal(payload.model, "muse-spark-1.3");
          assert.equal(options.maxRetries, 0);
          assert.equal(options.headers, undefined);
          return { model: "muse-spark-1.3", choices: [{ message: { content: "OK" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 } };
        },
        budget: {
          reserve: async args => { events.push("reserve"); return { id: 1, attemptKey: args.attemptKey }; },
          settle: async () => { events.push("settle"); },
        },
      });
      await client.chat.completions.create({ model: "gpt-5.4", messages: [{ role: "user", content: "Test" }] },
        { maxRetries: 100, headers: { authorization: "synthetic" } });
      assert.deepEqual(events, ["reserve", "dispatch", "settle"]);
    });
  } finally {
    if (oldKey === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = oldKey;
    if (oldEnabled === undefined) delete process.env.META_ENABLED; else process.env.META_ENABLED = oldEnabled;
  }
});

test("Meta client cannot dispatch for another tenant or repeat uncertain work", async () => {
  const oldKey = process.env.META_API_KEY;
  const oldEnabled = process.env.META_ENABLED;
  process.env.META_API_KEY = "synthetic";
  delete process.env.META_ENABLED;
  try {
    let dispatches = 0;
    const deps = {
      create: async () => { dispatches++; throw new Error("ambiguous timeout"); },
      budget: { reserve: async (args: any) => ({ id: 1, attemptKey: args.attemptKey }), settle: async () => {} },
    };
    assert.throws(() => createMetaClient(1, create => create, () => true, () => {}, deps), /owner/);
    await withTenantContext({ tenantId: 2, source: "explicit" }, async () => {
      assert.throws(() => createMetaClient(1, create => create, () => true, () => {}, deps), /owner/);
    });
    await withTenantContext({ tenantId: 1, source: "explicit" }, async () => {
      const client = createMetaClient(1, create => create, () => true, () => {}, deps);
      const request = { model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "Test" }] };
      await assert.rejects(client.chat.completions.create(request), /ambiguous/);
      await assert.rejects(client.chat.completions.create(request), /replay/);
      assert.equal(dispatches, 1);
    });
  } finally {
    if (oldKey === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = oldKey;
    if (oldEnabled === undefined) delete process.env.META_ENABLED; else process.env.META_ENABLED = oldEnabled;
  }
  for (const id of [META_MODEL_ID, "muse-spark-1.3"]) {
    assert.equal(paidStreamRecoveryPolicy(id, 20000).allowRecovery, false);
  }
});

test("Meta pins standard mode, bounds reasoning output and rejects billable hosted tools", () => {
  const request = { model: "gpt-5.4", messages: [{ role: "user", content: "Synthetic" }], max_completion_tokens: 1024 };
  const { payload, maximumUsd } = metaRequest(request);
  assert.equal(payload.model, "muse-spark-1.3");
  assert.equal(payload.reasoning_effort, "minimal");
  assert.equal(payload.max_tokens, 1024);
  assert.equal(payload.max_completion_tokens, undefined);
  assert.ok(maximumUsd > 0);
  for (const changes of [
    { max_tokens: 1, max_completion_tokens: "1024" },
    { max_completion_tokens: NaN }, { max_completion_tokens: 0 },
    { extra_body: { model: "muse-spark-1.3-contributor" } },
    { tools: [{ type: "web_search" }] }, { n: 2 },
    { reasoning: { max_tokens: 1000000 } },
    { tool_choice: "required" }, { tool_choice: { type: "function", function: { name: "test" } } },
  ]) assert.throws(() => metaRequest({ ...request, ...changes }));
  assert.equal(metaUsageCost({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }), 5.5);
  assert.equal(metaUsageCost({ prompt_tokens: -1, completion_tokens: 1 }), undefined);
  const noTools = metaRequest({ ...request, tools: [{ type: "function", function: { name: "test" } }], tool_choice: "none" });
  assert.equal(noTools.payload.tools, undefined);
});

test("Meta accepts SDK assistant tool-call messages with null extras", () => {
  const { payload } = metaRequest({ messages: [
    { role: "user", content: "x" },
    { role: "assistant", content: null, refusal: null, annotations: [], tool_calls: [{ id: "1", type: "function", function: { name: "t", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", content: "ok" },
  ] });
  assert.equal(payload.messages[1].refusal, undefined);
  assert.equal(payload.messages[1].tool_calls.length, 1);
});

test("simple work uses approved Spark Contributor; general work uses Spark; high-end uses Wonder", () => {
  const approved = { META_CONTRIBUTOR_APPROVED: "1" };
  assert.equal(metaModelForTier("fast", approved), META_CONTRIBUTOR_MODEL_ID);
  assert.equal(metaModelForTier("balanced", approved), META_MODEL_ID);
  assert.equal(metaModelForTier("powerful", approved), META_WONDER_MODEL_ID);
  assert.equal(metaModelForTier("reasoning", approved), META_WONDER_MODEL_ID);
  assert.equal(metaModelForTier("fast", {}), META_MODEL_ID);
  const wonder = metaRequest({ messages: [{ role: "user", content: "Synthetic" }] }, META_WONDER_MODEL_ID);
  assert.equal(wonder.payload.model, "muse-wonder-1.0");
  assert.equal(wonder.payload.reasoning_effort, "high");
  assert.equal(metaUsageCost({ prompt_tokens: 1000000, completion_tokens: 1000000 }, META_WONDER_MODEL_ID), 24);
});

/**
 * tests/unit/param-adaptation.test.ts
 *
 * Regression coverage for the UNIVERSAL param-adaptation layer
 * (server/lib/param-adaptation.ts). This is what makes "a provider rejecting an
 * OPTIONAL param auto-strips and retries the SAME model" true across every
 * getClientForModel() caller — wrapping the 4 client-source factories with
 * wrapClientWithParamAdaptation gives ~65 direct call sites the behavior with
 * zero churn, so the wrapper's correctness is load-bearing.
 *
 * Proves: (a) stripRejectedParam drops/swaps the right OPTIONAL param and only
 * that; (b) the wrapper strips-and-retries the SAME model, bounded; (c) it never
 * mutates the caller's params object; (d) it is idempotent (re-wrapping a cached
 * client never stacks); (e) the caller's AbortSignal always wins over a retry.
 *
 * Run: node --import tsx --test tests/unit/param-adaptation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PARAM_STRIPS,
  normalizeRetiredModelId,
  stripRejectedParam,
  wrapClientWithParamAdaptation,
} from "../../server/lib/param-adaptation";
import { buildPatchedCreate, buildPatchedResponsesCreate, normalizeModelId } from "../../server/providers";

// --- stripRejectedParam: param recognition ------------------------------
test("strips temperature when the error names it and it is present", () => {
  const p: any = { model: "m", temperature: 0.7, messages: [] };
  assert.equal(stripRejectedParam(p, new Error("temperature is not supported")), "temperature");
  assert.equal("temperature" in p, false);
});

test("strips response_format on a json_schema rejection", () => {
  const p: any = { model: "m", response_format: { type: "json_object" } };
  assert.equal(stripRejectedParam(p, new Error("response_format json_object unsupported")), "response_format");
  assert.equal("response_format" in p, false);
});

test("swaps max_completion_tokens -> max_tokens (not delete)", () => {
  const p: any = { model: "m", max_completion_tokens: 1234 };
  assert.equal(stripRejectedParam(p, new Error("Unsupported parameter: max_completion_tokens")), "max_completion_tokens→max_tokens");
  assert.equal(p.max_completion_tokens, undefined);
  assert.equal(p.max_tokens, 1234);
});

test("returns null on a non-param error (caller must rethrow / fail over)", () => {
  const p: any = { model: "m", temperature: 0.7 };
  assert.equal(stripRejectedParam(p, new Error("rate limit exceeded")), null);
  assert.equal(p.temperature, 0.7); // untouched
});

test("returns null when the named param is already absent (no false strip)", () => {
  const p: any = { model: "m" };
  assert.equal(stripRejectedParam(p, new Error("temperature out of range")), null);
});

test("reads nested error.message shape too", () => {
  const p: any = { model: "m", temperature: 1 };
  assert.equal(stripRejectedParam(p, { error: { message: "temperature unsupported" } }), "temperature");
});

// --- wrapClientWithParamAdaptation: behavior ----------------------------
function fakeClient(impl: (params: any, opts?: any) => Promise<any>) {
  return { chat: { completions: { create: impl } } } as any;
}

test("retired GPT-5 Mini identifiers are normalized to GPT-5.4", () => {
  assert.equal(normalizeRetiredModelId("gpt-5-mini"), "gpt-5.4");
  assert.equal(normalizeRetiredModelId("o4-mini"), "gpt-5.4");
  assert.equal(normalizeRetiredModelId("o4-mini-openai"), "gpt-5.4");
  assert.equal(normalizeRetiredModelId("openai/gpt-5-mini"), "gpt-5.4");
  assert.equal(normalizeRetiredModelId("openai/o4-mini"), "gpt-5.4");
  assert.equal(normalizeRetiredModelId("gpt-5.6-luna"), "gpt-5.6-luna");
  assert.equal(normalizeModelId("gpt-5-mini"), "gpt-5.4");
  assert.equal(normalizeModelId("o4-mini"), "gpt-5.4");
  assert.equal(normalizeModelId("o4-mini-openai"), "gpt-5.4");
  assert.equal(normalizeModelId("openai/gpt-5-mini"), "gpt-5.4");
});

test("universal client wrapper prevents stale callers from executing GPT-5 Mini", async () => {
  const seen: any[] = [];
  const client = fakeClient(async (params) => {
    seen.push(params);
    return { ok: true };
  });
  wrapClientWithParamAdaptation(client);

  const caller = { model: "gpt-5-mini", messages: [{ role: "user", content: "hi" }] };
  await client.chat.completions.create(caller);

  assert.equal(seen[0].model, "gpt-5.4");
  assert.equal(caller.model, "gpt-5-mini", "caller-owned params stay immutable");
});

test("universal client wrapper blocks provider-prefixed GPT-5 Mini", async () => {
  let seenModel = "";
  const client = fakeClient(async (params) => {
    seenModel = params.model;
    return { ok: true };
  });
  wrapClientWithParamAdaptation(client);

  await client.chat.completions.create({ model: "openai/gpt-5-mini", messages: [] });

  assert.equal(seenModel, "gpt-5.4");
});

test("shared Replit SDK patch normalizes retired model ids before provider execution", async () => {
  const seen: any[] = [];
  const caller = { model: "openai/gpt-5-mini", messages: [{ role: "user", content: "hi" }] };
  const create = buildPatchedCreate(
    async (params: any) => {
      seen.push(params);
      return { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } };
    },
    (params) => params.model,
    () => 1,
    "llm.replit",
    async () => true,
  );

  await create(caller);

  assert.equal(seen[0].model, "gpt-5.4");
  assert.equal(caller.model, "openai/gpt-5-mini", "caller-owned params stay immutable");
});

test("shared streaming patch preserves nested caller parameters while normalizing retired ids", async () => {
  let seen: any;
  async function* source() {
    yield { choices: [{ delta: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  }
  const create = buildPatchedCreate(
    async (params: any) => {
      seen = params;
      return source();
    },
    (params) => params.model,
    () => 1,
    "llm.replit",
    async () => true,
  );
  const streamOptions = { include_usage: false, custom: "caller-owned" };
  const caller = { model: "gpt-5-mini", stream: true, stream_options: streamOptions, messages: [] };

  const stream: any = await create(caller);
  for await (const _chunk of stream) {}

  assert.equal(seen.model, "gpt-5.4");
  assert.notEqual(seen, caller);
  assert.notEqual(seen.stream_options, streamOptions);
  assert.deepEqual(streamOptions, { include_usage: false, custom: "caller-owned" });
  assert.equal(caller.model, "gpt-5-mini");
});

test("Responses API patch normalizes exact and prefixed retired ids without caller mutation", async () => {
  for (const retired of ["gpt-5-mini", "openai/gpt-5-mini"]) {
    for (const stream of [false, true]) {
      let seen: any;
      const create = buildPatchedResponsesCreate(
        async (params: any) => {
          seen = params;
          if (!stream) return { usage: { input_tokens: 1, output_tokens: 1 } };
          return (async function* () {
            yield {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 1 } },
            };
          })();
        },
        retired,
        1,
        "llm.replit",
        async () => true,
      );
      const caller = { model: retired, input: "hi", stream };
      const result: any = await create(caller);
      if (stream) for await (const _event of result) {}
      assert.equal(seen.model, "gpt-5.4");
      assert.equal(caller.model, retired);
      assert.notEqual(seen, caller);
    }
  }
});

test("strips the rejected param and retries the SAME model to success", async () => {
  const seen: any[] = [];
  let calls = 0;
  const client = fakeClient(async (params) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    calls++;
    if (calls === 1) throw new Error("temperature is not supported by this model");
    return { ok: true, model: params.model };
  });
  wrapClientWithParamAdaptation(client);
  const caller = { model: "claude-x", temperature: 0.7, messages: [{ role: "user", content: "hi" }] };
  const res = await client.chat.completions.create(caller);
  assert.equal(res.ok, true);
  assert.equal(res.model, "claude-x"); // SAME model, no failover here
  assert.equal(calls, 2);
  assert.equal("temperature" in seen[0], true);  // first attempt had it
  assert.equal("temperature" in seen[1], false); // retry stripped it
});

test("never mutates the caller's params object", async () => {
  let calls = 0;
  const client = fakeClient(async (params) => {
    calls++;
    if (calls === 1) throw new Error("temperature unsupported");
    return { ok: true };
  });
  wrapClientWithParamAdaptation(client);
  const caller: any = { model: "m", temperature: 0.5 };
  await client.chat.completions.create(caller);
  assert.equal(caller.temperature, 0.5, "caller object must be untouched");
});

test("a non-param error propagates (no infinite retry, no swallow)", async () => {
  let calls = 0;
  const client = fakeClient(async () => { calls++; throw new Error("upstream 500"); });
  wrapClientWithParamAdaptation(client);
  await assert.rejects(() => client.chat.completions.create({ model: "m" }), /upstream 500/);
  assert.equal(calls, 1); // tried once, then gave up — not a param error
});

test("bounded by MAX_PARAM_STRIPS when the provider keeps rejecting", async () => {
  let calls = 0;
  // Always reject temperature, and the wrapper keeps a working copy; after the
  // first strip temperature is gone so a stable provider would stop — simulate a
  // pathological provider that always errors to prove the cap holds.
  const client = fakeClient(async () => { calls++; throw new Error("temperature bad"); });
  wrapClientWithParamAdaptation(client);
  await assert.rejects(() => client.chat.completions.create({ model: "m", temperature: 1 }));
  // 1 initial + at most MAX_PARAM_STRIPS retries, but stripRejectedParam returns
  // null once temperature is gone, so it stops early (2 calls). Either way it is
  // bounded and never loops forever.
  assert.ok(calls <= MAX_PARAM_STRIPS + 1, `calls ${calls} must be bounded`);
});

test("idempotent: re-wrapping the same client never stacks", async () => {
  let calls = 0;
  const client = fakeClient(async (params) => {
    calls++;
    if (calls === 1) throw new Error("temperature unsupported");
    return { ok: true };
  });
  const a = wrapClientWithParamAdaptation(client);
  const b = wrapClientWithParamAdaptation(client); // no-op second wrap
  assert.equal(a, b);
  await client.chat.completions.create({ model: "m", temperature: 0.7 });
  assert.equal(calls, 2, "exactly one strip+retry — no double-wrapping");
});

test("caller AbortSignal wins over a strip-retry", async () => {
  const ac = new AbortController();
  let calls = 0;
  const client = fakeClient(async () => {
    calls++;
    ac.abort(); // deadline fires concurrently with the param rejection
    throw new Error("temperature unsupported");
  });
  wrapClientWithParamAdaptation(client);
  await assert.rejects(
    () => client.chat.completions.create({ model: "m", temperature: 1 }, { signal: ac.signal }),
    /temperature unsupported/,
  );
  assert.equal(calls, 1, "must NOT strip-retry once the caller has aborted");
});

test("swaps max_tokens -> max_completion_tokens (gpt-5/o-series forward swap)", () => {
  const p: any = { model: "gpt-5-mini", max_tokens: 1200 };
  assert.equal(
    stripRejectedParam(p, new Error("400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")),
    "max_tokens→max_completion_tokens",
  );
  assert.equal(p.max_tokens, undefined);
  assert.equal(p.max_completion_tokens, 1200);
});

test("forward swap does not fire when max_completion_tokens already present", () => {
  const p: any = { model: "m", max_tokens: 100, max_completion_tokens: 200 };
  assert.equal(stripRejectedParam(p, new Error("Unsupported parameter: 'max_tokens'")), null);
});

test("generic unknown-parameter error does NOT trigger the forward swap", () => {
  const p: any = { model: "m", max_tokens: 100 };
  assert.equal(stripRejectedParam(p, new Error("Unknown parameter: 'foo_bar'")), null);
  assert.equal(p.max_tokens, 100);
  assert.equal(p.max_completion_tokens, undefined);
});

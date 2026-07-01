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
  stripRejectedParam,
  wrapClientWithParamAdaptation,
} from "../../server/lib/param-adaptation";

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

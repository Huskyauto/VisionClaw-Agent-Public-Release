import test from "node:test";
import assert from "node:assert/strict";
import { wrapProfundoTransientRetry } from "../../server/lib/profundo-transient-retry";

test("opted-in Profundo request honors Retry-After and resends the same request once", async () => {
  const calls: any[] = [];
  const waits: number[] = [];
  const params = { model: "gpt-5.6-sol", max_tokens: 16384, messages: [] };
  const failure = Object.assign(new Error("Service temporarily unavailable"), {
    status: 503, headers: new Headers({ "retry-after": "30" }),
  });
  const original = { chat: { completions: { create: async (body: any, options: any) => {
    calls.push({ body, options });
    if (calls.length === 1) throw failure;
    return { choices: [{ message: { content: "ONLINE" } }] };
  } } } };
  const client = wrapProfundoTransientRetry(original, { sleep: async ms => { waits.push(ms); } });
  const result = await client.chat.completions.create(params, { maxRetries: 0, profundoRetry: true });
  assert.equal(result.choices[0].message.content, "ONLINE");
  assert.deepEqual(waits, [30000]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.body === params && call.options.maxRetries === 0));
  assert.ok(calls.every(call => !("profundoRetry" in call.options)));
  assert.notEqual(client, original);
});

test("invalid or excessive Retry-After never triggers an early retry", async () => {
  for (const value of ["-1", "61", "not-a-date", "Infinity"]) {
    let calls = 0;
    const error = Object.assign(new Error("busy"), {
      status: 503, headers: new Headers({ "retry-after": value }),
    });
    const client = wrapProfundoTransientRetry({ chat: { completions: {
      create: async () => { calls++; throw error; },
    } } }, { sleep: async () => { assert.fail("Must not wait or retry"); } });
    await assert.rejects(client.chat.completions.create({}, { profundoRetry: true }), e => e === error);
    assert.equal(calls, 1);
  }
});

test("ordinary calls, auth errors, parameter errors and ambiguous timeouts are never retried", async () => {
  for (const scenario of [
    { status: 503, optIn: undefined, name: "Error" },
    { status: 503, optIn: "true", name: "Error" },
    ...[400, 401, 403, 500, undefined].map(status => ({ status, optIn: true, name: "Error" })),
    { status: 503, optIn: true, name: "APIConnectionTimeoutError" },
    { status: 503, optIn: true, name: "AbortError" },
  ]) {
    let calls = 0;
    const error = Object.assign(new Error("failure"), { status: scenario.status, name: scenario.name });
    const original = { chat: { completions: { create: async () => { calls++; throw error; } } } };
    const client = wrapProfundoTransientRetry(original, {
      sleep: async () => { assert.fail("Must not retry this failure"); },
    });
    await assert.rejects(client.chat.completions.create({}, { profundoRetry: scenario.optIn }), e => e === error);
    assert.equal(calls, 1);
  }
});

test("HTTP-date Retry-After is honored and a second failure propagates without a third call", async () => {
  const waits: number[] = [];
  let calls = 0;
  const now = Date.parse("2026-10-05T21:00:00Z");
  const error = Object.assign(new Error("busy"), {
    status: 429, headers: new Headers({ "retry-after": "Mon, 05 Oct 2026 21:00:30 GMT" }),
  });
  const client = wrapProfundoTransientRetry({ chat: { completions: {
    create: async () => { calls++; throw error; },
  } } }, { now: () => now, sleep: async ms => { waits.push(ms); } });
  await assert.rejects(client.chat.completions.create({}, { profundoRetry: true }), e => e === error);
  assert.deepEqual(waits, [30000]);
  assert.equal(calls, 2);
});

test("abort during the wait prevents the second request", async () => {
  const abort = new AbortController();
  let calls = 0;
  const error = Object.assign(new Error("busy"), { status: 502 });
  const client = wrapProfundoTransientRetry({ chat: { completions: {
    create: async () => { calls++; throw error; },
  } } }, { sleep: async () => { abort.abort(); } });
  await assert.rejects(client.chat.completions.create({}, {
    profundoRetry: true, signal: abort.signal,
  }), e => e === error);
  assert.equal(calls, 1);
});

test("real wait responds to caller cancellation, and successful streams are not replayed", async () => {
  const abort = new AbortController();
  let calls = 0;
  const client = wrapProfundoTransientRetry({ chat: { completions: {
    create: async () => { calls++; throw Object.assign(new Error("busy"), { status: 503 }); },
  } } });
  const pending = client.chat.completions.create({}, { profundoRetry: true, signal: abort.signal });
  setTimeout(() => abort.abort(), 5);
  await assert.rejects(pending, /aborted/);
  assert.equal(calls, 1);
  const stream = { async *[Symbol.asyncIterator]() { yield "partial"; throw new Error("stream broke"); } };
  const streamClient = wrapProfundoTransientRetry({ chat: { completions: {
    create: async () => stream,
  } } });
  const actual = await streamClient.chat.completions.create({}, { profundoRetry: true });
  assert.equal(actual, stream);
  await assert.rejects(async () => { for await (const _part of actual) { /* consume */ } }, /stream broke/);
});

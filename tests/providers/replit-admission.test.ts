import assert from "node:assert/strict";
import test from "node:test";
import { createReplitAdmissionFetch, replitRetryDelay } from "../../server/lib/replit-admission";

test("429 pauses subsequent requests without issuing another inference call", async () => {
  let calls = 0;
  let held = false;
  let release: (() => void) | undefined;
  let scheduledMs = 0;
  const transport = createReplitAdmissionFetch({
    queueMs: 0,
    acquire: async () => {
      if (held) return null;
      held = true;
      return async () => { held = false; };
    },
    schedule: (fn, ms) => { release = fn; scheduledMs = ms; },
    fetch: async () => {
      calls++;
      return new Response('{"error":{"code":"RATELIMIT_EXCEEDED"}}', {
        status: 429, headers: { "retry-after": "75" },
      });
    },
  });
  const first = await transport("https://example.test/v1/chat/completions", { method: "POST" });
  assert.equal(first.status, 429);
  assert.equal(scheduledMs, 75_000);
  const second = await transport("https://example.test/v1/chat/completions", { method: "POST" });
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
  release!();
  await Promise.resolve();
  assert.equal(held, false);
});

test("retry header accepts date, seconds, and SDK millisecond form without timer overflow", () => {
  assert.equal(replitRetryDelay(new Headers({ "retry-after-ms": "2500" })), 2500);
  assert.equal(replitRetryDelay(new Headers({ "retry-after": "Fri, 30 Oct 2026 12:01:00 GMT" }),
    Date.parse("2026-10-30T12:00:00Z")), 60_000);
  assert.equal(replitRetryDelay(new Headers({ "retry-after": "invalid" })), 60_000);
  assert.equal(replitRetryDelay(new Headers({ "retry-after": "9999999999" })), 2_147_000_000);
});

test("a durable cooldown releases the short session instead of pinning a socket for Retry-After", async () => {
  let saved = 0, releaseDelay = 0;
  const lease = Object.assign(async () => {}, { cooldown: async (ms: number) => { saved = ms; } });
  const transport = createReplitAdmissionFetch({
    acquire: async () => lease,
    schedule: (_fn, ms) => { releaseDelay = ms; },
    fetch: async () => new Response("", { status: 429, headers: { "retry-after": "120" } }),
  });
  assert.equal((await transport("https://example.test/v1/chat/completions", { method: "POST" })).status, 429);
  assert.equal(saved, 120_000);
  assert.equal(releaseDelay, 500);
});

test("cancellation after acquisition never sends; network errors still release the session", async () => {
  const controller = new AbortController();
  let calls = 0, releases = 0;
  const pending: (() => void)[] = [];
  const transport = createReplitAdmissionFetch({
    queueMs: 0, schedule: fn => { pending.push(fn); },
    acquire: async () => { controller.abort(); return async () => { releases++; }; },
    fetch: async () => { calls++; return new Response("unexpected"); },
  });
  await assert.rejects(() => transport("https://example.test/v1/chat/completions", {
    method: "POST", signal: controller.signal,
  }), { name: "AbortError" });
  assert.equal(calls, 0);
  pending.forEach(fn => fn());
  await Promise.resolve();
  assert.equal(releases, 1);
  const failure = createReplitAdmissionFetch({
    schedule: fn => fn(), acquire: async () => async () => { releases++; },
    fetch: async () => { throw new Error("network failure"); },
  });
  await assert.rejects(() => failure("https://example.test/v1/responses", { method: "POST" }), /network failure/);
  assert.equal(releases, 2);
});

test("streams pass through untouched and admission failures do not dispatch", async () => {
  let calls = 0;
  const body = "data: {\"usage\":{\"prompt_tokens\":2}}\n\ndata: [DONE]\n\n";
  const transport = createReplitAdmissionFetch({
    schedule: fn => fn(), acquire: async () => async () => {},
    fetch: async () => { calls++; return new Response(body, { headers: { "content-type": "text/event-stream" } }); },
  });
  assert.equal(await (await transport("https://example.test/v1/chat/completions", { method: "POST" })).text(), body);
  const unavailable = createReplitAdmissionFetch({
    acquire: async () => { throw new Error("private DB detail"); },
    fetch: async () => { calls++; return new Response("unexpected"); },
  });
  const response = await unavailable("https://example.test/v1/embeddings", { method: "POST" });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private DB detail/);
  assert.equal(calls, 1);
});

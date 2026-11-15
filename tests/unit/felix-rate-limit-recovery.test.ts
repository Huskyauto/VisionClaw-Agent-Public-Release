import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { createReplitAdmissionFetch } from "../../server/lib/replit-admission";
import { withFelixReplitRateLimitRecovery } from "../../server/felix-expert-route";

test("Felix retries a confirmed Replit 429 once after its cooldown without replaying completed work", async () => {
  let requests = 0;
  let toolExecutions = 0;
  const waits: number[] = [];
  const budget = { used: false };
  toolExecutions++; // Earlier completed work is outside the completion retry.
  const result = await withFelixReplitRateLimitRecovery(async () => {
    requests++;
    if (requests === 1) throw Object.assign(new Error("rate limited"), {
      status: 429, headers: new Headers({ "retry-after-ms": "30198" }),
    });
    return "new completion";
  }, { providerLane: "replit", budget, wait: async ms => { waits.push(ms); } });
  assert.equal(result, "new completion");
  assert.equal(requests, 2);
  assert.equal(toolExecutions, 1);
  assert.deepEqual(waits, [30198]);
  assert.equal(budget.used, true);
});

test("explicit account quota failures do not wait or retry", async () => {
  const quota = Object.assign(new Error("restricted"), {
    status: 429, code: "insufficient_quota", headers: new Headers({ "retry-after": "1" }),
  });
  let requests = 0;
  let waits = 0;
  await assert.rejects(withFelixReplitRateLimitRecovery(async () => {
    requests++;
    throw quota;
  }, { providerLane: "replit", budget: { used: false }, wait: async () => { waits++; } }),
  error => error === quota);
  assert.equal(requests, 1);
  assert.equal(waits, 0);
});

test("uncertain transport, other providers, long cooldowns and spent budgets never replay", async () => {
  const limited = (extra = {}) => Object.assign(new Error("rejected"), {
    status: 429, headers: new Headers({ "retry-after": "1" }), ...extra,
  });
  for (const scenario of [
    { error: limited({ code: "ETIMEDOUT" }), providerLane: "replit", used: false },
    { error: limited({ cause: { code: "ECONNRESET" } }), providerLane: "replit", used: false },
    { error: limited(), providerLane: "profundo", used: false },
    { error: limited(), providerLane: undefined, used: false },
    { error: limited(), providerLane: "replit", used: true },
    { error: limited({ headers: new Headers({ "retry-after": "61" }) }), providerLane: "replit", used: false },
    { error: limited({ status: 503 }), providerLane: "replit", used: false },
    { error: limited({ error: { type: "insufficient_quota" } }), providerLane: "replit", used: false },
  ]) {
    let requests = 0;
    await assert.rejects(withFelixReplitRateLimitRecovery(async () => {
      requests++;
      throw scenario.error;
    }, {
      providerLane: scenario.providerLane, budget: { used: scenario.used },
      wait: async () => { assert.fail("must not wait"); },
    }), error => error === scenario.error);
    assert.equal(requests, 1);
  }
});

test("a turn has only one retry across rounds; a rejected retry stops", async () => {
  const budget = { used: false };
  const rejected = Object.assign(new Error("still restricted"), {
    status: 429, headers: new Headers({ "retry-after": "1" }),
  });
  let requests = 0;
  let waits = 0;
  const request = async () => { requests++; throw rejected; };
  const options = { providerLane: "replit", budget, wait: async () => { waits++; } };
  await assert.rejects(withFelixReplitRateLimitRecovery(request, options), error => error === rejected);
  await assert.rejects(withFelixReplitRateLimitRecovery(request, options), error => error === rejected);
  assert.equal(requests, 3);
  assert.equal(waits, 1);
});

test("successful completions and cancelled waits never trigger an extra request", async () => {
  const options = { providerLane: "replit", budget: { used: false } };
  let requests = 0;
  assert.equal(await withFelixReplitRateLimitRecovery(async () => {
    requests++;
    return "complete";
  }, options), "complete");
  assert.equal(requests, 1);
  const cancelled = new Error("cancelled");
  await assert.rejects(withFelixReplitRateLimitRecovery(async () => {
    requests++;
    throw Object.assign(new Error("rejected"), { status: 429 });
  }, { ...options, wait: async () => { throw cancelled; } }), error => error === cancelled);
  assert.equal(requests, 2);
});

test("real SDK and admission preserve the upstream cooldown before one successful retry", async () => {
  let clock = 0;
  let cooldownUntil = 0;
  let upstreamRequests = 0;
  const transport = createReplitAdmissionFetch({
    acquire: async () => clock < cooldownUntil ? null : Object.assign(async () => {}, {
      cooldown: async (ms: number) => { cooldownUntil = clock + ms; },
    }),
    schedule: fn => { fn(); },
    queueMs: 0,
    fetch: async () => {
      upstreamRequests++;
      return upstreamRequests === 1
        ? Response.json({ error: { message: "busy", type: "rate_limit_error" } },
          { status: 429, headers: { "retry-after-ms": "30198" } })
        : Response.json({
          id: "offline-completion", object: "chat.completion", created: 1, model: "gpt-5.4",
          choices: [{ index: 0, message: { role: "assistant", content: "connected" }, finish_reason: "stop" }],
        });
    },
  });
  // Every request is intercepted by the fixture transport; no live credentials.
  const client = new OpenAI({ apiKey: "offline-fixture", baseURL: "https://fixture.invalid/v1", fetch: transport });
  const reply = await withFelixReplitRateLimitRecovery(
    () => client.chat.completions.create({
      model: "gpt-5.4", messages: [{ role: "user", content: "connection check" }],
    }, { maxRetries: 0 }),
    { providerLane: "replit", budget: { used: false }, wait: async ms => { clock += ms; } },
  );
  assert.equal(reply.choices[0].message.content, "connected");
  assert.equal(upstreamRequests, 2);
  assert.equal(clock, 30198);
});

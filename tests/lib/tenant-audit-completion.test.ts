import test from "node:test";
import assert from "node:assert/strict";
import { invokeAuditRoute, parseAuditObject, AuditRouteRefused, auditProviderFailure,
  auditHealthKey, readAuditProviderHealth } from "../../scripts/lib/tenant-audit-completion";
import { auditRoutes } from "../../scripts/lib/tenant-audit-fallback";

test("completed JSON can be fenced or surrounded by prose without accepting malformed content", () => {
  assert.deepEqual(parseAuditObject('```json\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(parseAuditObject('Result:\n{"findings":[]}\nDone.'), { findings: [] });
  assert.throws(() => parseAuditObject('{"findings":['));
});

test("paid audit route requires automatic owner budget admission before resolving any client", async () => {
  let calls = 0;
  await assert.rejects(() => invokeAuditRoute(auditRoutes()[4], "s", "u", 32000, {
    paidAllowed: () => false, resolve: async () => { calls++; throw Error("must not resolve"); },
  }), /automatic owner budget/);
  assert.equal(calls, 0);
});

test("named paid route uses bounded output and ordinary capped resolver, never owner-selection bypass", async () => {
  await invokeAuditRoute(auditRoutes()[4], "s", "u", 32000, {
    paidAllowed: () => true,
    resolve: async (model, tenant, options) => {
      assert.equal(tenant, 1);
      assert.equal(model, "cheaperinference/gpt-5.6-luna");
      assert.deepEqual(options, {});
      return { actualModelId: "gpt-5.6-luna", client: { chat: { completions: { create: async (body: any, opts: any) => {
        assert.equal(body.max_completion_tokens, 8192);
        assert.equal(opts.maxRetries, 0);
        assert.equal(opts.timeout, 55000);
        assert.ok(opts.signal instanceof AbortSignal);
        return { choices: [{ finish_reason: "stop", message: { content: '{"findings":[]}' } }] };
      } } } } };
    },
  });
});

test("prepaid Standard Compute stays pinned with no direct paid fallback", async () => {
  await invokeAuditRoute(auditRoutes()[1], "s", "u", 4096, {
    resolve: async (model, tenant, options) => {
      assert.equal(model, "gemini-3.1-pro-preview");
      assert.equal(options.providerLane, "standard-compute");
      assert.equal(options.forbidMeteredFallback, true);
      return { actualModelId: "google/gemini-3.1-pro-preview", client: { chat: { completions: { create: async () =>
        ({ choices: [{ finish_reason: "stop", message: { content: '{"findings":[]}' } }] }) } } } };
    },
  });
});

test("refusal gives an audit-only one-hour cooldown without changing global provider authorization", () => {
  const route = auditRoutes()[1], now = 1000;
  const health = auditProviderFailure({}, route, new AuditRouteRefused(), now);
  assert.equal(health[auditHealthKey(route)].until, now + 3600_000);
  assert.deepEqual(readAuditProviderHealth(JSON.parse(JSON.stringify(health))), health);
  assert.throws(() => readAuditProviderHealth({ bad: { until: NaN, failures: 1 } }));
  assert.throws(() => readAuditProviderHealth([]));
  assert.throws(() => readAuditProviderHealth({ bad: { until: 0, failures: 0 } }));
});

test("ordinary provider failures back off per route, up to an hour", () => {
  const route = auditRoutes()[0];
  let health = auditProviderFailure({}, route, Error("503"), 0);
  assert.equal(health[auditHealthKey(route)].until, 300_000);
  for (let i = 0; i < 12; i++) health = auditProviderFailure(health, route, Error("503"), 0);
  assert.equal(health[auditHealthKey(route)].until, 3600_000);
});

test("a resolver that outlives the hard deadline cannot dispatch late", async () => {
  let called = false;
  await assert.rejects(() => invokeAuditRoute(auditRoutes()[0], "s", "u", 128, {
    timeoutMs: 5, resolve: async () => {
      await new Promise(r => setTimeout(r, 25));
      return { actualModelId: "sonnet", client: { chat: { completions: { create: async () => { called = true; return {}; } } } } };
    },
  }), /timed out/);
  await new Promise(r => setTimeout(r, 35));
  assert.equal(called, false);
});

test("paid identity substitution is stopped before model dispatch", async () => {
  let called = false;
  await assert.rejects(() => invokeAuditRoute(auditRoutes()[4], "s", "u", 128, {
    paidAllowed: () => true, resolve: async () => ({ actualModelId: "gpt-5.4",
      client: { chat: { completions: { create: async () => { called = true; return {}; } } } } }),
  }), /identity changed/);
  assert.equal(called, false);
});

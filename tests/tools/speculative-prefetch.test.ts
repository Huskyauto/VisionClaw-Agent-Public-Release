/**
 * Speculative read-only prefetch (server/speculative-prefetch.ts).
 * Pure-logic tests with an injected executor — NEVER imports server/tools.ts
 * and never touches the DB (node-test-db-pool-hang rule).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SPECULATION_ALLOWLIST,
  publicParamsHash,
  prefetchForReplayPlan,
  consumeSpeculativeResult,
  getSpeculationStats,
  _resetSpeculationStateForTests,
} from "../../server/speculative-prefetch";

// The prefetch path dynamically imports the destructive-tool-policy module,
// whose first load can take >25ms — poll instead of a fixed sleep.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function flushUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < timeoutMs) await sleep(20);
  await sleep(20); // one extra tick so trailing cache writes settle
}
const flush = () => sleep(300);

beforeEach(() => {
  _resetSpeculationStateForTests();
  delete process.env.SPEC_PREFETCH_DISABLED;
});
afterEach(() => {
  delete process.env.SPEC_PREFETCH_DISABLED;
});

test("publicParamsHash ignores underscore-prefixed trust params and key order", () => {
  assert.equal(
    publicParamsHash({ _tenantId: 1, _personaId: 7 }),
    publicParamsHash({}),
  );
  assert.equal(
    publicParamsHash({ b: 2, a: 1 }),
    publicParamsHash({ a: 1, b: 2 }),
  );
  assert.notEqual(publicParamsHash({ a: 1 }), publicParamsHash({ a: 2 }));
});

test("allowlisted tool prefetches and serves exactly once for matching tenant+args", async () => {
  const calls: string[] = [];
  prefetchForReplayPlan(
    [{ toolChain: ["check_system_status"] }],
    5,
    async (name) => { calls.push(name); return { ok: true, from: "spec" }; },
  );
  await flushUntil(() => getSpeculationStats().cached >= 1);
  assert.deepEqual(calls, ["check_system_status"]);

  const hit = consumeSpeculativeResult("check_system_status", { _tenantId: 5 });
  assert.equal(hit.hit, true);
  assert.deepEqual(hit.result, { ok: true, from: "spec" });

  // single-use: second consume misses
  const again = consumeSpeculativeResult("check_system_status", { _tenantId: 5 });
  assert.equal(again.hit, false);
});

test("tenant mismatch and public-arg mismatch never hit", async () => {
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 5, async () => ({ models: [] }));
  await flushUntil(() => getSpeculationStats().cached >= 1);
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 6 }).hit, false);
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 5, filter: "x" }).hit, false);
  // exact match still there afterward
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 5 }).hit, true);
});

test("non-allowlisted tools are never prefetched or consumed", async () => {
  const calls: string[] = [];
  prefetchForReplayPlan(
    [{ toolChain: ["send_email", "stripe_create_payout", "web_search"] }],
    5,
    async (name) => { calls.push(name); return {}; },
  );
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(consumeSpeculativeResult("send_email", { _tenantId: 5 }).hit, false);
});

test("error envelopes are never cached", async () => {
  prefetchForReplayPlan([{ toolChain: ["sessions_list"] }], 5, async () => ({ error: "boom" }));
  await flush();
  assert.equal(consumeSpeculativeResult("sessions_list", { _tenantId: 5 }).hit, false);
});

test("kill switch disables prefetch and consume", async () => {
  process.env.SPEC_PREFETCH_DISABLED = "1";
  const calls: string[] = [];
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 5, async (n) => { calls.push(n); return {}; });
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 5 }).hit, false);
});

test("invalid tenant ids never prefetch or consume", async () => {
  const calls: string[] = [];
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 0, async (n) => { calls.push(n); return {}; });
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], -3, async (n) => { calls.push(n); return {}; });
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 1.5 as any, async (n) => { calls.push(n); return {}; });
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(consumeSpeculativeResult("list_models", {}).hit, false);
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: "5" as any }).hit, false);
});

test("prefetch caps at 4 tools per plan and dedupes", async () => {
  const calls: string[] = [];
  prefetchForReplayPlan(
    [
      { toolChain: ["check_system_status", "check_system_status", "list_models"] },
      { toolChain: ["sessions_list", "get_experiments", "delivery_status", "list_conversations"] },
    ],
    5,
    async (name) => { calls.push(name); return {}; },
  );
  await flushUntil(() => calls.length >= 4);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls).size, 4);
});

test("prefetch executor is called with the tenant stamp and speculative marker", async () => {
  let seen: Record<string, any> | undefined;
  prefetchForReplayPlan([{ toolChain: ["delivery_status"] }], 9, async (_n, p) => { seen = p; return {}; });
  await flushUntil(() => seen !== undefined);
  assert.equal(seen?._tenantId, 9);
  assert.equal(seen?._speculativePrefetch, true);
});

test("stats counters move", async () => {
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 5, async () => ({}));
  await flushUntil(() => getSpeculationStats().cached >= 1);
  consumeSpeculativeResult("list_models", { _tenantId: 5 });
  consumeSpeculativeResult("list_models", { _tenantId: 5 });
  const s = getSpeculationStats();
  assert.equal(s.prefetches, 1);
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
});

test("savedMs accrues the prefetch-time tool latency on each hit", async () => {
  // Executor that takes a measurable amount of wall-clock time.
  prefetchForReplayPlan(
    [{ toolChain: ["list_models"] }],
    5,
    async () => { await new Promise((r) => setTimeout(r, 25)); return { models: [] }; },
  );
  await flushUntil(() => getSpeculationStats().cached >= 1, 3000);
  assert.equal(getSpeculationStats().savedMs, 0); // nothing saved until consumed
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 5 }).hit, true);
  const afterHit = getSpeculationStats().savedMs;
  assert.ok(afterHit >= 20, `savedMs=${afterHit} should reflect ~25ms tool latency`);
  // A miss never accrues savings.
  consumeSpeculativeResult("list_models", { _tenantId: 5 });
  assert.equal(getSpeculationStats().savedMs, afterHit);
});

test("a throwing executor is swallowed (fail-open) and caches nothing", async () => {
  prefetchForReplayPlan([{ toolChain: ["list_models"] }], 5, async () => { throw new Error("net down"); });
  await flush();
  assert.equal(consumeSpeculativeResult("list_models", { _tenantId: 5 }).hit, false);
});

test("allowlist contains no obviously mutating tool names", () => {
  for (const t of SPECULATION_ALLOWLIST) {
    assert.doesNotMatch(t, /send|create|delete|update|write|post|exec|pay|refund|publish/i, `suspicious tool in allowlist: ${t}`);
  }
});

test("policy drift: every allowlisted tool is safe/unlisted in TOOL_POLICIES (no trusted/approval/irreversible)", async () => {
  const { TOOL_POLICIES } = await import("../../server/safety/destructive-tool-policy");
  for (const tool of SPECULATION_ALLOWLIST) {
    const p = (TOOL_POLICIES as Record<string, any>)[tool];
    if (!p) continue; // unlisted defaults to safe
    assert.equal(p.risk, "safe", `${tool} must be risk:safe`);
    assert.ok(!p.irreversible, `${tool} must not be irreversible`);
    assert.ok(!p.requiresApproval, `${tool} must not require approval`);
    assert.ok(!p.trustedPersonasOnly, `${tool} must not be trusted-persona-only`);
  }
});

test("dispatcher strips _speculativePrefetch before handlers see params", async () => {
  const { stripTrustSignals } = await import("../../server/tools/context");
  const out = stripTrustSignals({ _speculativePrefetch: true, _tenantId: 5, real: 1 });
  assert.equal(out._speculativePrefetch, undefined);
  assert.equal(out._tenantId, undefined);
  assert.equal(out.real, 1);
});

test("cache never exceeds 64 entries (post-insert eviction)", async () => {
  // 6 allowlisted tools x 11 tenants = 66 potential entries; cap is 4/plan so
  // drive tenants separately.
  for (let tenant = 1; tenant <= 17; tenant++) {
    prefetchForReplayPlan(
      [{ toolChain: ["check_system_status", "list_models", "sessions_list", "get_experiments"] }],
      tenant,
      async () => ({ ok: tenant }),
    );
  }
  await flushUntil(() => getSpeculationStats().prefetches >= 68, 8000);
  assert.equal(getSpeculationStats().prefetches, 68);
  assert.ok(getSpeculationStats().cached <= 64, `cached=${getSpeculationStats().cached} must be <= 64`);
});

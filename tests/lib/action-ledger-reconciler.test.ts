/**
 * Action Ledger S3 — reconciler + probe guard (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md §Acceptance 5, plan.md §S3).
 *
 * Proves with injected fakes (no pg pool touched — node-test-db-pool-hang):
 *   - commit-after-timeout: a probe that finds provider-side proof settles the
 *     row `committed` WITHOUT any re-execution (deps expose no executor);
 *   - proven provider failure (and ONLY proven) settles `failed`;
 *   - unproven / probe-error / no-probe rows stay unknown and are digested to
 *     the owner EXACTLY ONCE (dedup marker respected);
 *   - a throwing probe counts as a probe error, never a settle;
 *   - queue-before-mark ordering (a failed queue must not bury the row);
 *   - sweep is invoked with the configured knobs;
 *   - pure Stripe event matcher semantics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileOnce, type ReconcilerDeps } from "../../server/lib/action-ledger-reconciler";
import {
  matchStripeEventByIdempotencyKey,
  getVerifyProbe,
  STRIPE_TOOL_EVENT_TYPES,
  stripeVerifyProbe,
} from "../../server/lib/action-ledger-probes";
import type { UnknownAttemptRow } from "../../server/lib/action-ledger";

function row(overrides: Partial<UnknownAttemptRow> = {}): UnknownAttemptRow {
  return {
    id: 1,
    tenantId: 7,
    operationId: "op-1",
    toolName: "stripe_create_payout",
    argumentsHash: "h",
    idempotencyKey: "vc-al1-abc",
    risk: "destructive",
    startedAt: new Date("2026-07-12T00:00:00Z"),
    error: null,
    digestedAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReconcilerDeps> = {}) {
  const calls: string[] = [];
  const deps: ReconcilerDeps = {
    sweepStale: overrides.sweepStale ?? (async (m, l) => { calls.push(`sweep:${m}:${l}`); return 0; }),
    listUnknown: overrides.listUnknown ?? (async () => []),
    getProbe: overrides.getProbe ?? (() => undefined),
    settle: overrides.settle ?? (async (id, t, outcome) => { calls.push(`settle:${id}:t${t}:${outcome}`); return true; }),
    markDigested: overrides.markDigested ?? (async (id, t) => { calls.push(`mark:${id}:t${t}`); return true; }),
    queueOwnerDigest: overrides.queueOwnerDigest ?? (async (r, note) => { calls.push(`digest:${r.id}:${note.slice(0, 30)}`); }),
    staleMinutes: overrides.staleMinutes ?? 30,
    batchLimit: overrides.batchLimit ?? 50,
  };
  return { deps, calls };
}

test("S3: deps surface has NO executor by construction (never-retry contract)", () => {
  const { deps } = makeDeps();
  const keys = Object.keys(deps).sort();
  assert.deepEqual(keys, [
    "batchLimit", "getProbe", "listUnknown", "markDigested",
    "queueOwnerDigest", "settle", "staleMinutes", "sweepStale",
  ], "adding an execute/retry capability to ReconcilerDeps is a contract violation");
});

test("S3: sweep runs with configured knobs", async () => {
  const { deps, calls } = makeDeps({ staleMinutes: 45, batchLimit: 10 });
  const s = await reconcileOnce(deps);
  assert.deepEqual(calls, ["sweep:45:10"]);
  assert.equal(s.scanned, 0);
});

test("S3 commit-after-timeout: probe proof settles committed WITHOUT re-execution", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    getProbe: () => async () => ({ outcome: "committed", receipt: { eventId: "evt_1" } }),
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.committed, 1);
  assert.equal(s.stillUnknown, 0);
  assert.deepEqual(calls, ["sweep:30:50", "settle:1:t7:committed"], "no digest, no retry, no extra calls");
});

test("S3: proven provider failure settles failed", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    getProbe: () => async () => ({ outcome: "failed", proven: true }),
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.failed, 1);
  assert.ok(calls.includes("settle:1:t7:failed"));
});

test("S3: UNPROVEN failure does NOT settle — absence of evidence is not failure", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    // malformed/unproven failure shape — must be treated as unknown
    getProbe: () => async () => ({ outcome: "failed" } as any),
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.failed, 0);
  assert.equal(s.stillUnknown, 1);
  assert.ok(!calls.some(c => c.startsWith("settle:")), "no settle on unproven failure");
});

test("S3: unknown probe result → digest once (queue then mark), row left unknown", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    getProbe: () => async () => ({ outcome: "unknown", note: "no matching stripe event" }),
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.stillUnknown, 1);
  assert.equal(s.digested, 1);
  assert.deepEqual(calls, ["sweep:30:50", "digest:1:no matching stripe event", "mark:1:t7"]);
});

test("S3 digest-once: already-digested rows are NOT re-queued", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row({ digestedAt: "2026-07-11T00:00:00Z" })],
    getProbe: () => undefined,
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.stillUnknown, 1);
  assert.equal(s.digested, 0);
  assert.deepEqual(calls, ["sweep:30:50"]);
});

test("S3: probe throw counts as probe error, row digested, never settled", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    getProbe: () => async () => { throw new Error("stripe down"); },
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.probeErrors, 1);
  assert.equal(s.stillUnknown, 1);
  assert.ok(!calls.some(c => c.startsWith("settle:")));
  assert.ok(calls.some(c => c.startsWith("digest:1:")));
});

test("S3: queue failure does NOT mark digested (row never silently buried)", async () => {
  const { deps, calls } = makeDeps({
    listUnknown: async () => [row()],
    queueOwnerDigest: async () => { throw new Error("notifications down"); },
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.digested, 0);
  assert.ok(!calls.some(c => c.startsWith("mark:")), "mark must not run after a failed queue");
});

test("S3: settle returning false (already settled concurrently) is not counted committed", async () => {
  const { deps } = makeDeps({
    listUnknown: async () => [row()],
    getProbe: () => async () => ({ outcome: "committed" }),
    settle: async () => false,
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.committed, 0);
  assert.equal(s.stillUnknown, 1);
});

test("S3: mixed batch aggregates correctly", async () => {
  const rows = [
    row({ id: 1 }),
    row({ id: 2, toolName: "some_other_destructive_tool" }),
    row({ id: 3, digestedAt: "2026-07-11T00:00:00Z", toolName: "another_tool" }),
  ];
  const { deps } = makeDeps({
    listUnknown: async () => rows,
    getProbe: (t) => t === "stripe_create_payout" ? (async () => ({ outcome: "committed" })) : undefined,
  });
  const s = await reconcileOnce(deps);
  assert.equal(s.scanned, 3);
  assert.equal(s.committed, 1);
  assert.equal(s.stillUnknown, 2);
  assert.equal(s.digested, 1);
});

// ---------- pure Stripe matcher + registry ----------

test("S3 matcher: matches only the exact idempotency key", () => {
  const events = [
    { id: "evt_1", type: "payout.created", request: { idempotency_key: "vc-al1-other" } },
    { id: "evt_2", type: "payout.created", request: { idempotency_key: "vc-al1-abc" } },
    { id: "evt_3", type: "payout.created", request: null },
    { id: "evt_4", type: "payout.created" },
  ];
  assert.equal(matchStripeEventByIdempotencyKey(events, "vc-al1-abc")?.id, "evt_2");
  assert.equal(matchStripeEventByIdempotencyKey(events, "vc-al1-missing"), undefined);
  assert.equal(matchStripeEventByIdempotencyKey(events, ""), undefined, "empty key must never match");
  assert.equal(matchStripeEventByIdempotencyKey([], "vc-al1-abc"), undefined);
});

test("S3 registry: stripe money-movement tools get the probe, others get none", () => {
  for (const tool of Object.keys(STRIPE_TOOL_EVENT_TYPES)) {
    assert.equal(getVerifyProbe(tool), stripeVerifyProbe, `${tool} must map to the stripe probe`);
  }
  assert.equal(getVerifyProbe("delete_everything"), undefined);
  assert.equal(getVerifyProbe("toString"), undefined, "prototype names must not resolve a probe");
});

test("S3 probe: unmapped tool short-circuits to unknown without touching stripe", async () => {
  const res = await stripeVerifyProbe(row({ toolName: "not_a_stripe_tool" }) as any);
  assert.equal(res.outcome, "unknown");
});

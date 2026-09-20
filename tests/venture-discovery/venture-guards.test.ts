/**
 * VENTURE DISCOVERY LOOP — query-free guard suite (2026-06-17). Validates the
 * four safety rails without any DB/network:
 *
 *   1. ventureReserveFloorUsd() never reserves below the static estimate nor the
 *      largest real cost observed today (post-drift dynamic floor).
 *   2. resolveVentureCapUsd() grants the daily cap ONLY to the owner tenant
 *      (owner-only economics) and returns 0 for any other tenant.
 *   3. reserveVentureBudget() (with an injected reserve) refuses non-owner
 *      tenants (cap 0), passes through an in-cap reserve, and refuses an
 *      over-cap reserve.
 *   4. nextStage()/STAGES form the ordered 9-stage HITL state machine that ends
 *      (null) after the final stage, so a run can't auto-loop past completion.
 *   5. renderMarkdown() is null-safe.
 *
 * Env set BEFORE the dynamic import because the cap const is computed at module
 * load. after() force-exits so any idle pg pool from the import chain can't hang
 * the runner (see memory: node-test DB-pool hang).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_TENANT_ID = "1";
process.env.VENTURE_DISCOVERY_DAILY_BUDGET_USD = "10";

const budget = await import("../../server/venture-discovery/budget");
const loop = await import("../../server/venture-discovery/loop");
const ledger = await import("../../server/agentic/cost-ledger");
const {
  ventureReserveFloorUsd,
  resolveVentureCapUsd,
  reserveVentureBudget,
  VENTURE_DAILY_BUDGET_USD,
  VENTURE_STAGE_ESTIMATE_USD,
} = budget as any;
const { nextStage, STAGES, renderMarkdown } = loop as any;
const { estimateCostUsd } = ledger as any;

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("ventureReserveFloorUsd: floors at the larger of estimate vs observed", () => {
  assert.equal(ventureReserveFloorUsd(0.5, 0), 0.5);
  assert.equal(ventureReserveFloorUsd(0.5, 2), 2); // post-drift dynamic floor wins
  assert.equal(ventureReserveFloorUsd(0.5, -1), 0.5); // negative observed ignored
  assert.equal(ventureReserveFloorUsd(0.5, NaN), 0.5);
});

test("estimateCostUsd: deepseek ideation model is priced (never $0 for real tokens)", () => {
  // The ideation engine settles to estimateCostUsd(model, tokensIn, tokensOut)
  // when the provider omits usage.cost. If deepseek were unpriced, this returned
  // 0 and the dynamic reserve floor never learned drift (architect GAP #1).
  const cost = estimateCostUsd("deepseek/deepseek-v3.2", 5000, 2000);
  assert.ok(cost > 0, `expected non-zero deepseek estimate, got ${cost}`);
});

test("post-drift floor: a real cost above the static estimate floors future reserves", () => {
  // Simulate settle observing a real spend that drifted above the static stage
  // estimate. ventureReserveFloorUsd must then floor every future reserve to that
  // observed max so concurrency can't under-reserve past the cap.
  const observedDrift = VENTURE_STAGE_ESTIMATE_USD + 1.25;
  assert.equal(
    ventureReserveFloorUsd(VENTURE_STAGE_ESTIMATE_USD, observedDrift),
    observedDrift,
  );
  // And a drift BELOW the static estimate keeps the pessimistic static floor.
  assert.equal(
    ventureReserveFloorUsd(VENTURE_STAGE_ESTIMATE_USD, VENTURE_STAGE_ESTIMATE_USD / 2),
    VENTURE_STAGE_ESTIMATE_USD,
  );
});

test("resolveVentureCapUsd: owner-only economics", () => {
  assert.equal(resolveVentureCapUsd(1), VENTURE_DAILY_BUDGET_USD);
  assert.equal(resolveVentureCapUsd(2), 0);
  assert.equal(resolveVentureCapUsd(999), 0);
});

test("reserveVentureBudget: non-owner tenant never spends (cap 0)", async () => {
  const res = await reserveVentureBudget(2, 0.5, "discovery", {
    reserve: async () => { throw new Error("must not be called for non-owner"); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.capUsd, 0);
});

test("reserveVentureBudget: owner in-cap reserve passes through", async () => {
  const res = await reserveVentureBudget(1, 0.5, "discovery", {
    reserve: async () => ({ ok: true, reservationId: 42, spentUsd: 1 }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.reservationId, 42);
  assert.equal(res.capUsd, VENTURE_DAILY_BUDGET_USD);
});

test("reserveVentureBudget: owner over-cap reserve refused", async () => {
  const res = await reserveVentureBudget(1, 0.5, "discovery", {
    reserve: async () => ({ ok: false, spentUsd: 10 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.remainingUsd, 0);
});

test("reserveVentureBudget: fails CLOSED on reserve error by default", async () => {
  delete process.env.VENTURE_BUDGET_FAILOPEN;
  const res = await reserveVentureBudget(1, 0.5, "discovery", {
    reserve: async () => { throw new Error("ledger down"); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.degraded, true);
});

test("STAGES + nextStage: ordered 9-stage HITL machine that terminates", () => {
  assert.equal(STAGES.length, 9);
  assert.equal(STAGES[0], "discovery");
  assert.equal(STAGES[STAGES.length - 1], "deliverables");
  assert.equal(nextStage("discovery"), "scoring");
  assert.equal(nextStage("decision_gate"), "deliverables");
  assert.equal(nextStage("deliverables"), null); // can't advance past the end
  assert.equal(nextStage("not_a_stage"), null);
});

test("renderMarkdown: null-safe", () => {
  assert.match(renderMarkdown(undefined), /Venture Discovery Report/);
  const md = renderMarkdown({
    run: { id: 7, objective: "test objective", dryRun: true, status: "completed" },
    ideas: [{ id: 1, title: "Idea A" }],
    scores: [{ ideaId: 1, rank: 1, total: 8, recommendation: "build" }],
    decisions: [{ decision: "build", executiveSummary: "ship it" }],
  });
  assert.match(md, /Decision: BUILD/);
  assert.match(md, /Idea A/);
});

/**
 * tests/unit/climb-tracker.test.ts
 *
 * The Climb Tracker card measures self-improvement OUTPUT over time. Its breach
 * rule is the whole point and must stay honest:
 *   · breach ONLY on a STALLED climb (prior output existed, recent window is ~0),
 *   · zero-everywhere is "no data", NEVER a breach (no fabricated alarm),
 *   · a healthy recent week never breaches.
 *
 * computeClimbMetrics is pure (no DB) — these run query-free. Importing the
 * module pulls in `db` but never issues a query, so the pg pool never opens
 * (avoids the run.sh exit-124 hang).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeClimbMetrics, emptyClimbTracker, type ClimbWeek } from "../../server/climb-tracker";

function wk(weekStart: string, proposalsShipped: number, findingsClosed: number): ClimbWeek {
  return { weekStart, proposalsShipped, findingsClosed, total: proposalsShipped + findingsClosed };
}

test("stalled climb breaches: prior output but recent window is zero", () => {
  const weekly = [
    wk("2026-04-13", 4, 0),
    wk("2026-04-20", 3, 1),
    wk("2026-04-27", 2, 0),
    wk("2026-05-04", 1, 0),
    wk("2026-05-11", 0, 0),
    wk("2026-05-18", 0, 0), // recent window (last 2 weeks) = 0 → stalled
  ];
  const m = computeClimbMetrics(weekly);
  assert.equal(m.breached, true);
  assert.ok(m.totalOutput > 0);
  assert.equal(m.thisWeekTotal, 0);
});

test("zero-everywhere is NOT a breach (no data, not a regression)", () => {
  const weekly = [wk("a", 0, 0), wk("b", 0, 0), wk("c", 0, 0)];
  const m = computeClimbMetrics(weekly);
  assert.equal(m.breached, false);
  assert.equal(m.totalOutput, 0);
});

test("healthy recent output does not breach, and trendDelta is computed vs prior avg", () => {
  const weekly = [
    wk("w1", 1, 0), // prior avg basis
    wk("w2", 1, 0),
    wk("w3", 2, 1), // this week total 3
  ];
  const m = computeClimbMetrics(weekly);
  assert.equal(m.breached, false);
  assert.equal(m.thisWeekTotal, 3);
  assert.equal(m.priorAvgTotal, 1); // (1 + 1) / 2
  assert.equal(m.trendDelta, 2); // 3 - 1
});

test("emptyClimbTracker carries the degraded flag through", () => {
  assert.equal(emptyClimbTracker(true).degraded, true);
  assert.equal(emptyClimbTracker(false).degraded, false);
  assert.equal(emptyClimbTracker().breached, false);
});

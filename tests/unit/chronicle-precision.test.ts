/**
 * Chronicle precision (PROOF_LOOPS §10) — pure-aggregator unit tests.
 * Imports ONLY computeChroniclePrecision (DB-free); summarizeChroniclePrecision
 * dynamic-imports the db and is deliberately NOT exercised here (see memory:
 * node-test-db-pool-hang — a lib test that touches db.execute keeps the pg
 * pool open and times the runner out).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeChroniclePrecision,
  type PromotedSkillEvidence,
} from "../../server/lib/chronicle-precision";

function row(over: Partial<PromotedSkillEvidence>): PromotedSkillEvidence {
  return { proposedId: 1, name: "s", exists: true, enabled: true, active: true, reuseCount: 0, ...over };
}

test("no promoted skills ⇒ null precision, NOT breached (no-data state)", () => {
  const s = computeChroniclePrecision([], 4);
  assert.equal(s.promotedCount, 0);
  assert.equal(s.precision, null);
  assert.equal(s.breached, false);
  assert.equal(s.pendingCount, 4);
});

test("proven requires BOTH survival and reuse", () => {
  const s = computeChroniclePrecision([
    row({ proposedId: 1, reuseCount: 3 }),                    // survived + reused ⇒ proven
    row({ proposedId: 2, reuseCount: 0 }),                    // survived, never reused
    row({ proposedId: 3, enabled: false, reuseCount: 5 }),    // reused but disabled ⇒ not proven
    row({ proposedId: 4, exists: false, enabled: false, active: false }), // deleted
  ]);
  assert.equal(s.promotedCount, 4);
  assert.equal(s.survivedCount, 2);
  assert.equal(s.reusedCount, 2);
  assert.equal(s.provenCount, 1);
  assert.equal(s.precision, 0.25);
  assert.equal(s.breached, true); // 0.25 < 0.5 with real data
});

test("healthy chronicle is not breached", () => {
  const s = computeChroniclePrecision([
    row({ proposedId: 1, reuseCount: 2 }),
    row({ proposedId: 2, reuseCount: 1 }),
    row({ proposedId: 3, reuseCount: 0 }),
  ]);
  assert.equal(s.provenCount, 2);
  assert.equal(s.precision, 0.667);
  assert.equal(s.breached, false);
});

test("inactive (superseded) skills don't count as survived", () => {
  const s = computeChroniclePrecision([row({ active: false, reuseCount: 9 })]);
  assert.equal(s.survivedCount, 0);
  assert.equal(s.provenCount, 0);
  assert.equal(s.precision, 0);
  assert.equal(s.breached, true);
});

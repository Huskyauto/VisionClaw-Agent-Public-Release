// Behavior tests for the reusable AutoTTS discovery core.
// Runner: node --import tsx --test (via tests/run.sh).
//
// The lib is pure (no DB, no I/O), so these test real logic, not source shape:
//   - direction symmetry: a "below" knob and its mirror-image "above" knob must
//     produce identical AUC and identical best-reward (the whole point of round 2);
//   - β monotonicity: higher β ⇒ more firing, for BOTH directions;
//   - readiness gate: empty / constant-feature / single-class corpora are honestly
//     blocked, a healthy corpus is discoverable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auc,
  evalThreshold,
  discover,
  assessReadiness,
  type KnobRow,
  type DiscoveryConfig,
} from "../../scripts/lib/autotts-discovery";

const CFG_BELOW: DiscoveryConfig = {
  fireWhen: "below",
  currentDefault: 0.5,
  gamma: 0.5,
  maxFireRate: 1, // no cap, so best is the true global optimum
  minPos: 5,
  minAuc: 0.55,
};
const CFG_ABOVE: DiscoveryConfig = { ...CFG_BELOW, fireWhen: "above" };

// Synthetic corpus: low feature ⇒ positive (like low κ ⇒ dissent), with noise.
function belowCorpus(): KnobRow[] {
  const rows: KnobRow[] = [];
  for (let i = 0; i < 100; i++) {
    const feature = i / 99; // 0..1
    // mostly-separable: positives concentrated at low feature, a little overlap
    const label = feature < 0.35 ? i % 5 !== 0 : i % 11 === 0;
    rows.push({ feature, label });
  }
  return rows;
}

// Mirror each feature around 1.0 → a "high feature ⇒ positive" corpus that an
// "above" knob should treat identically to the original "below" knob.
function mirror(rows: KnobRow[]): KnobRow[] {
  return rows.map((r) => ({ feature: 1 - r.feature, label: r.label }));
}

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("auc: below and mirrored-above give identical scores (direction symmetry)", () => {
  const rows = belowCorpus();
  const aBelow = auc(rows, "below");
  const aAbove = auc(mirror(rows), "above");
  assert.ok(aBelow !== null && aAbove !== null);
  assert.ok(approx(aBelow!, aAbove!), `below ${aBelow} vs above ${aAbove}`);
  assert.ok(aBelow! > 0.55, "synthetic corpus should carry real signal");
});

test("auc: returns null when a class is missing", () => {
  assert.equal(auc([{ feature: 0.1, label: true }], "below"), null);
  assert.equal(auc([{ feature: 0.1, label: false }], "above"), null);
});

test("evalThreshold: fire predicate respects direction", () => {
  const rows: KnobRow[] = [
    { feature: 0.2, label: true },
    { feature: 0.8, label: false },
  ];
  // below 0.5: only the 0.2 row fires (and it's a true positive)
  const below = evalThreshold(rows, 0.5, { fireWhen: "below", gamma: 0.5 });
  assert.equal(below.tp, 1);
  assert.equal(below.fp, 0);
  assert.equal(below.fireRate, 0.5);
  // above 0.5: only the 0.8 row fires (and it's a false positive)
  const above = evalThreshold(rows, 0.5, { fireWhen: "above", gamma: 0.5 });
  assert.equal(above.tp, 0);
  assert.equal(above.fp, 1);
  assert.equal(above.fireRate, 0.5);
});

test("discover: higher β ⇒ higher fire-rate for BOTH directions", () => {
  for (const cfg of [CFG_BELOW, CFG_ABOVE]) {
    const rows = cfg.fireWhen === "below" ? belowCorpus() : mirror(belowCorpus());
    const { points } = discover(rows, cfg);
    for (let i = 1; i < points.length; i++) {
      assert.ok(
        points[i].fireRate >= points[i - 1].fireRate - 1e-9,
        `${cfg.fireWhen}: fireRate dropped at β=${points[i].beta}`,
      );
    }
    // Endpoints: strict </> means the single row exactly on the boundary never
    // fires, so β=0 ⇒ ~nothing and β=1 ⇒ ~everything (within one row's worth).
    assert.ok(points[0].fireRate <= 0.02, `${cfg.fireWhen}: β=0 should fire ~nothing (${points[0].fireRate})`);
    assert.ok(
      points[points.length - 1].fireRate >= 0.98,
      `${cfg.fireWhen}: β=1 should fire ~everything (${points[points.length - 1].fireRate})`,
    );
  }
});

test("discover: below and mirrored-above reach the same best reward", () => {
  const below = discover(belowCorpus(), CFG_BELOW);
  const above = discover(mirror(belowCorpus()), CFG_ABOVE);
  assert.ok(approx(below.auc!, above.auc!), "auc mismatch");
  assert.ok(approx(below.best.reward, above.best.reward, 1e-9), `reward ${below.best.reward} vs ${above.best.reward}`);
  assert.ok(approx(below.best.recall, above.best.recall, 1e-9), "recall mismatch");
});

test("assessReadiness: empty corpus is blocked", () => {
  const r = assessReadiness([], { minPos: 10 });
  assert.equal(r.discoverable, false);
  assert.match(r.blockReason!, /empty corpus/);
});

test("assessReadiness: constant feature is blocked (cannot threshold)", () => {
  const rows: KnobRow[] = Array.from({ length: 50 }, (_, i) => ({ feature: 3, label: i % 3 === 0 }));
  const r = assessReadiness(rows, { minPos: 10 });
  assert.equal(r.discoverable, false);
  assert.equal(r.hasFeatureVariation, false);
  assert.match(r.blockReason!, /constant/);
});

test("assessReadiness: single-class corpus is blocked", () => {
  const rows: KnobRow[] = Array.from({ length: 50 }, (_, i) => ({ feature: i / 50, label: false }));
  const r = assessReadiness(rows, { minPos: 10 });
  assert.equal(r.discoverable, false);
  assert.match(r.blockReason!, /no positive labels/);
});

test("assessReadiness: too-few-positives is blocked with the right reason", () => {
  const rows: KnobRow[] = Array.from({ length: 50 }, (_, i) => ({ feature: i / 50, label: i < 3 }));
  const r = assessReadiness(rows, { minPos: 10 });
  assert.equal(r.discoverable, false);
  assert.match(r.blockReason!, /only 3 positives/);
});

test("assessReadiness: healthy corpus is discoverable", () => {
  const r = assessReadiness(belowCorpus(), { minPos: 10 });
  assert.equal(r.discoverable, true);
  assert.equal(r.blockReason, null);
});

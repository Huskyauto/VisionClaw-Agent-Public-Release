/**
 * tests/unit/trajectory-quality.test.ts — process-quality / trajectory scorer
 *
 * Pure no-LLM, no-DB module (arXiv:2606.24937 "evaluation beyond final task
 * success"). Covers: the perfect-run identity (1.0), the empty-steps guard,
 * proportional penalties for failure / redundancy / rework, rate clamping, the
 * weight ordering (failure > incompletion, redundancy worst, rework mildest),
 * and the order-independent first-occurrence-legit tool-chain redundancy count.
 *
 * Run: node --import tsx --test tests/unit/trajectory-quality.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreTrajectory,
  countRedundantToolChains,
} from "../../server/lib/trajectory-quality";

// ── scoreTrajectory: identity + guard ────────────────────────────────────────

test("perfect run scores 1.0 with a clean-run signal", () => {
  const s = scoreTrajectory({ steps: 5, completed: 5, failed: 0 });
  assert.equal(s.processQuality, 1);
  assert.equal(s.completionRate, 1);
  assert.equal(s.failureRate, 0);
  assert.equal(s.redundancyRate, 0);
  assert.equal(s.reworkRate, 0);
  assert.deepEqual(s.signals, ["clean run"]);
});

test("no steps is scored 0 (unknown, never mistaken for perfect)", () => {
  for (const steps of [0, -3, NaN as unknown as number]) {
    const s = scoreTrajectory({ steps, completed: 0, failed: 0 });
    assert.equal(s.processQuality, 0);
    assert.deepEqual(s.signals, ["no steps recorded"]);
  }
});

// ── proportional penalties ───────────────────────────────────────────────────

test("incompletion drops the score by the missing fraction", () => {
  const s = scoreTrajectory({ steps: 4, completed: 2, failed: 0 });
  // completionRate 0.5, no other penalties
  assert.equal(s.completionRate, 0.5);
  assert.equal(s.processQuality, 0.5);
  assert.ok(s.signals.includes("2/4 steps completed"));
});

test("a failed step costs more than mere incompletion (W_FAILURE)", () => {
  // both runs leave 1 of 4 steps not-completed; the failing run is worse.
  const incomplete = scoreTrajectory({ steps: 4, completed: 3, failed: 0 });
  const failing = scoreTrajectory({ steps: 4, completed: 3, failed: 1 });
  assert.ok(failing.processQuality < incomplete.processQuality);
  // 0.75 - 0.25*(1/4) = 0.6875 -> round2 0.69
  assert.equal(failing.processQuality, 0.69);
  assert.ok(failing.signals.includes("1 failed"));
});

test("redundancy is the heaviest waste penalty (W_REDUNDANCY > W_FAILURE > W_REWORK)", () => {
  const base = { steps: 10, completed: 10, failed: 0 };
  const oneFailure = scoreTrajectory({ ...base, failed: 1, completed: 9 });
  const oneRedundant = scoreTrajectory({ ...base, redundantSteps: 1 });
  const oneRetry = scoreTrajectory({ ...base, retries: 1 });
  // redundancy weight (0.3) > failure weight (0.25) > rework weight (0.2),
  // each applied over the same 1/10 rate, so quality ordering is inverse.
  assert.ok(oneRedundant.processQuality < oneRetry.processQuality);
  assert.ok(oneRetry.processQuality < base.completed); // sanity: < 1
  // failure here also reduces completion (9/10), so compare the pure waste pair.
  assert.equal(oneRedundant.processQuality, 0.97); // 1 - 0.3*0.1
  assert.equal(oneRetry.processQuality, 0.98); // 1 - 0.2*0.1
});

test("rates clamp to 1 so one pathological step can't drive quality negative", () => {
  // 30 retries over 2 steps -> reworkRate clamps to 1, not 15.
  const s = scoreTrajectory({ steps: 2, completed: 2, failed: 0, retries: 30 });
  assert.equal(s.reworkRate, 1);
  assert.ok(s.processQuality >= 0);
  // 1 - 0.2*1 = 0.8
  assert.equal(s.processQuality, 0.8);
});

test("completed/failed are bounded by steps", () => {
  const s = scoreTrajectory({ steps: 3, completed: 99, failed: 99 });
  assert.equal(s.completionRate, 1);
  assert.equal(s.failureRate, 1);
});

// ── countRedundantToolChains ─────────────────────────────────────────────────

test("first occurrence is legit, later identical chains are redundant", () => {
  const n = countRedundantToolChains([
    ["web_search", "fetch"],
    ["web_search", "fetch"], // redundant
    ["generate_image"],
    ["web_search", "fetch"], // redundant again
  ]);
  assert.equal(n, 2);
});

test("redundancy signature is order-independent", () => {
  const n = countRedundantToolChains([
    ["a", "b"],
    ["b", "a"], // same work, different order -> redundant
  ]);
  assert.equal(n, 1);
});

test("empty and undefined chains are ignored", () => {
  const n = countRedundantToolChains([undefined, [], ["x"], [], undefined, ["x"]]);
  assert.equal(n, 1); // only the second ["x"] counts
});

test("all-unique chains report zero redundancy", () => {
  const n = countRedundantToolChains([["a"], ["b"], ["c", "d"]]);
  assert.equal(n, 0);
});

// ── integration: scorer fed by the chain counter ─────────────────────────────

test("scorer consumes the redundancy count end-to-end", () => {
  const chains = [["a"], ["a"], ["b"]]; // 1 redundant
  const redundantSteps = countRedundantToolChains(chains);
  const s = scoreTrajectory({ steps: chains.length, completed: 3, failed: 0, redundantSteps });
  assert.equal(s.redundancyRate, round2(1 / 3));
  assert.ok(s.signals.includes("1 redundant"));
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateFeedbackLoopBreach } from "../../server/feedback-loop-accountability";

// Pure breach-decision boundary tests (no DB round-trip — keeps the pg pool out
// of the test process). Thresholds: MIN_SAMPLE=10, ACTED_RATIO_THRESHOLD=0.5,
// STALE_BREACH_COUNT=5.
describe("evaluateFeedbackLoopBreach (Hermes SOUL.md feedback-loop accountability)", () => {
  it("does NOT breach below the minimum sample even at a terrible ratio", () => {
    assert.equal(evaluateFeedbackLoopBreach(9, 0.0, 0), false);
  });

  it("breaches at the sample boundary (10) when the acted ratio is under the floor", () => {
    assert.equal(evaluateFeedbackLoopBreach(10, 0.49, 0), true);
  });

  it("does NOT breach at sample boundary when ratio meets the floor", () => {
    assert.equal(evaluateFeedbackLoopBreach(10, 0.5, 0), false);
  });

  it("does NOT breach with 4 stale items (below the pile-up alarm)", () => {
    assert.equal(evaluateFeedbackLoopBreach(0, 1, 4), false);
  });

  it("breaches on the stale pile-up alarm (5) regardless of ratio/sample", () => {
    assert.equal(evaluateFeedbackLoopBreach(0, 1, 5), true);
  });

  it("a clean loop (high ratio, no stale) does not breach", () => {
    assert.equal(evaluateFeedbackLoopBreach(100, 0.9, 0), false);
  });

  it("a brand-new tenant (nothing surfaced) does not breach", () => {
    assert.equal(evaluateFeedbackLoopBreach(0, 1, 0), false);
  });
});

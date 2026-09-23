import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLoopConvergence,
  recommendLoopAllocation,
  type LoopOutcomeObservation,
} from "../../server/lib/loop-portfolio-core";

const outcome = (
  loopKind: string,
  index: number,
  quality: number,
  overrides: Partial<LoopOutcomeObservation> = {},
): LoopOutcomeObservation => ({
  loopKind,
  policyVersion: "v1",
  occurredAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
  quality,
  costUsd: 0.01,
  latencyMs: 100,
  safetyPassed: true,
  safetyEvaluated: true,
  independentlyEvaluated: true,
  persistedQuality: quality,
  explorationValue: 0.5,
  ...overrides,
});

test("loop portfolio convergence requires independently evaluated temporal evidence", () => {
    const observations = Array.from({ length: 8 }, (_, index) =>
      outcome("research", index, 0.5 + index * 0.05, {
        independentlyEvaluated: index < 4,
      }),
    );

    assert.deepEqual(analyzeLoopConvergence(observations), {
      ...analyzeLoopConvergence(observations),
      classification: "insufficient_evidence",
      independentSampleSize: 4,
    });
});

test("loop portfolio does not treat simultaneous samples as a temporal trajectory", () => {
  const observations = Array.from({ length: 8 }, (_, index) =>
    outcome("research", index, 0.4 + index * 0.06, {
      occurredAt: "2026-09-18T00:00:00.000Z",
    }),
  );
  assert.equal(analyzeLoopConvergence(observations).classification, "insufficient_evidence");
});

test("loop portfolio classifies sustained quality gain with stable safety as positive convergence", () => {
    const observations = Array.from({ length: 8 }, (_, index) =>
      outcome("research", index, 0.42 + index * 0.06, {
        costUsd: 0.02 - index * 0.001,
        persistedQuality: 0.4 + index * 0.055,
      }),
    );

    const result = analyzeLoopConvergence(observations);
    assert.equal(result.classification, "positive");
    assert.ok(result.qualitySlope > 0);
    assert.ok(result.costAdjustedQualitySlope > 0);
});

test("loop portfolio forces negative convergence on an independent safety regression", () => {
    const observations = Array.from({ length: 8 }, (_, index) =>
      outcome("repair", index, 0.5 + index * 0.05, {
        safetyPassed: index !== 7,
      }),
    );

    const result = analyzeLoopConvergence(observations);
    assert.equal(result.classification, "negative");
    assert.equal(result.safetyRegressions, 1);
});

test("loop portfolio allocation is advisory and preserves an exploration reserve", () => {
    const observations = [
      ...Array.from({ length: 8 }, (_, index) => outcome("winner", index, 0.45 + index * 0.06)),
      ...Array.from({ length: 8 }, (_, index) => outcome("uncertain", index, 0.5)),
    ];

    const result = recommendLoopAllocation(observations, {
      totalBudgetUnits: 100,
      explorationReserveFraction: 0.2,
    });

    assert.equal(result.mode, "advisory");
    assert.equal(result.recommendations.reduce((sum, item) => sum + item.allocationUnits, 0), 100);
    assert.ok(result.recommendations.find((item) => item.loopKind === "uncertain")!.allocationUnits >= 10);
    assert.ok(result.recommendations.every((item) => item.mayExecute === false));
});
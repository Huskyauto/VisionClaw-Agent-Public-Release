import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreWriteSelection,
  scoreSelectSelection,
  scoreCompressionRetention,
  scoreIsolation,
  scoreContextPolicy,
} from "../../server/lib/context-policy-eval-core";

describe("context-policy-eval-core: Write", () => {
  it("scores durable-fact precision and recall and flags contradicted writes", () => {
    const result = scoreWriteSelection({
      selectedIds: ["durable-a", "noise-a", "contradicted-a"],
      durableIds: ["durable-a", "durable-b"],
      forbiddenIds: ["contradicted-a"],
    });

    assert.equal(result.truePositive, 1);
    assert.equal(result.falsePositive, 2);
    assert.equal(result.falseNegative, 1);
    assert.equal(result.precision, 1 / 3);
    assert.equal(result.recall, 0.5);
    assert.deepEqual(result.forbiddenSelectedIds, ["contradicted-a"]);
    assert.equal(result.passed, false);
  });
});

describe("context-policy-eval-core: Select", () => {
  it("measures evidence recall and penalizes irrelevant retrieval", () => {
    const result = scoreSelectSelection({
      selectedIds: ["evidence-a", "distractor-a"],
      relevantIds: ["evidence-a", "evidence-b"],
      forbiddenIds: ["distractor-a"],
    });

    assert.equal(result.truePositive, 1);
    assert.equal(result.falsePositive, 1);
    assert.equal(result.falseNegative, 1);
    assert.equal(result.precision, 0.5);
    assert.equal(result.recall, 0.5);
    assert.deepEqual(result.forbiddenSelectedIds, ["distractor-a"]);
    assert.equal(result.passed, false);
  });
});

describe("context-policy-eval-core: Compress", () => {
  it("requires every necessary fact to survive compression", () => {
    const result = scoreCompressionRetention({
      retainedIds: ["required-a", "irrelevant-a"],
      requiredIds: ["required-a", "required-b"],
      forbiddenIds: ["secret-a"],
    });

    assert.equal(result.requiredCount, 2);
    assert.equal(result.retainedRequiredCount, 1);
    assert.equal(result.survivalRecall, 0.5);
    assert.deepEqual(result.missingRequiredIds, ["required-b"]);
    assert.deepEqual(result.forbiddenRetainedIds, []);
    assert.equal(result.passed, false);
  });
});

describe("context-policy-eval-core: Isolate", () => {
  it("detects forbidden parent state crossing a handoff", () => {
    const result = scoreIsolation({
      observedIds: ["handoff-a", "parent-trajectory", "irrelevant-tool"],
      requiredIds: ["handoff-a"],
      forbiddenIds: ["parent-trajectory", "irrelevant-tool"],
    });

    assert.deepEqual(result.missingRequiredIds, []);
    assert.deepEqual(result.leakedIds, ["parent-trajectory", "irrelevant-tool"]);
    assert.equal(result.passed, false);
  });
});

describe("context-policy-eval-core: scorecard", () => {
  it("requires full operation coverage before reporting a passing scorecard", () => {
    const complete = scoreContextPolicy({
      write: {
        selectedIds: ["w1"],
        durableIds: ["w1"],
      },
      select: {
        selectedIds: ["s1"],
        relevantIds: ["s1"],
      },
      compress: {
        retainedIds: ["c1"],
        requiredIds: ["c1"],
      },
      isolate: {
        observedIds: ["i1"],
        requiredIds: ["i1"],
      },
    });

    assert.equal(complete.evaluatedOperations, 4);
    assert.equal(complete.coverage, 1);
    assert.equal(complete.degraded, false);
    assert.equal(complete.passed, true);

    const partial = scoreContextPolicy({
      write: {
        selectedIds: ["w1"],
        durableIds: ["w1"],
      },
    });

    assert.equal(partial.evaluatedOperations, 1);
    assert.equal(partial.coverage, 0.25);
    assert.equal(partial.degraded, true);
    assert.equal(partial.passed, false);
  });

  it("does not report a passing scorecard when an operation fails", () => {
    const result = scoreContextPolicy({
      write: {
        selectedIds: ["w1"],
        durableIds: ["w1"],
      },
      select: {
        selectedIds: ["s1"],
        relevantIds: ["s1", "s2"],
      },
      compress: {
        retainedIds: ["c1"],
        requiredIds: ["c1"],
      },
      isolate: {
        observedIds: ["i1"],
        requiredIds: ["i1"],
      },
    });

    assert.equal(result.coverage, 1);
    assert.equal(result.degraded, false);
    assert.deepEqual(result.failedOperations, ["select"]);
    assert.equal(result.passed, false);
  });

  it("uses a fail-closed full-coverage threshold when the threshold is malformed", () => {
    const malformedRuntimeInput = {
      write: {
        selectedIds: ["w1"],
        durableIds: ["w1"],
      },
      minCoverage: Number.NaN,
    };
    const result = scoreContextPolicy(malformedRuntimeInput);

    assert.equal(result.degraded, true);
    assert.equal(result.passed, false);
  });

  it("cannot lower the required operation coverage to make a partial run pass", () => {
    const lowerThresholdRuntimeInput = {
      write: {
        selectedIds: ["w1"],
        durableIds: ["w1"],
      },
      minCoverage: 0,
    };
    const result = scoreContextPolicy(lowerThresholdRuntimeInput);

    assert.equal(result.coverage, 0.25);
    assert.equal(result.degraded, true);
    assert.equal(result.passed, false);
  });
});
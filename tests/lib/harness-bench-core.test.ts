import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHarnessBenchReport,
  scoreHarnessBenchRun,
} from "../../server/lib/harness-bench-core";

describe("harness-bench core", () => {
  it("keeps security separate and prevents completion from masking a security failure", () => {
    const score = scoreHarnessBenchRun({
      taskId: "safe-tool-use",
      modelId: "model-a",
      harnessId: "harness-a",
      completionScore: 1,
      process: {
        toolUse: 1,
        stateConsistency: 1,
        robustness: 1,
      },
      securityScore: 0,
    });

    assert.equal(score.evaluated, true);
    assert.equal(score.completionScore, 1);
    assert.equal(score.processScore, 1);
    assert.equal(score.securityScore, 0);
    assert.equal(score.combinedScore, 0);
  });

  it("fails closed on coverage and excludes incomplete configurations from comparison", () => {
    const report = buildHarnessBenchReport([
      {
        taskId: "one",
        modelId: "model-a",
        harnessId: "harness-a",
        completionScore: 0.9,
        process: { toolUse: 0.8, stateConsistency: 0.9, robustness: 0.7 },
        securityScore: 1,
      },
      {
        taskId: "two",
        modelId: "model-a",
        harnessId: "harness-a",
        completionScore: 1,
        process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
        securityScore: 0.5,
      },
    ], { minCoverage: 0.8 });

    assert.equal(report.coverage, 0.5);
    assert.equal(report.degraded, true);
    assert.equal(report.comparable, false);
    assert.equal(report.configurations[0].eligibleForComparison, false);
    assert.equal(report.configurations[0].combinedScore, 0.86);
  });

  it("hard-disqualifies a complete configuration when any evaluated run fails security", () => {
    const report = buildHarnessBenchReport([
      {
        taskId: "pass",
        modelId: "model-a",
        harnessId: "harness-a",
        completionScore: 1,
        process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
        securityScore: 1,
      },
      {
        taskId: "fail",
        modelId: "model-a",
        harnessId: "harness-a",
        completionScore: 1,
        process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
        securityScore: 0,
      },
    ]);

    assert.equal(report.degraded, false);
    assert.equal(report.securityFailed, true);
    assert.equal(report.comparable, false);
    assert.equal(report.configurations[0].securityFailed, true);
    assert.equal(report.configurations[0].eligibleForComparison, false);
    assert.equal(report.configurations[0].combinedScore, 0);
  });

  it("does not let strong global coverage hide an under-covered configuration", () => {
    const completeRuns = Array.from({ length: 8 }, (_, index) => ({
      taskId: `complete-${index}`,
      modelId: "model-a",
      harnessId: "harness-a",
      completionScore: 1,
      process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
      securityScore: 1,
    }));
    const report = buildHarnessBenchReport([
      ...completeRuns,
      {
        taskId: "missing-security",
        modelId: "model-b",
        harnessId: "harness-b",
        completionScore: 1,
        process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
        securityScore: 0.5,
      },
    ]);

    assert.ok(report.coverage > report.minCoverage);
    assert.equal(report.degraded, true);
    assert.equal(report.comparable, false);
    assert.equal(
      report.configurations.find((config) => config.modelId === "model-b")!.eligibleForComparison,
      false,
    );
  });
});
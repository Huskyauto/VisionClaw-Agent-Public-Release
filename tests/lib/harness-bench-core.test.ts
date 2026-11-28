import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHarnessBenchReport,
  scoreHarnessBenchRun,
} from "../../server/lib/harness-bench-core";

const evidenceRun = (taskId: string, harnessId: string, completionScore = 1) => ({
  taskId, harnessId, modelId: "fixed-model", completionScore,
  process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
  securityScore: 1,
});

describe("harness-bench core", () => {
  it("matches task multisets regardless of order and refuses altered repetition weights", () => {
    const run = (taskId: string, harnessId: string) => ({
      taskId, harnessId, modelId: "fixed-model", completionScore: 1,
      process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
      securityScore: 1,
    });
    for (const [baseline, candidate, expected] of [
      [["a", "b"], ["b", "a"], true],
      [["a", "b"], ["c", "d"], false],
      [["a", "b"], ["a", "a", "b"], false],
      [["a", "a", "b"], ["a", "b", "a"], true],
    ] as const) {
      const report = buildHarnessBenchReport([
        ...baseline.map(taskId => run(taskId, "baseline")),
        ...candidate.map(taskId => run(taskId, "candidate")),
      ]);
      assert.equal(report.taskSetsMatched, expected);
      assert.equal(report.comparable, expected);
      assert.ok(report.configurations.every(config => config.eligibleForComparison === expected));
    }
  });

  it("refuses comparison when a configuration omits a task despite perfect recorded coverage", () => {
    const run = (taskId: string, harnessId: string) => ({
      taskId, harnessId, modelId: "fixed-model", completionScore: 1,
      process: { toolUse: 1, stateConsistency: 1, robustness: 1 },
      securityScore: 1,
    });
    const report = buildHarnessBenchReport([
      run("a", "baseline"), run("b", "baseline"), run("a", "candidate"),
    ]);
    assert.equal(report.coverage, 1);
    assert.equal(report.comparable, false);
    assert.ok(report.configurations.every(config => !config.eligibleForComparison));
  });

  it("refuses to compare different scored subsets even when both configurations meet the floor", () => {
    const tasks = ["recovery", "approval", "budget", "handoff", "delivery"];
    const reportFor = (candidateMissing: string) => buildHarnessBenchReport([
      ...tasks.map(id => evidenceRun(id, "baseline", id === "approval" ? NaN : 1)),
      ...tasks.map(id => evidenceRun(id, "candidate", id === candidateMissing ? NaN : 1)),
    ]);

    const different = reportFor("budget");
    assert.equal(different.coverage, 0.8);
    assert.equal(different.degraded, false);
    assert.equal(different.taskSetsMatched, true);
    assert.equal(different.comparable, false);
    assert.ok(different.configurations.every(config => !config.eligibleForComparison));

    const same = reportFor("approval");
    assert.equal(same.coverage, 0.8);
    assert.equal(same.comparable, true);
    assert.ok(same.configurations.every(config => config.eligibleForComparison));
  });

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

  it("keeps a recorded security failure even when the same row cannot be scored", () => {
    const tasks = ["recovery", "approval", "budget", "handoff", "delivery"];
    const run = (taskId: string, harnessId: string) =>
      evidenceRun(taskId, harnessId, taskId === "approval" ? NaN : 1);
    const failure = { ...run("approval", "candidate"), securityScore: 0 };
    const failedScore = scoreHarnessBenchRun(failure);
    assert.equal(failedScore.evaluated, false);
    assert.equal(failedScore.securityScore, 0);
    assert.equal(failedScore.combinedScore, null);

    const report = buildHarnessBenchReport([
      ...tasks.map(id => run(id, "baseline")),
      ...tasks.map(id => id === "approval" ? failure : run(id, "candidate")),
    ]);
    const candidate = report.configurations.find(config => config.harnessId === "candidate")!;
    assert.equal(report.coverage, 0.8);
    assert.equal(report.degraded, false);
    assert.equal(report.securityFailed, true);
    assert.equal(report.comparable, false);
    assert.equal(candidate.eligibleForComparison, false);
    assert.equal(candidate.securityPassRate, 0.8);
    assert.equal(candidate.combinedScore, 0);
  });

  it("does not certify a comparison with no scored evidence even at a zero coverage floor", () => {
    for (const runs of [[], [evidenceRun("recovery", "baseline", NaN)]]) {
      const report = buildHarnessBenchReport(runs, { minCoverage: 0 });
      assert.equal(report.degraded, true);
      assert.equal(report.comparable, false);
    }
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
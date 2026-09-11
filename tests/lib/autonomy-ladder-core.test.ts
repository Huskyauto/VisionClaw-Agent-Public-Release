import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTONOMY_CONDITIONS,
  buildAutonomyPrompt,
  classifyAutonomyFailure,
  computeAutonomyProviderRequestCeiling,
  countStrictJudgePasses,
  summarizeAutonomyResults,
  validateAutonomySet,
} from "../../server/lib/autonomy-ladder-core";

const VALID_CASE = {
  id: "trend-1",
  category: "synthetic-analysis",
  goal: "Identify whether the weekly measurements improved.",
  data: "Week 1: 10. Week 2: 12. Week 3: 15.",
  methodLabel: "a simple time-series comparison",
  procedure: "Calculate the change from the first measurement to the last and state the direction.",
  rubric: [
    "Computes the change as +5.",
    "States that the measurements improved.",
  ],
};

describe("autonomy-ladder-core: fixture validation and prompts", () => {
  it("validates a paired research fixture and exposes all three conditions", () => {
    const cases = validateAutonomySet({ version: 1, cases: [VALID_CASE] });
    assert.equal(cases.length, 1);
    assert.deepEqual(AUTONOMY_CONDITIONS, ["full_procedure", "method_hint", "goal_data"]);
  });

  it("rejects malformed and duplicate research cases", () => {
    assert.throws(() => validateAutonomySet({ version: 1, cases: [] }), /no cases/i);
    assert.throws(
      () => validateAutonomySet({ version: 1, cases: [{ ...VALID_CASE, rubric: [] }] }),
      /malformed/i,
    );
    assert.throws(
      () => validateAutonomySet({ version: 1, cases: [VALID_CASE, VALID_CASE] }),
      /duplicate/i,
    );
    assert.throws(() => validateAutonomySet({ version: 2, cases: [VALID_CASE] }), /unsupported/i);
    assert.throws(
      () => validateAutonomySet({ version: 1, cases: [{ ...VALID_CASE, extra: true }] }),
      /malformed/i,
    );
    assert.throws(
      () => validateAutonomySet({ version: 1, cases: [{ ...VALID_CASE, minScore: 2 }] }),
      /malformed/i,
    );
  });

  it("removes procedural hand-holding one condition at a time", () => {
    const c = validateAutonomySet({ version: 1, cases: [VALID_CASE] })[0];
    const full = buildAutonomyPrompt(c, "full_procedure");
    const method = buildAutonomyPrompt(c, "method_hint");
    const goalData = buildAutonomyPrompt(c, "goal_data");

    assert.match(full, /PROCEDURE/i);
    assert.match(method, /METHOD HINT/i);
    assert.doesNotMatch(method, /Calculate the change/);
    assert.doesNotMatch(goalData, /PROCEDURE|METHOD HINT/i);
    assert.match(goalData, /determine the method/i);
  });
});

describe("autonomy-ladder-core: paired summaries", () => {
  it("reports condition scores, drops, retention, and failure counts", () => {
    const results = [
      { caseId: "a", condition: "full_procedure" as const, evaluated: true, score: 1, passedItems: 2, totalItems: 2 },
      { caseId: "a", condition: "method_hint" as const, evaluated: true, score: 0.75, passedItems: 3, totalItems: 4 },
      { caseId: "a", condition: "goal_data" as const, evaluated: true, score: 0.5, passedItems: 1, totalItems: 2 },
      { caseId: "b", condition: "full_procedure" as const, evaluated: true, score: 1, passedItems: 2, totalItems: 2 },
      { caseId: "b", condition: "method_hint" as const, evaluated: false, score: null, passedItems: 0, totalItems: 2, error: "grading failed" },
      { caseId: "b", condition: "goal_data" as const, evaluated: true, score: 0.5, passedItems: 1, totalItems: 2 },
    ];

    const partial = summarizeAutonomyResults(results, ["a", "b"]);
    assert.equal(partial.degraded, true);
    assert.equal(partial.conditions.full_procedure.suiteScore, 1);
    assert.equal(partial.conditions.method_hint.suiteScore, 0.75);
    assert.equal(partial.conditions.goal_data.suiteScore, 0.5);
    assert.equal(partial.comparison.pairedCases, 1);
    assert.equal(partial.comparison.goalDataDrop, 0.5);
    assert.equal(partial.comparison.goalDataRetention, 0.5);
    assert.equal(partial.conditions.method_hint.failureCounts.grading, 1);
  });

  it("fails closed when any scaffold condition lacks coverage", () => {
    const results = [
      { caseId: "a", condition: "full_procedure" as const, evaluated: true, score: 1, passedItems: 1, totalItems: 1 },
      { caseId: "a", condition: "method_hint" as const, evaluated: false, score: null, passedItems: 0, totalItems: 1, error: "generation failed" },
      { caseId: "a", condition: "goal_data" as const, evaluated: true, score: 0.5, passedItems: 1, totalItems: 2 },
    ];

    const summary = summarizeAutonomyResults(results, ["a"]);
    assert.equal(summary.degraded, true);
    assert.equal(summary.exitCode, 3);
    assert.equal(summary.conditions.method_hint.coverage, 0);
    assert.equal(summary.comparison.trustworthy, false);
  });
});

describe("autonomy-ladder-core: failure taxonomy", () => {
  it("classifies operational failures without treating quality misses as unevaluable", () => {
    assert.equal(classifyAutonomyFailure({ evaluated: true, score: 0.2, belowMin: true }), "below_min");
    assert.equal(classifyAutonomyFailure({ evaluated: false, error: "generation failed: timeout" }), "generation");
    assert.equal(classifyAutonomyFailure({ evaluated: false, error: "grading failed" }), "grading");
    assert.equal(classifyAutonomyFailure({ evaluated: false, error: "unexpected" }), "unknown");
  });
});

describe("autonomy-ladder-core: bounded runner contracts", () => {
  it("accounts for every no-repair, no-last-resort provider request", () => {
    assert.equal(computeAutonomyProviderRequestCeiling(3), 90);
    assert.throws(() => computeAutonomyProviderRequestCeiling(0), /positive safe integer/i);
  });

  it("rejects a short or malformed judge list instead of scoring it as a zero", () => {
    assert.equal(countStrictJudgePasses([{ pass: true }, { pass: false }], 2), 1);
    assert.equal(countStrictJudgePasses([], 2), null);
    assert.equal(countStrictJudgePasses([{ pass: "yes" }], 1), null);
  });
});
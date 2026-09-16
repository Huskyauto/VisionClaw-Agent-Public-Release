import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateGoldenSet,
  computeVerdict,
  clamp01,
  selectOfflineEvalCandidate,
  parseOfflineEvalCandidateCount,
  runOfflineEvalCandidateLoop,
} from "../../server/lib/offline-eval-core";

const VALID_CASE = {
  id: "c1",
  category: "qa",
  prompt: "What is 2+2?",
  rubric: ["States the answer is 4."],
  minScore: 0.5,
};

describe("offline-eval-core: validateGoldenSet", () => {
  it("accepts a { cases: [...] } document and normalizes it", () => {
    const out = validateGoldenSet({ version: 1, cases: [VALID_CASE] });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "c1");
    assert.equal(out[0].mustRefuse, false); // defaulted
    assert.equal(out[0].category, "qa");
  });

  it("accepts a bare array of cases", () => {
    const out = validateGoldenSet([VALID_CASE]);
    assert.equal(out.length, 1);
  });

  it("defaults a missing category to 'uncategorized'", () => {
    const out = validateGoldenSet([{ ...VALID_CASE, category: undefined }]);
    assert.equal(out[0].category, "uncategorized");
  });

  it("carries mustRefuse:true through", () => {
    const out = validateGoldenSet([{ ...VALID_CASE, mustRefuse: true }]);
    assert.equal(out[0].mustRefuse, true);
  });

  it("clamps minScore into [0,1]", () => {
    assert.equal(validateGoldenSet([{ ...VALID_CASE, minScore: 5 }])[0].minScore, 1);
    assert.equal(validateGoldenSet([{ ...VALID_CASE, minScore: -3 }])[0].minScore, 0);
  });

  it("throws on an empty / missing case list (fail-closed config error)", () => {
    assert.throws(() => validateGoldenSet({ cases: [] }), /no cases/);
    assert.throws(() => validateGoldenSet({}), /no cases/);
    assert.throws(() => validateGoldenSet(null), /no cases/);
  });

  it("throws on a malformed case rather than silently dropping it", () => {
    assert.throws(() => validateGoldenSet([{ id: "x", prompt: "p", rubric: [] }]), /malformed/);
    assert.throws(() => validateGoldenSet([{ id: "x", prompt: "p" }]), /malformed/);
    assert.throws(() => validateGoldenSet([{ id: "", prompt: "p", rubric: ["a"] }]), /malformed/);
    assert.throws(() => validateGoldenSet([{ id: "x", prompt: "p", rubric: [123] }]), /malformed/);
  });

  it("throws on duplicate case ids", () => {
    assert.throws(() => validateGoldenSet([VALID_CASE, VALID_CASE]), /duplicate/);
  });
});

describe("offline-eval-core: computeVerdict", () => {
  const base = {
    totalCases: 10,
    evaluatedCases: 10,
    suiteScore: 0.9,
    baselineScore: 0.9,
    minCoverage: 0.8,
    regressionTolerance: 0.05,
  };

  it("passes (exit 0) when coverage is full and score holds vs baseline", () => {
    const v = computeVerdict(base);
    assert.equal(v.exitCode, 0);
    assert.equal(v.degraded, false);
    assert.equal(v.regressed, false);
  });

  it("passes on a first run with no baseline (establishes baseline)", () => {
    const v = computeVerdict({ ...base, baselineScore: null, suiteScore: 0.4 });
    assert.equal(v.exitCode, 0);
    assert.equal(v.regressed, false);
  });

  it("fails CLOSED with exit 3 when coverage is below the floor", () => {
    const v = computeVerdict({ ...base, evaluatedCases: 5 }); // 50% < 80%
    assert.equal(v.degraded, true);
    assert.equal(v.exitCode, 3);
  });

  it("a degraded run is NEVER also reported as a regression", () => {
    // coverage too low AND score collapsed — degraded must dominate, regressed=false
    const v = computeVerdict({ ...base, evaluatedCases: 1, suiteScore: 0.1 });
    assert.equal(v.degraded, true);
    assert.equal(v.regressed, false);
    assert.equal(v.exitCode, 3);
  });

  it("flags a regression (exit 2) when score drops beyond tolerance", () => {
    const v = computeVerdict({ ...base, suiteScore: 0.8 }); // baseline 0.9, drop 0.10 > 0.05
    assert.equal(v.regressed, true);
    assert.equal(v.exitCode, 2);
    assert.ok(Math.abs(v.regressionDrop - 0.1) < 1e-9);
  });

  it("does NOT flag a regression for a drop within tolerance", () => {
    const v = computeVerdict({ ...base, suiteScore: 0.86 }); // drop 0.04 <= 0.05
    assert.equal(v.regressed, false);
    assert.equal(v.exitCode, 0);
  });

  it("does NOT flag a regression when the score improved", () => {
    const v = computeVerdict({ ...base, suiteScore: 0.95 });
    assert.equal(v.regressed, false);
    assert.ok(v.regressionDrop < 0);
  });

  it("treats zero cases as zero coverage → degraded", () => {
    const v = computeVerdict({ ...base, totalCases: 0, evaluatedCases: 0 });
    assert.equal(v.coverage, 0);
    assert.equal(v.degraded, true);
  });
});

describe("offline-eval-core: clamp01", () => {
  it("clamps in range and guards non-finite input to 0 (fail-closed)", () => {
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(NaN), 0);
    assert.equal(clamp01(Infinity), 0);
    assert.equal(clamp01(-Infinity), 0);
  });
});

describe("offline-eval-core: candidate selection", () => {
  it("selects the highest-scoring fully evaluated candidate and reports its margin", () => {
    const selection = selectOfflineEvalCandidate({
      expectedCandidates: 3,
      candidates: [
        { index: 0, evaluated: true, score: 0.5 },
        { index: 1, evaluated: true, score: 0.9 },
        { index: 2, evaluated: true, score: 0.7 },
      ],
    });

    assert.equal(selection.complete, true);
    assert.equal(selection.selectedIndex, 1);
    assert.equal(selection.score, 0.9);
    assert.equal(selection.scoreMargin, 0.2);
  });

  it("refuses to select from a partial candidate set", () => {
    const selection = selectOfflineEvalCandidate({
      expectedCandidates: 3,
      candidates: [
        { index: 0, evaluated: true, score: 0.9 },
        { index: 1, evaluated: false, score: null },
        { index: 2, evaluated: true, score: 0.8 },
      ],
    });

    assert.equal(selection.complete, false);
    assert.equal(selection.selectedIndex, null);
    assert.equal(selection.score, null);
    assert.match(selection.reason || "", /incomplete/i);
  });

  it("rejects duplicate candidate indexes as malformed provenance", () => {
    const selection = selectOfflineEvalCandidate({
      expectedCandidates: 2,
      candidates: [
        { index: 0, evaluated: true, score: 0.9 },
        { index: 0, evaluated: true, score: 0.8 },
      ],
    });

    assert.equal(selection.complete, false);
    assert.equal(selection.selectedIndex, null);
    assert.match(selection.reason || "", /duplicate|malformed/i);
  });

  it("rejects invalid scores instead of treating them as valid evidence", () => {
    const selection = selectOfflineEvalCandidate({
      expectedCandidates: 2,
      candidates: [
        { index: 0, evaluated: true, score: 0.8 },
        { index: 1, evaluated: true, score: 1.5 },
      ],
    });

    assert.equal(selection.complete, false);
    assert.equal(selection.selectedIndex, null);
    assert.match(selection.reason || "", /invalid|incomplete/i);
  });

  it("breaks equal scores by the lower candidate index", () => {
    const selection = selectOfflineEvalCandidate({
      expectedCandidates: 2,
      candidates: [
        { index: 0, evaluated: true, score: 0.9 },
        { index: 1, evaluated: true, score: 0.9 },
      ],
    });

    assert.equal(selection.complete, true);
    assert.equal(selection.selectedIndex, 0);
    assert.equal(selection.scoreMargin, 0);
  });

  it("defaults candidate mode off and rejects values outside the hard bound", () => {
    assert.equal(parseOfflineEvalCandidateCount(undefined), 1);
    assert.equal(parseOfflineEvalCandidateCount(""), 1);
    assert.equal(parseOfflineEvalCandidateCount("3"), 3);
    assert.throws(() => parseOfflineEvalCandidateCount("0"), /candidate count/i);
    assert.throws(() => parseOfflineEvalCandidateCount("4"), /candidate count/i);
    assert.throws(() => parseOfflineEvalCandidateCount("2.5"), /candidate count/i);
  });

  it("rejects a selection request outside the same one-to-three candidate bound", () => {
    const selection = selectOfflineEvalCandidate({ expectedCandidates: 4, candidates: [] });
    assert.equal(selection.complete, false);
    assert.equal(selection.selectedIndex, null);
    assert.match(selection.reason || "", /candidate count/i);
  });

  it("runs exactly the configured number of candidates before selecting", async () => {
    const calls: number[] = [];
    const result = await runOfflineEvalCandidateLoop(3, async index => {
      calls.push(index);
      return { index, evaluated: true, score: [0.3, 0.9, 0.6][index] };
    });

    assert.deepEqual(calls, [0, 1, 2]);
    assert.equal(result.candidates.length, 3);
    assert.equal(result.selection.complete, true);
    assert.equal(result.selection.selectedIndex, 1);
  });

  it("does not select a winner when any candidate reports a failure", async () => {
    const result = await runOfflineEvalCandidateLoop(3, async index =>
      index === 1
        ? { index, evaluated: false, score: null }
        : { index, evaluated: true, score: 0.9 - index / 10 },
    );

    assert.equal(result.candidates.length, 3);
    assert.equal(result.selection.complete, false);
    assert.equal(result.selection.selectedIndex, null);
    assert.match(result.selection.reason || "", /incomplete/i);
  });
});

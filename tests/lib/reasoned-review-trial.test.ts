import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forensicRecordFileName, runReasonedReviewTrial } from "../../server/lib/reasoned-review-trial";

describe("runReasonedReviewTrial", () => {
  it("maps a position-blind reviewer winner back to the stable candidate after randomized ordering", async () => {
    const trial = await runReasonedReviewTrial({
      benchmarkVersion: "test-v1",
      random: () => 0,
      cases: [{
        id: "candidate-mapping",
        rubric: "Choose the candidate that is accurate, candid, and actionable.",
        baselineCandidateId: "baseline",
        expectedWinnerId: "improved",
        candidates: [
          { id: "baseline", content: "Everything is complete." },
          { id: "improved", content: "The work is complete; assumptions and next checks are explicit." },
        ],
      }],
      reviewers: [{
        model: "independent-judge",
        review: async () => ({
          winnerPosition: 0,
          scores: [95, 41],
          critique: "Candidate 1 is more candid and actionable.",
          costUsd: 0.002,
        }),
      }],
    });

    assert.deepEqual(trial.cases[0].randomizedCandidateIds, ["improved", "baseline"]);
    assert.equal(trial.cases[0].winnerCandidateId, "improved");
    assert.equal(trial.cases[0].expectedWinnerId, "improved");
    assert.equal(trial.cases[0].baselineCandidateId, "baseline");
    assert.equal(trial.cases[0].degraded, false);
    assert.equal(trial.metrics.qualityLift, 1);
    assert.equal(trial.metrics.degradedRate, 0);
    assert.equal(trial.metrics.disagreementRate, 0);
    assert.equal(trial.metrics.totalCostUsd, 0.002);
  });

  it("refuses a reviewer that is also declared as a candidate generator", async () => {
    await assert.rejects(
      () => runReasonedReviewTrial({
        benchmarkVersion: "test-v1",
        cases: [{
          id: "independence",
          rubric: "Choose the clearer response.",
          baselineCandidateId: "a",
          expectedWinnerId: "b",
          candidates: [
            { id: "a", content: "Brief answer.", generatorModel: "candidate-model" },
            { id: "b", content: "Clear answer with a next step.", generatorModel: "candidate-model" },
          ],
        }],
        reviewers: [{
          model: "candidate-model",
          review: async () => ({ winnerPosition: 0, scores: [90, 10], critique: "unused" }),
        }],
      }),
      /must differ from every declared candidate generator/,
    );
  });

  it("stops and records a degraded trial after more than half of the benchmark has no valid reviewer outcome", async () => {
    let calls = 0;
    const cases = ["a", "b", "c", "d"].map((id) => ({
      id,
      rubric: "Choose the clearer candidate.",
      baselineCandidateId: "baseline",
      expectedWinnerId: "improved",
      candidates: [
        { id: "baseline", content: "Brief answer.", generatorModel: "candidate-model" },
        { id: "improved", content: "Clear answer with a next step.", generatorModel: "candidate-model" },
      ],
    }));

    const trial = await runReasonedReviewTrial({
      benchmarkVersion: "test-v1",
      cases,
      reviewers: [{
        model: "independent-judge",
        review: async () => {
          calls++;
          throw new Error("judge unavailable");
        },
      }],
    });

    assert.equal(calls, 3);
    assert.equal(trial.status, "degraded");
    assert.equal(trial.cases.length, 3);
    assert.equal(trial.metrics.totalCases, 4);
    assert.equal(trial.metrics.attemptedCases, 3);
    assert.equal(trial.metrics.degradedRate, 1);
  });

  it("names forensic copies with tenant scope so matching run keys cannot collide", () => {
    assert.equal(forensicRecordFileName(7, "same-run-key"), "tenant-7-same-run-key.json");
    assert.notEqual(
      forensicRecordFileName(7, "same-run-key"),
      forensicRecordFileName(8, "same-run-key"),
    );
  });
});
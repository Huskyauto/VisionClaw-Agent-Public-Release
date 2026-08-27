// Task 130 — model-switch savings recommendations (pure logic, no db).
// Pricing basis = OBSERVED blended $/token derived from the tenant's own
// ledger rows, never a static price sheet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeModelSwitchRecommendations,
  type ModelQuality,
  type WorkflowModelUsage,
} from "../../server/lib/model-switch-recommendations";

function usageRow(over: Partial<WorkflowModelUsage> = {}): WorkflowModelUsage {
  return {
    workflow: "web_search",
    model: "expensive-model",
    calls: 40,
    tokensIn: 2_000_000,
    tokensOut: 500_000,
    totalCostUsd: 25,
    ...over,
  };
}

// Baseline candidate volume: cheap-model observed at $1/1M blended
// (1M tokens for $1), free-model observed at $0 for 1M tokens.
const CHEAP_VOLUME = usageRow({
  workflow: "other_tool", model: "cheap-model",
  tokensIn: 800_000, tokensOut: 200_000, totalCostUsd: 1,
});
const FREE_VOLUME = usageRow({
  workflow: "other_tool", model: "free-model",
  tokensIn: 900_000, tokensOut: 100_000, totalCostUsd: 0,
});

const QUALITY: ModelQuality[] = [
  { model: "expensive-model", avgScore: 82, gradedSteps: 20 },
  { model: "cheap-model", avgScore: 78, gradedSteps: 12 },
];

test("suggests the cheaper model within quality tolerance, priced from OBSERVED ledger rates", () => {
  const recs = computeModelSwitchRecommendations([usageRow(), CHEAP_VOLUME], QUALITY);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.workflow, "web_search");
  assert.equal(r.fromModel, "expensive-model");
  assert.equal(r.toModel, "cheap-model");
  // cheap-model observed rate = $1 / 1M tokens → projected = 2.5M * $1/1M = $2.5
  assert.equal(r.toObservedRatePerMTokens, 1);
  assert.equal(r.projectedCostUsd, 2.5);
  assert.equal(r.estSavingsUsd, 22.5);
  assert.equal(r.estSavingsPct, 90);
  assert.equal(r.qualityDelta, -4);
});

test("excludes candidates that drop quality beyond tolerance", () => {
  const quality: ModelQuality[] = [
    { model: "expensive-model", avgScore: 82, gradedSteps: 20 },
    { model: "cheap-model", avgScore: 60, gradedSteps: 12 }, // −22 pts
  ];
  const recs = computeModelSwitchRecommendations([usageRow(), CHEAP_VOLUME], quality);
  assert.equal(recs.length, 0);
});

test("never recommends a model without observed quality data (fail closed)", () => {
  const quality: ModelQuality[] = [{ model: "expensive-model", avgScore: 82, gradedSteps: 20 }];
  const recs = computeModelSwitchRecommendations([usageRow(), CHEAP_VOLUME], quality);
  assert.equal(recs.length, 0);
});

test("candidate without verifiable observed rate (insufficient ledger tokens) is skipped", () => {
  const thinVolume = usageRow({
    workflow: "other_tool", model: "cheap-model",
    tokensIn: 1_000, tokensOut: 500, totalCostUsd: 0.001, // < minCandidateTokens
  });
  const recs = computeModelSwitchRecommendations([usageRow(), thinVolume], QUALITY);
  assert.equal(recs.length, 0);
});

test("candidate quality below min graded steps is excluded", () => {
  const quality: ModelQuality[] = [
    { model: "expensive-model", avgScore: 82, gradedSteps: 20 },
    { model: "cheap-model", avgScore: 78, gradedSteps: 2 },
  ];
  const recs = computeModelSwitchRecommendations([usageRow(), CHEAP_VOLUME], quality);
  assert.equal(recs.length, 0);
});

test("tiny-spend groups and zero-token groups are ignored", () => {
  const recs = computeModelSwitchRecommendations(
    [
      usageRow({ totalCostUsd: 0.005 }),
      usageRow({ workflow: "zero-tok", tokensIn: 0, tokensOut: 0 }),
      CHEAP_VOLUME,
    ],
    QUALITY,
  );
  assert.equal(recs.length, 0);
});

test("free lane with observed quality yields 100% savings suggestion", () => {
  const quality: ModelQuality[] = [
    { model: "expensive-model", avgScore: 82, gradedSteps: 20 },
    { model: "free-model", avgScore: 80, gradedSteps: 10 },
  ];
  const recs = computeModelSwitchRecommendations([usageRow(), FREE_VOLUME], quality);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].toModel, "free-model");
  assert.equal(recs[0].estSavingsPct, 100);
  assert.equal(recs[0].toObservedRatePerMTokens, 0);
});

test("picks the single best candidate per workflow and caps the list, sorted by savings", () => {
  const quality: ModelQuality[] = [
    { model: "expensive-model", avgScore: 82, gradedSteps: 20 },
    { model: "cheap-model", avgScore: 78, gradedSteps: 12 },
    { model: "free-model", avgScore: 80, gradedSteps: 10 },
  ];
  const usage: WorkflowModelUsage[] = [CHEAP_VOLUME, FREE_VOLUME];
  for (let i = 0; i < 8; i++) {
    usage.push(usageRow({ workflow: `wf-${i}`, totalCostUsd: 10 + i }));
  }
  const recs = computeModelSwitchRecommendations(usage, quality);
  assert.equal(recs.length, 5); // default limit
  assert.equal(recs[0].currentCostUsd, 17); // biggest spender first
  assert.equal(recs[0].toModel, "free-model"); // best candidate wins per workflow
  for (let i = 1; i < recs.length; i++) {
    assert.ok(recs[i].estSavingsUsd <= recs[i - 1].estSavingsUsd);
  }
});

test("savings below the minimum percentage are not surfaced", () => {
  // Group blended cost ≈ candidate rate → tiny pct savings.
  const recs = computeModelSwitchRecommendations(
    [usageRow({ totalCostUsd: 2.6 }), CHEAP_VOLUME],
    QUALITY,
    { minSavingsPct: 20 },
  );
  assert.equal(recs.length, 0);
});

test("negative/corrupt cost rows never become a pricing basis", () => {
  const corrupt = usageRow({
    workflow: "other_tool", model: "cheap-model",
    tokensIn: 1_000_000, tokensOut: 0, totalCostUsd: -5,
  });
  const recs = computeModelSwitchRecommendations([usageRow(), corrupt], QUALITY);
  assert.equal(recs.length, 0); // candidate excluded (no verifiable volume)
});

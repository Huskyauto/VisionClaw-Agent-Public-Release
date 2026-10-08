import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _classifyJuryFailure,
  _selectJuryLaneReplacement,
} from "../../server/moa";
import { _tallyVotes } from "../../server/lib/jury-triage";

test("one failed frontier seat is replaced by one healthy unused provider lane", () => {
  const replacement = _selectJuryLaneReplacement({
    failed: { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
    occupiedLanes: new Set(["profundo"]),
    healthy: () => true,
  });
  assert.deepEqual(replacement, {
    modelId: "gpt-5.4",
    providerLane: "openai-api",
  });
});

test("recovery refuses a duplicate lane and reports no healthy alternate", () => {
  assert.equal(_selectJuryLaneReplacement({
    failed: { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
    occupiedLanes: new Set(["openai-api", "anthropic-api"]),
    healthy: () => true,
  }), null);
  assert.equal(_selectJuryLaneReplacement({
    failed: { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
    occupiedLanes: new Set(["profundo"]),
    healthy: () => false,
  }), null);
});

test("529 and deadline failures retain exact typed failure classes", () => {
  assert.equal(_classifyJuryFailure({ status: 529, message: "overloaded" }), "provider_overload");
  assert.equal(_classifyJuryFailure(new Error("proposer z-ai/glm-5.2 timed out after 45000ms")), "model_timeout");
});

test("failed or abstaining seats cannot manufacture a reduced-quorum majority", () => {
  const result = _tallyVotes([
    { verdict: "FIX" as const },
    { verdict: "FIX" as const },
  ], 3);
  assert.deepEqual(result, { verdict: "FIX", majority: 2 });
  const noMajority = _tallyVotes([{ verdict: "FIX" as const }], 3);
  assert.deepEqual(noMajority, { verdict: "ESCALATE", majority: 1 });
});
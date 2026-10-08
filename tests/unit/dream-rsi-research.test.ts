import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDreamReplayOptions,
  researchRowsToDreamTree,
} from "../../server/lib/dream-rsi-research";

test("research rows become prefix-observable Dream nodes without treating unverified scores as independent", () => {
  const tree = researchRowsToDreamTree([
    {
      id: 1,
      parent_experiment_id: null,
      hypothesis: "Try a low-cost retrieval policy",
      approach: "fixed benchmark",
      metric_value: "8.0",
      verification_status: "verified",
      verification_details: "independent_evaluator",
    },
    {
      id: 2,
      parent_experiment_id: 1,
      hypothesis: "Try a novel retrieval policy",
      approach: "fixed benchmark",
      metric_value: "9.0",
      verification_status: "unverified",
      verification_details: "",
    },
  ]);

  assert.equal(tree[0].outcome.quality, 0.8);
  assert.equal(tree[0].outcome.independentlyEvaluated, true);
  assert.equal(tree[1].outcome.independentlyEvaluated, false);
  assert.equal(tree[1].parentId, "1");
  assert.equal(tree[1].features.depth, 1);
});

test("Dream replay options normalize before execution and idempotency hashing", () => {
  assert.deepEqual(normalizeDreamReplayOptions({
    maxNodes: 9_000,
    maxRounds: 80,
    batchSize: 50,
  }), { maxNodes: 500, maxRounds: 50, batchSize: 20 });
  assert.throws(() => normalizeDreamReplayOptions({ maxNodes: Number.NaN }), /positive integer/);
});

test("research row mapping refuses to invent a score from missing evidence", () => {
  const [node] = researchRowsToDreamTree([{
    id: 1,
    hypothesis: "Unknown result",
    approach: "",
    metric_value: null,
    numeric_metric_value: null,
    verification_status: "unverified",
  }]);
  assert.equal(node.outcome.quality, 0);
  assert.equal(node.outcome.independentlyEvaluated, false);
});
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultDreamPolicies,
  runDreamReplay,
  type DreamHistoricalNode,
} from "../../server/lib/dream-rsi-replay";

const tree: DreamHistoricalNode[] = [
  {
    id: "root-a",
    parentId: null,
    availableRound: 0,
    features: { noveltyHint: 0.2, uncertainty: 0.2, estimatedCost: 0.1, depth: 0 },
    outcome: { quality: 0.65, safetyPassed: true, safetyEvaluated: true, independentlyEvaluated: true },
  },
  {
    id: "root-b",
    parentId: null,
    availableRound: 0,
    features: { noveltyHint: 0.9, uncertainty: 0.8, estimatedCost: 0.2, depth: 0 },
    outcome: { quality: 0.45, safetyPassed: true, safetyEvaluated: true, independentlyEvaluated: true },
  },
  {
    id: "child-a",
    parentId: "root-a",
    availableRound: 1,
    features: { noveltyHint: 0.4, uncertainty: 0.3, estimatedCost: 0.1, depth: 1 },
    outcome: { quality: 0.82, safetyPassed: true, safetyEvaluated: true, independentlyEvaluated: true },
  },
  {
    id: "child-b",
    parentId: "root-b",
    availableRound: 1,
    features: { noveltyHint: 0.95, uncertainty: 0.9, estimatedCost: 0.25, depth: 1 },
    outcome: { quality: 0.55, safetyPassed: true, safetyEvaluated: true, independentlyEvaluated: true },
  },
];

test("Dream replay deterministically evaluates bounded policies without execution authority", () => {
    const policies = createDefaultDreamPolicies();
    const first = runDreamReplay(tree, policies, { maxRounds: 2, batchSize: 1 });
    const second = runDreamReplay(tree, policies, { maxRounds: 2, batchSize: 1 });

    assert.deepEqual(first, second);
    assert.equal(first.mode, "report_only");
    assert.equal(first.policyResults.length, 3);
    assert.ok(first.policyResults.every((result) => result.mayPromote === false));
    assert.ok(first.policyResults.every((result) => result.mayAllocate === false));
});

test("Dream replay does not expose hidden outcomes before selection", () => {
    let leakedOutcome = false;
    const spyPolicy = {
      id: "spy",
      version: "1",
      select(context: any) {
        leakedOutcome =
          context.candidates.some((candidate: any) => "outcome" in candidate) ||
          context.candidates.some((candidate: any) => "quality" in candidate);
        return [context.candidates[0]?.id].filter(Boolean);
      },
    };

    runDreamReplay(tree, [spyPolicy], { maxRounds: 1, batchSize: 1 });
    assert.equal(leakedOutcome, false);
});

test("Dream replay reports insufficient evidence when coverage is incomplete", () => {
    const degraded = tree.map((node, index) => ({
      ...node,
      outcome: {
        ...node.outcome,
        independentlyEvaluated: index === 0,
      },
    }));

    assert.equal(runDreamReplay(degraded, createDefaultDreamPolicies(), {
      maxRounds: 2,
      batchSize: 1,
    }).verdict, "insufficient_evidence");
});

test("Dream replay cannot treat unknown safety as a green evaluated result", () => {
  const unknownSafety = tree.map((node) => ({
    ...node,
    outcome: { ...node.outcome, safetyEvaluated: false },
  }));
  assert.equal(runDreamReplay(unknownSafety, createDefaultDreamPolicies(), {
    maxRounds: 2,
    batchSize: 1,
  }).verdict, "insufficient_evidence");
});

test("Dream replay enforces hard node, policy, round, and batch bounds", () => {
    assert.throws(() => runDreamReplay(
      Array.from({ length: 501 }, (_, index) => ({ ...tree[0], id: `n-${index}` })),
      createDefaultDreamPolicies(),
      { maxRounds: 2, batchSize: 1 },
    ), /500/);

    assert.throws(() => runDreamReplay(tree, createDefaultDreamPolicies(), {
      maxRounds: 51,
      batchSize: 1,
    }), /50/);
});
import test from "node:test";
import assert from "node:assert/strict";
import { buildJevDecisionTrace } from "../server/lib/typesafe-decision-trace";

test("traces bind tenant, output, state, questions and policy without storing raw state", () => {
  const input = {
    tenantId: 42,
    request: { state: { text: "private customer statement" }, questions: {
      present: { type: "noul" as const, instructions: "Is a fact present?" },
    } },
    response: { model: "jev-resolved", usage: { input_tokens: 10, output_tokens: 1 },
      answers: { present: { type: "noul" as const, noul: 0.9 } } },
    output: "private output", questionVersion: "test-v1", latencyMs: 12,
    policy: { version: "one", threshold: 0.02 },
  };
  const receipt = buildJevDecisionTrace(input);
  assert.ok(!JSON.stringify(receipt).includes("private customer statement"));
  assert.ok(!JSON.stringify(receipt).includes("private output"));
  assert.equal(receipt.servedModel, "jev-resolved");
  assert.notEqual(receipt.stateDigest, buildJevDecisionTrace({ ...input, tenantId: 43 }).stateDigest);
  assert.notEqual(receipt.outputDigest, buildJevDecisionTrace({ ...input, output: "changed" }).outputDigest);
  assert.notEqual(receipt.policyDigest, buildJevDecisionTrace({ ...input, policy: { threshold: 0.1 } }).policyDigest);
  assert.notEqual(receipt.questionDigest, buildJevDecisionTrace({ ...input, questionVersion: "test-v2" }).questionDigest);
  assert.equal(receipt.stateDigest, buildJevDecisionTrace(input).stateDigest);
  assert.throws(() => buildJevDecisionTrace({ ...input, tenantId: 0 }), /tenant/);
});

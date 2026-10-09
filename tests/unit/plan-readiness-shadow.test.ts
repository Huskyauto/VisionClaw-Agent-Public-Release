import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanReadinessAssessment,
  buildPlanRepairRecommendation,
  isPlanReadinessShadowEnabled,
  preparePlanReadinessShadow,
  preparePlanRepairShadow,
} from "../../server/lib/plan-readiness-shadow";

test("readiness requires a coherent dependency graph and concrete verification evidence", () => {
  const assessment = buildPlanReadinessAssessment({
    planId: 71,
    objective: "Research, verify, and deliver a defensible report",
    strategy: {
      alternativesConsidered: 2,
      assumptions: ["Primary sources are available"],
      falsificationAttempts: ["Search for contradictory primary evidence"],
    },
    steps: [
      { n: 1, task: "Collect primary evidence", depends_on: [] },
      { n: 2, task: "Draft the report", depends_on: [1] },
      { n: 3, task: "Independently verify every material claim", depends_on: [2] },
    ],
  });

  assert.equal(assessment.verdict, "ready");
  assert.equal(assessment.score, 6);
  assert.deepEqual(assessment.missing, []);
  assert.match(assessment.eventId, /^plan-readiness:71:[a-f0-9]{24}$/);

  const malformed = buildPlanReadinessAssessment({
    planId: 72,
    objective: "Produce a report",
    steps: [{ n: 1, task: "Write it", depends_on: [99] }],
  });
  assert.equal(malformed.verdict, "explore");
  assert.ok(malformed.missing.includes("valid_dependencies"));
  assert.ok(malformed.missing.includes("verification_plan"));
});

test("repair recommendation maps a failure to its bounded dependent subgraph", () => {
  const recommendation = buildPlanRepairRecommendation({
    planId: 81,
    failedStep: 2,
    failure: "Source extraction timed out",
    priorFailuresInPlan: 1,
    steps: [
      { n: 1, task: "Find sources", depends_on: [] },
      { n: 2, task: "Extract evidence", depends_on: [1] },
      { n: 3, task: "Draft", depends_on: [2] },
      { n: 4, task: "Verify", depends_on: [3] },
      { n: 5, task: "Independent branch", depends_on: [1] },
    ],
  });

  assert.equal(recommendation.action, "repair_step");
  assert.deepEqual(recommendation.affectedSteps, [2, 3, 4]);
  assert.deepEqual(recommendation.preservedSteps, [1, 5]);
  assert.match(recommendation.eventId, /^plan-repair:81:2:[a-f0-9]{24}$/);
});

test("current duplicate step identities replace stale graph entries without duplicate evidence", () => {
  const recommendation = buildPlanRepairRecommendation({
    planId: 82,
    failedStep: 2,
    failure: "failed",
    priorFailuresInPlan: 1,
    steps: [
      { n: 2, task: "Stale task", depends_on: [1] },
      { n: 2, task: "Current replacement task", depends_on: [] },
      { n: 3, task: "Current dependent task", depends_on: [2] },
    ],
  });
  assert.deepEqual(recommendation.affectedSteps, [2, 3]);
  assert.deepEqual(recommendation.preservedSteps, []);
});

test("repeated or structural failures recommend strategy reopening without executing it", () => {
  for (const input of [
    { failure: "Central assumption contradicted by the evidence", priorFailuresInPlan: 1 },
    { failure: "ordinary failure", priorFailuresInPlan: 2 },
  ]) {
    const recommendation = buildPlanRepairRecommendation({
      planId: 91,
      failedStep: 1,
      steps: [{ n: 1, task: "Prove the core route", depends_on: [] }],
      ...input,
    });
    assert.equal(recommendation.action, "reopen_strategy");
    assert.equal(recommendation.reportOnly, true);
  }
});

test("shadow mode uses exact opt-in only", () => {
  assert.equal(isPlanReadinessShadowEnabled("1"), true);
  for (const value of [undefined, "", "0", "true", "yes", " 1 "]) {
    assert.equal(isPlanReadinessShadowEnabled(value), false);
  }
});

test("advisory persistence preserves the disabled baseline and fails open", async () => {
  const readinessInput = {
    planId: 101,
    objective: "Produce and verify a research report",
    steps: [{ n: 1, task: "Independently verify the report", depends_on: [] }],
  };
  let persisted = 0;
  assert.equal(await preparePlanReadinessShadow(readinessInput, {
    enabled: false,
    persist: async () => { persisted++; },
  }), null);
  assert.equal(persisted, 0);

  const event = await preparePlanReadinessShadow(readinessInput, {
    enabled: true,
    persist: async () => { persisted++; },
  });
  assert.equal(event?.type, "plan.readiness_shadow");
  assert.equal(persisted, 1);

  let observedError = false;
  const failed = await preparePlanRepairShadow({
    planId: 101,
    failedStep: 1,
    failure: "failed",
    priorFailuresInPlan: 1,
    steps: readinessInput.steps,
  }, {
    enabled: true,
    persist: async () => { throw new Error("database unavailable"); },
    onError: () => { observedError = true; },
  });
  assert.equal(failed, null);
  assert.equal(observedError, true);

  const callbackFailure = await preparePlanRepairShadow({
    planId: 101,
    failedStep: 1,
    failure: "failed",
    priorFailuresInPlan: 1,
    steps: readinessInput.steps,
  }, {
    enabled: true,
    persist: async () => { throw new Error("database unavailable"); },
    onError: () => { throw new Error("observer unavailable"); },
  });
  assert.equal(callbackFailure, null);
});
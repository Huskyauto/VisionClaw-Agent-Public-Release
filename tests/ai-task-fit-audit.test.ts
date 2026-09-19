import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTask,
  EVIDENCE_CONFIDENCE,
  EVIDENCE_FACT_TYPES,
  HUMAN_AGENCY_DEFINITIONS,
  reportSectionBlueprint,
  TASK_ZONES,
  taskAssessmentInputSchema,
  validateAuditOutput,
} from "../server/lib/ai-task-fit-audit";

test("classifies a well-supported, wanted, low-control task as an automation green light", () => {
  const input = taskAssessmentInputSchema.parse({
    workerDesire: 5,
    technicalCapability: 5,
    humanControlNeed: 0,
    businessValue: 5,
    evidenceConfidence: 5,
  });

  assert.equal(classifyTask(input).zone, "automation_green_light");
});

test("bounds every numeric assessment input and exposes the evidence contract", () => {
  assert.equal(taskAssessmentInputSchema.safeParse({
    workerDesire: -1, technicalCapability: 3, humanControlNeed: 3, businessValue: 3, evidenceConfidence: 3,
  }).success, false);
  assert.equal(taskAssessmentInputSchema.safeParse({
    workerDesire: 3, technicalCapability: 3, humanControlNeed: 3, businessValue: 3, evidenceConfidence: 6,
  }).success, false);
  assert.deepEqual(EVIDENCE_FACT_TYPES, ["customer_stated", "operator_observed", "external", "inference"]);
  assert.deepEqual(EVIDENCE_CONFIDENCE, ["high", "medium", "low"]);
  assert.equal(Object.keys(HUMAN_AGENCY_DEFINITIONS).length, 5);
  assert.ok(reportSectionBlueprint.length >= 8);
});

test("classification is deterministic, covers every zone, and labels confidence", () => {
  const inputs = [
    [5, 5, 0, 5, 5],
    [4, 4, 2, 4, 4],
    [4, 5, 5, 5, 3],
    [5, 1, 1, 5, 2],
    [1, 1, 1, 1, 0],
  ] as const;
  const results = inputs.map(([workerDesire, technicalCapability, humanControlNeed, businessValue, evidenceConfidence]) =>
    classifyTask({ workerDesire, technicalCapability, humanControlNeed, businessValue, evidenceConfidence }));
  assert.deepEqual(results.map(result => result.zone), [...TASK_ZONES]);
  const repeat = { workerDesire: 4, technicalCapability: 4, humanControlNeed: 2, businessValue: 4, evidenceConfidence: 4 };
  assert.deepEqual(classifyTask(repeat), classifyTask(repeat));
  assert.equal(results[0].confidence, "high");
  assert.equal(results[2].confidence, "medium");
  assert.equal(results[4].confidence, "low");
});

test("high human-control need cannot be classified as automation", () => {
  for (const workerDesire of [0, 5]) {
    for (const technicalCapability of [0, 5]) {
      const result = classifyTask({ workerDesire, technicalCapability, humanControlNeed: 5, businessValue: 5, evidenceConfidence: 5 });
      assert.equal(result.zone, "human_led_red_light");
    }
  }
});

test("forbidden output validator rejects worker decisions and affiliation claims", () => {
  assert.equal(validateAuditOutput("Recommend layoffs and hiring changes based on this task map.").valid, false);
  assert.equal(validateAuditOutput("Advise compensation or discipline changes for workers.").valid, false);
  assert.equal(validateAuditOutput("This is Stanford endorsed and an official MIT partnership; WORKBank certifies it.").valid, false);
});

test("validator allows neutral task-redesign language and paper inspiration", () => {
  const result = validateAuditOutput(
    "Inspired by the paper, redesign this task so people retain approval, review exceptions, and use AI for bounded drafting. This is not an institutional endorsement.",
  );
  assert.deepEqual(result, { valid: true, violations: [] });
});

test("validator rejects direct employment-action probes without grammatical guessing", () => {
  for (const probe of [
    "Lay off 10 employees",
    "Workers should be laid off",
    "Alice should be fired",
    "Promote Alice and reduce Bob compensation",
    "We do not recommend waiting, fire Alice.",
    "Official partner of Stanford",
    "Stanford officially endorses this report",
    "MIT certified representative",
    "WORKBank official partnership",
    "Replace employees with an automated system",
    "Eliminate roles and reduce headcount",
    "Dismiss staff during workforce reduction",
    "Downsizing is recommended",
    "O*NET officially endorses this report",
    "Downsize the workforce",
    "Replace 10 employees",
    "Dismiss five workers",
    "Eliminate these roles",
    "Workforce reductions are recommended",
    "Role eliminations are planned",
  ]) assert.equal(validateAuditOutput(probe).valid, false, probe);
});

test("validator only exempts exact local neutral limitations", () => {
  assert.equal(validateAuditOutput("This report does not recommend layoffs.").valid, true);
  assert.equal(validateAuditOutput("This report does not recommend laying off, hiring, ranking, or disciplining workers.").valid, true);
  assert.equal(validateAuditOutput("No layoff recommendations are made.").valid, true);
  assert.equal(validateAuditOutput("This is not affiliated with Stanford.").valid, true);
  assert.equal(validateAuditOutput("This report does not recommend waiting, fire Alice.").valid, false);
  assert.equal(validateAuditOutput("This report does not recommend layoffs, fire Alice.").valid, false);
});
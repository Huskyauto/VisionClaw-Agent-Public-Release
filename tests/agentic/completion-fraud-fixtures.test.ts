// Seeded-fraud completion fixtures — CI half (fable-method borrow).
//
// The fixtures in data/eval/fraud-fixtures.json are "completed" runs whose
// worker reports LIE. This test proves the DETERMINISTIC layer of the
// completion evaluator fails closed on the deterministically-catchable frauds
// even when the LLM judge is maximally gullible (always says "done"), and
// validates the fixture file's structure so the live probe script
// (scripts/completion-judge-fraud-probe.ts) can trust it.
//
// Network-free by design: injects a stub judge (house pattern — see
// tests/agentic/completion-evaluator.test.ts; avoids the node:test pg-pool /
// network hang gotcha).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateCompletion, type CompletionEvidence, type CompletionJudge } from "../../server/agentic/completion-evaluator";
import type { GoalContract } from "../../server/agentic/goal-contract";

const FIXTURE_PATH = path.join(process.cwd(), "data", "eval", "fraud-fixtures.json");

interface FraudCase {
  id: string;
  description: string;
  deterministic: boolean;
  judgeDegraded?: boolean;
  plantedFrauds: string[];
  expectedNotDone?: boolean;
  expectedDone?: boolean;
  expectedVerdict?: string;
  contract: GoalContract;
  evidence: CompletionEvidence;
}

function loadCases(): FraudCase[] {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.ok(Array.isArray(raw.cases) && raw.cases.length >= 4, "fixture file must have >=4 cases");
  return raw.cases as FraudCase[];
}

/** A maximally gullible judge: believes every worker claim. If the evaluator
 *  still refuses a clean "done", the deterministic layer did its job. */
const gullibleJudge: CompletionJudge = async () => ({
  stopConditionMet: true,
  invariantsIntact: true,
  unmetCriteria: [],
  reason: "Looks great, everything the worker said checks out (I did not check).",
});

/** A judge that is simply unavailable (degraded path). */
const deadJudge: CompletionJudge = async () => null;

test("fixture file is structurally valid", () => {
  const cases = loadCases();
  const ids = new Set<string>();
  for (const c of cases) {
    assert.ok(c.id && !ids.has(c.id), `duplicate/missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(typeof c.deterministic === "boolean", `${c.id}: deterministic flag required`);
    assert.ok(Array.isArray(c.plantedFrauds), `${c.id}: plantedFrauds must be an array`);
    assert.ok(c.contract?.endState && c.contract?.verificationMethod, `${c.id}: contract incomplete`);
    assert.ok(Array.isArray(c.contract?.invariants), `${c.id}: invariants required`);
    assert.ok(typeof c.contract?.errorBudget?.maxFailedSteps === "number", `${c.id}: errorBudget required`);
    assert.ok(typeof c.contract?.resourceBudget?.maxSteps === "number", `${c.id}: resourceBudget required`);
    assert.ok(Array.isArray(c.evidence?.steps) && c.evidence.steps.length > 0, `${c.id}: evidence steps required`);
    // Fraud cases must expect a non-done outcome; the control must expect done.
    if (c.plantedFrauds.length > 0) {
      assert.ok(c.expectedNotDone === true || typeof c.expectedVerdict === "string", `${c.id}: fraud case must declare expected failure`);
      // Deterministic frauds must pin the EXACT verdict (e.g. "halt"), so a
      // regression from halt→incomplete cannot slip past a loose !=done check.
      if (c.deterministic) {
        assert.ok(typeof c.expectedVerdict === "string" && c.expectedVerdict !== "done", `${c.id}: deterministic fraud case must declare an exact expectedVerdict`);
      }
    } else {
      assert.equal(c.expectedDone, true, `${c.id}: control case must declare expectedDone`);
    }
  }
  // At least one honest control must exist — a suite that only contains frauds
  // can pass with a judge that rejects EVERYTHING.
  assert.ok(cases.some(c => c.plantedFrauds.length === 0 && c.expectedDone), "an honest control case is required");
});

test("deterministic fraud cases fail closed even with a gullible judge", async () => {
  const cases = loadCases().filter(c => c.deterministic && !c.judgeDegraded);
  assert.ok(cases.length >= 1, "need at least one gullible-judge deterministic case");
  for (const c of cases) {
    const verdict = await evaluateCompletion(c.contract, c.evidence, { tenantId: 1, judge: gullibleJudge });
    assert.notEqual(verdict.verdict, "done", `${c.id}: lying run got a clean 'done' past the deterministic layer`);
    if (c.expectedVerdict) assert.equal(verdict.verdict, c.expectedVerdict, `${c.id}: wrong verdict`);
  }
});

test("consequential run with degraded judge is never a clean done", async () => {
  const cases = loadCases().filter(c => c.deterministic && c.judgeDegraded);
  assert.ok(cases.length >= 1, "need at least one degraded-judge case");
  for (const c of cases) {
    const verdict = await evaluateCompletion(c.contract, c.evidence, { tenantId: 1, judge: deadJudge });
    assert.equal(verdict.verdict, c.expectedVerdict || "completed_unverified", `${c.id}: wrong verdict`);
    assert.notEqual(verdict.verdict, "done", `${c.id}: unverified consequential run reported as clean done`);
  }
});

test("honest control passes the deterministic layer (no false halt)", async () => {
  const control = loadCases().find(c => c.expectedDone);
  assert.ok(control, "control case missing");
  const verdict = await evaluateCompletion(control!.contract, control!.evidence, { tenantId: 1, judge: gullibleJudge });
  assert.equal(verdict.verdict, "done", "honest control must not be blocked by the deterministic layer");
});

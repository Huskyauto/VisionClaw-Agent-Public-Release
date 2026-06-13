// Tests for the independent completion evaluator — the rail that judges whether a
// CEO orchestrate loop actually met its goal contract, using a SEPARATE model
// instead of the worker's self-assessment. The LLM judge is injected (the `judge`
// seam) so every case runs network-free and DB-free (no pg pool, no real model).

import { evaluateCompletion, type CompletionJudge } from "../../server/agentic/completion-evaluator";
import type { GoalContract } from "../../server/agentic/goal-contract";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function contract(over: Partial<GoalContract> = {}): GoalContract {
  return {
    objective: "ship the thing",
    endState: "the thing is shipped",
    verificationMethod: "a link exists and resolves",
    invariants: ["no fabricated links"],
    errorBudget: { maxFailedSteps: 1, regressionsCountDouble: true },
    resourceBudget: { maxSteps: 5, maxWallClockMs: 600_000 },
    escalationPath: "tell the user honestly",
    derivedBy: "default",
    ...over,
  };
}

function step(taskId: number, status: string, over: Record<string, any> = {}) {
  return { taskId, description: `step ${taskId}`, persona: "felix", status, ...over };
}

const judgeDone: CompletionJudge = async () => ({ stopConditionMet: true, invariantsIntact: true, unmetCriteria: [], reason: "ok" });
const judgeIncomplete: CompletionJudge = async () => ({ stopConditionMet: false, invariantsIntact: true, unmetCriteria: ["missing link"], reason: "no link found" });
const judgeNull: CompletionJudge = async () => null;          // simulates degraded judge
const judgeThrows: CompletionJudge = async () => { throw new Error("model down"); };

async function run() {
  // 1. Happy path: within budget + judge says done ⇒ verdict "done", no directive needed.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete"), step(2, "complete")], summarySnippet: "", deliverableLinks: ["https://x"], elapsedMs: 1000 }, { tenantId: 1, judge: judgeDone });
    assert(v.verdict === "done", `happy path should be done, got ${v.verdict}`);
    assert(v.stopConditionMet === true, "happy path stopConditionMet true");
    assert(!v.evaluatorDegraded, "happy path not degraded");
  }

  // 2. Judge says incomplete (within budget) ⇒ verdict "incomplete" with unmetCriteria.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeIncomplete });
    assert(v.verdict === "incomplete", `judge-incomplete should be incomplete, got ${v.verdict}`);
    assert(v.unmetCriteria.includes("missing link"), "incomplete carries unmetCriteria");
    assert(v.verdict !== "done", "incomplete is not-done (drives VERIFICATION_DIRECTIVE upstream)");
  }

  // 3. Error budget exceeded (2 failed > max 1) ⇒ verdict "halt" regardless of judge.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "failed", { error: "boom" }), step(2, "failed", { error: "boom" })], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeDone });
    assert(v.verdict === "halt", `over-error-budget should halt, got ${v.verdict}`);
    assert(v.budget.exceeded === true, "budget marked exceeded");
    assert(v.verdict !== "done", "halt is not-done (drives VERIFICATION_DIRECTIVE upstream)");
  }

  // 3b. Regression double-count: 1 failed + regressed ⇒ counts as 2 > max 1 ⇒ halt.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "failed", { error: "boom", regressed: true })], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeDone });
    assert(v.verdict === "halt", `regression double-count should halt, got ${v.verdict}`);
    assert(v.budget.countedFailures === 2, `regression counts double, got ${v.budget.countedFailures}`);
  }

  // 4. Wall-clock budget exceeded ⇒ halt.
  {
    const v = await evaluateCompletion(contract({ resourceBudget: { maxSteps: 5, maxWallClockMs: 500 } }), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 5000 }, { tenantId: 1, judge: judgeDone });
    assert(v.verdict === "halt", `over-wallclock should halt, got ${v.verdict}`);
  }

  // 5. Degraded judge (returns null) within budget ⇒ fail-open "done" flagged degraded.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeNull });
    assert(v.verdict === "done", `degraded-within-budget should fail-open done, got ${v.verdict}`);
    assert(v.evaluatorDegraded === true, "degraded judge surfaced as evaluatorDegraded");
  }

  // 6. Throwing judge never throws out + still fails open to done within budget.
  {
    let threw = false;
    let v: any;
    try { v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeThrows }); }
    catch { threw = true; }
    assert(!threw, "evaluateCompletion must never throw even when judge throws");
    assert(v && v.verdict === "done" && v.evaluatorDegraded === true, "throwing judge ⇒ degraded fail-open done");
  }

  // 7. Degraded judge BUT over budget ⇒ honest halt wins over fail-open done.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "failed", { error: "x" }), step(2, "failed", { error: "y" })], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000 }, { tenantId: 1, judge: judgeNull });
    assert(v.verdict === "halt", `degraded+over-budget should still halt, got ${v.verdict}`);
  }

  console.log(`\ncompletion-evaluator: ${passed} passed, ${failed} failed`);
  // Force exit: importing the module transitively instantiates a pg pool handle
  // that otherwise keeps the process alive (node:test pg-pool hang gotcha).
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });

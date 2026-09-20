// Tests for the independent completion evaluator — the rail that judges whether a
// CEO orchestrate loop actually met its goal contract, using a SEPARATE model
// instead of the worker's self-assessment. The LLM judge is injected (the `judge`
// seam) so every case runs network-free and DB-free (no pg pool, no real model).

import { evaluateCompletion, type CompletionJudge } from "../../server/agentic/completion-evaluator";
import { assessBudgetPhase, pickDistinctJudgeModel, COMPLETION_EVALUATOR_MODEL, type GoalContract } from "../../server/agentic/goal-contract";

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

  // 5b. Sol #3 risk gate: degraded judge + consequentialActions ⇒ "completed_unverified",
  //     never a clean "done" (money/deletion/mass-comms work must not silently pass).
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000, consequentialActions: true }, { tenantId: 1, judge: judgeNull });
    assert(v.verdict === "completed_unverified", `degraded+consequential should be completed_unverified, got ${v.verdict}`);
    assert(v.evaluatorDegraded === true, "degraded+consequential still flagged evaluatorDegraded");
    assert(v.stopConditionMet === true, "completed_unverified means work finished (budget passed), not blocked");
    assert(v.unmetCriteria.length > 0, "completed_unverified carries an explanatory unmetCriteria entry");
  }

  // 5c. Non-consequential (flag false/omitted) keeps the prior fail-open "done".
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000, consequentialActions: false }, { tenantId: 1, judge: judgeNull });
    assert(v.verdict === "done", `degraded+non-consequential keeps fail-open done, got ${v.verdict}`);
  }

  // 5d. Consequential flag does NOT interfere when the judge is healthy — a real
  //     judge verdict wins (done stays done, incomplete stays incomplete).
  {
    const a = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: ["https://x"], elapsedMs: 1000, consequentialActions: true }, { tenantId: 1, judge: judgeDone });
    assert(a.verdict === "done", `healthy judge + consequential still done, got ${a.verdict}`);
    const b = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000, consequentialActions: true }, { tenantId: 1, judge: judgeIncomplete });
    assert(b.verdict === "incomplete", `healthy judge + consequential keeps incomplete, got ${b.verdict}`);
  }

  // 5e. Consequential + degraded + OVER budget ⇒ halt still wins (honesty ladder:
  //     halt > completed_unverified > done).
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "failed", { error: "x" }), step(2, "failed", { error: "y" })], summarySnippet: "", deliverableLinks: [], elapsedMs: 1000, consequentialActions: true }, { tenantId: 1, judge: judgeNull });
    assert(v.verdict === "halt", `consequential+degraded+over-budget should halt, got ${v.verdict}`);
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

  // ── Budget-adaptive strategy (assessBudgetPhase — spec Layer 6) ──────────────
  // Pure, deterministic, network-free. Default converge threshold is 0.5.

  // 8. No finite ceiling supplied ⇒ fresh loop, explore, no directive.
  {
    const p = assessBudgetPhase({ steps: 3, elapsedMs: 9_999 }, {});
    assert(p.phase === "explore", `no-ceiling should explore, got ${p.phase}`);
    assert(p.dominant === "none", `no-ceiling dominant none, got ${p.dominant}`);
    assert(p.hint === "", "explore phase emits no directive");
  }

  // 9. Below threshold (2/10 steps = 0.2) ⇒ explore, no directive.
  {
    const p = assessBudgetPhase({ steps: 2, elapsedMs: 0 }, { maxSteps: 10, maxWallClockMs: 600_000 });
    assert(p.phase === "explore", `0.2 consumed should explore, got ${p.phase}`);
    assert(p.hint === "", "below-threshold emits no directive");
  }

  // 10. At threshold (5/10 = 0.5) ⇒ converge, directive present, dominant steps.
  {
    const p = assessBudgetPhase({ steps: 5, elapsedMs: 0 }, { maxSteps: 10, maxWallClockMs: 600_000 });
    assert(p.phase === "converge", `0.5 consumed should converge, got ${p.phase}`);
    assert(p.dominant === "steps", `steps should dominate, got ${p.dominant}`);
    assert(p.hint.length > 0 && /CONVERGE/.test(p.hint), "converge phase emits a non-empty directive");
  }

  // 11. Wall-clock dominates even with low step count (0 steps, 360s/600s = 0.6).
  {
    const p = assessBudgetPhase({ steps: 0, elapsedMs: 360_000 }, { maxSteps: 10, maxWallClockMs: 600_000 });
    assert(p.phase === "converge", `0.6 wallclock should converge, got ${p.phase}`);
    assert(p.dominant === "wallclock", `wallclock should dominate, got ${p.dominant}`);
  }

  // 12. Env threshold override is read + clamped at call time; invalid falls back to 0.5.
  {
    const prev = process.env.BUDGET_CONVERGE_THRESHOLD;
    process.env.BUDGET_CONVERGE_THRESHOLD = "0.9";
    const hi = assessBudgetPhase({ steps: 5 }, { maxSteps: 10 });
    assert(hi.threshold === 0.9 && hi.phase === "explore", `threshold 0.9 keeps 0.5 in explore, got phase=${hi.phase} thr=${hi.threshold}`);
    process.env.BUDGET_CONVERGE_THRESHOLD = "0";          // invalid (<=0) ⇒ fail-safe 0.5
    const bad = assessBudgetPhase({ steps: 5 }, { maxSteps: 10 });
    assert(bad.threshold === 0.5 && bad.phase === "converge", `invalid threshold falls back to 0.5, got phase=${bad.phase} thr=${bad.threshold}`);
    if (prev === undefined) delete process.env.BUDGET_CONVERGE_THRESHOLD; else process.env.BUDGET_CONVERGE_THRESHOLD = prev;
  }

  // 13. budgetPhase is surfaced on the verdict — converge can co-exist with a "done" verdict
  //     (4/5 steps = 0.8 consumed, within budget, judge says done).
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete"), step(2, "complete"), step(3, "complete"), step(4, "complete")], summarySnippet: "", deliverableLinks: ["https://x"], elapsedMs: 1000 }, { tenantId: 1, judge: judgeDone });
    assert(v.verdict === "done", `0.8-consumed-but-done should be done, got ${v.verdict}`);
    assert(v.budgetPhase?.phase === "converge", `verdict should surface converge budgetPhase, got ${v.budgetPhase?.phase}`);
  }

  // 13b. Low consumption ⇒ verdict surfaces explore.
  {
    const v = await evaluateCompletion(contract(), { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: ["https://x"], elapsedMs: 1000 }, { tenantId: 1, judge: judgeDone });
    assert(v.budgetPhase?.phase === "explore", `low-consumption verdict should surface explore, got ${v.budgetPhase?.phase}`);
  }

  // 14. pickDistinctJudgeModel — maker/checker distinctness enforcement.
  {
    // No worker overlap ⇒ keeps configured evaluator, no collision.
    const a = pickDistinctJudgeModel(["meta-llama/llama-4-maverick", "gpt-5.4"]);
    assert(a.model === COMPLETION_EVALUATOR_MODEL && a.collided === false, `no-overlap keeps configured judge, got ${a.model}/${a.collided}`);

    // Empty / undefined worker list ⇒ keeps configured evaluator.
    const b = pickDistinctJudgeModel();
    assert(b.model === COMPLETION_EVALUATOR_MODEL && b.collided === false, `empty worker list keeps configured judge, got ${b.model}/${b.collided}`);

    // Judge model IS a worker (case-insensitive) ⇒ swaps to a distinct fallback, no collision.
    const c = pickDistinctJudgeModel([COMPLETION_EVALUATOR_MODEL.toUpperCase(), "gpt-5.4"]);
    assert(c.model !== COMPLETION_EVALUATOR_MODEL && c.collided === false, `judge==worker swaps to distinct fallback, got ${c.model}/${c.collided}`);
    assert(c.model.toLowerCase() !== COMPLETION_EVALUATOR_MODEL.toLowerCase(), `swapped judge must differ from worker, got ${c.model}`);

    // Degenerate: every candidate (configured + all fallbacks) is also a worker ⇒ collision flagged, never throws.
    const all = pickDistinctJudgeModel([COMPLETION_EVALUATOR_MODEL, "gpt-5-mini", "gpt-4.1-mini", "gemini-3-flash-preview"]);
    assert(all.collided === true && typeof all.model === "string" && !!all.model, `all-collide flags collision + still returns a model, got ${all.model}/${all.collided}`);

    // Whitespace/blank worker entries are ignored (don't falsely trigger a swap).
    const d = pickDistinctJudgeModel(["", "   ", "  " + COMPLETION_EVALUATOR_MODEL + "  "]);
    assert(d.collided === false && d.model !== COMPLETION_EVALUATOR_MODEL, `trimmed worker still detected as collision→swap, got ${d.model}/${d.collided}`);
  }

  // 15. End-to-end: a lean worker ran on the judge's default model. The verdict must
  //     report an evaluatorModel DISTINCT from that worker model, with no collision flag.
  {
    const v = await evaluateCompletion(
      contract(),
      { steps: [step(1, "complete")], summarySnippet: "", deliverableLinks: ["https://x"], elapsedMs: 1000, workerModels: [COMPLETION_EVALUATOR_MODEL] },
      { tenantId: 1, judge: judgeDone },
    );
    // NOTE: the injected judgeDone stub doesn't report a judgeModel, so the verdict
    // falls back to the configured model. The picker behavior itself is covered in #14;
    // here we only assert the plumbing doesn't crash and a verdict is produced.
    assert(v.verdict === "done", `e2e workerModels path still returns a verdict, got ${v.verdict}`);
    assert(typeof v.evaluatorModel === "string" && !!v.evaluatorModel, `e2e verdict carries an evaluatorModel, got ${v.evaluatorModel}`);
  }

  // 15b. The real default judge (no injected stub would run a network call, so we
  //     verify the picker contract directly): given a worker on the judge's model, the
  //     picked judge differs and is not flagged collided.
  {
    const picked = pickDistinctJudgeModel([COMPLETION_EVALUATOR_MODEL]);
    assert(picked.model.toLowerCase() !== COMPLETION_EVALUATOR_MODEL.toLowerCase() && picked.collided === false, `lean-worker collision swaps the judge away, got ${picked.model}/${picked.collided}`);
  }

  console.log(`\ncompletion-evaluator: ${passed} passed, ${failed} failed`);
  // Force exit: importing the module transitively instantiates a pg pool handle
  // that otherwise keeps the process alive (node:test pg-pool hang gotcha).
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });

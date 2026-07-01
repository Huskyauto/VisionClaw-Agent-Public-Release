// Pure decision logic for the grade_deliverable completion gate (extracted from
// server/tools.ts so it can be unit-tested without DB/LLM/tenant context).
//
// The six per-format graders (video/audio/pdf/slides/html_app/image) carry real
// rubrics; everything else (custom dynamically-composed plans, unsupported
// types) returns skipped/unsupported. For those non-rubric deliverables an
// INDEPENDENT completion evaluator runs and ITS verdict drives `ok`. Fail-OPEN:
// a degraded / unavailable judge PASSES the gate (the worker proceeds; the
// next-step text warns to double-check) rather than hard-failing a custom
// deliverable on the default unsupported ⇒ ok:false.

export interface GradeRubricSummary {
  /** the per-format rubric verdict (false by default for unsupported types). */
  ok: boolean;
  score: number;
  passingBar: number;
}

export interface CompletionGateResult {
  verdict: string;
  reason: string;
  degraded: boolean;
  unmet?: string[];
}

/**
 * The gate object emitted when goal-contract / evaluator SETUP throws (e.g.
 * buildGoalContract failed). evaluateCompletion itself never throws — it falls
 * open internally to evaluatorDegraded — so this is the setup safety net. It is
 * a PASSING, degraded gate so a custom deliverable does not hard-fail on the
 * default unsupported verdict.
 */
export function failOpenCompletionGate(): CompletionGateResult {
  return {
    verdict: "done",
    reason: "Completion gate unavailable (goal-contract/evaluator setup failed); failing OPEN.",
    degraded: true,
  };
}

export interface GradeDecision {
  /** final ok surfaced to the caller. */
  finalOk: boolean;
  /** whether the independent completion gate ran (non-rubric path). */
  gateRan: boolean;
  /** human-/agent-readable guidance for the next step. */
  nextStep: string;
}

/**
 * Resolve the final grade outcome.
 *  - completionGate === undefined ⇒ rubric path: finalOk = res.ok (the six
 *    real rubrics stand unchanged).
 *  - completionGate present ⇒ non-rubric path: the independent judge REPLACES
 *    the trivial rubric verdict. Passes when degraded (fail-open) or verdict
 *    "done"; blocks otherwise.
 */
export function resolveGradeDecision(
  res: GradeRubricSummary,
  completionGate: CompletionGateResult | undefined,
): GradeDecision {
  const gateRan = !!completionGate;
  const gatePassed = !completionGate || completionGate.degraded || completionGate.verdict === "done";
  const finalOk = gateRan ? gatePassed : res.ok;

  let nextStep: string;
  if (finalOk) {
    nextStep = gateRan && completionGate!.degraded
      ? "Rubric not applicable AND the independent completion judge was unavailable (fail-open). Proceed to verify_delivery_proof, but double-check the acceptance criteria are genuinely met before telling the customer it's done."
      : "Grade PASSED. Proceed to verify_delivery_proof.";
  } else if (gateRan) {
    nextStep = `Independent completion gate did NOT pass (verdict: ${completionGate!.verdict}): ${completionGate!.reason}${completionGate!.unmet?.length ? ` Unmet criteria: ${completionGate!.unmet.join("; ")}.` : ""} The acceptance criteria are not yet satisfied — revise the deliverable to meet them, then re-grade. Do NOT tell the customer it's done.`;
  } else {
    nextStep = `Grade FAILED (score ${res.score}/${res.passingBar}). Per W3 spec: auto-revise ONCE using the critique above (regenerate the deliverable with the issues fixed), then re-grade. If still <${res.passingBar} after one revise, call owner-notification with the artifact + critique + planned next attempt. Do NOT ship.`;
  }

  return { finalOk, gateRan, nextStep };
}

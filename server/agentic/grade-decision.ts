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
  /**
   * True when the bounded revise loop terminated by ESCALATION (hit the attempt
   * cap or plateaued/regressed) rather than by revising again. Together with
   * `finalOk` this tells a stateful caller the loop is OVER (finalOk===true ⇒
   * passed; escalated===true ⇒ gave up) so it can clear any server-side
   * attempt/trajectory tracking for the key. `finalOk===false && escalated===false`
   * means "revise once more".
   */
  escalated: boolean;
}

// ── Bounded K-step grader-driven revise loop ────────────────────────────────
// Inference-time analog of Tiny Recursive Models (Jolicoeur-Martineau et al.
// 2025, arXiv:2510.04871): instead of a single revise pass, iterate
// revise→re-grade up to `maxAttempts`, carrying the score trajectory forward as
// a scratchpad. We CANNOT train the loop to improve (TRM learns this in-weights
// via deep supervision), so two guardrails replace training: (1) an EXTERNAL
// grader must drive every step, and (2) we stop early on a plateau/regression —
// naive LLM self-refinement without an external signal plateaus or degrades.
// `priorScores` is that carried scratchpad — the in-prompt stand-in for TRM's
// persistent latent z.
export interface AttemptContext {
  /** 1-based revise-attempt counter for this grade. */
  attempt?: number;
  /** max revise attempts before escalation (the K cap). */
  maxAttempts?: number;
  /** scores of PRIOR attempts, oldest→newest (the carried trajectory). */
  priorScores?: number[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const ATTEMPT_CAP = 5; // hard ceiling so a runaway attempt count can't loop forever

interface NormalizedAttempt {
  attempt: number;
  maxAttempts: number;
  priorScores: number[];
}

function normalizeAttempt(ctx: AttemptContext | undefined): NormalizedAttempt {
  const rawAttempt = Number(ctx?.attempt);
  const attempt = Number.isFinite(rawAttempt) && rawAttempt >= 1 ? Math.floor(rawAttempt) : 1;
  const rawMax = Number(ctx?.maxAttempts);
  const maxAttempts = Number.isFinite(rawMax) && rawMax >= 1
    ? Math.min(Math.floor(rawMax), ATTEMPT_CAP)
    : DEFAULT_MAX_ATTEMPTS;
  const priorScores = Array.isArray(ctx?.priorScores)
    ? ctx!.priorScores.map(Number).filter((n) => Number.isFinite(n))
    : [];
  return { attempt, maxAttempts, priorScores };
}

/**
 * Resolve the final grade outcome.
 *  - completionGate === undefined ⇒ rubric path: finalOk = res.ok (the six
 *    real rubrics stand unchanged).
 *  - completionGate present ⇒ non-rubric path: the independent judge REPLACES
 *    the trivial rubric verdict. Passes when degraded (fail-open) or verdict
 *    "done"; blocks otherwise.
 *
 * `attemptContext` drives the bounded revise loop: while the grader score is
 * strictly improving and the attempt cap is not hit, next_step tells the worker
 * to revise + re-grade (carrying the trajectory); on plateau/regression or at
 * the cap it escalates to owner-notification. Omitting it defaults to attempt 1
 * of DEFAULT_MAX_ATTEMPTS.
 */
export function resolveGradeDecision(
  res: GradeRubricSummary,
  completionGate: CompletionGateResult | undefined,
  attemptContext?: AttemptContext,
): GradeDecision {
  const gateRan = !!completionGate;
  const gatePassed = !completionGate || completionGate.degraded || completionGate.verdict === "done";
  const finalOk = gateRan ? gatePassed : res.ok;
  const { attempt, maxAttempts, priorScores } = normalizeAttempt(attemptContext);

  let nextStep: string;
  let escalated = false;
  if (finalOk) {
    nextStep = gateRan && completionGate!.degraded
      ? "Rubric not applicable AND the independent completion judge was unavailable (fail-open). Proceed to verify_delivery_proof, but double-check the acceptance criteria are genuinely met before telling the customer it's done."
      : "Grade PASSED. Proceed to verify_delivery_proof.";
  } else if (gateRan) {
    // Non-rubric completion-gate failure: the judge is boolean (no numeric
    // trajectory), so bound the loop by a simple attempt counter.
    const head = `Independent completion gate did NOT pass (verdict: ${completionGate!.verdict}): ${completionGate!.reason}${completionGate!.unmet?.length ? ` Unmet criteria: ${completionGate!.unmet.join("; ")}.` : ""}`;
    if (attempt < maxAttempts) {
      nextStep = `${head} The acceptance criteria are not yet satisfied (attempt ${attempt} of ${maxAttempts}) — revise the deliverable to meet them, then re-grade with attempt=${attempt + 1}. Do NOT tell the customer it's done.`;
    } else {
      escalated = true;
      nextStep = `${head} Still unmet after ${attempt} attempt(s) — reached the ${maxAttempts}-attempt cap. Call owner-notification with the artifact + unmet criteria + planned next attempt. Do NOT ship.`;
    }
  } else {
    // Rubric failure: bounded K-step loop with the score trajectory as the
    // carried scratchpad. Keep revising ONLY while the external grader confirms
    // improvement; stop on plateau/regression (self-refinement degrades) or at
    // the attempt cap, then escalate.
    const lastPrior = priorScores.length ? priorScores[priorScores.length - 1] : undefined;
    const improving = lastPrior === undefined || res.score > lastPrior;
    const trajectory = [...priorScores, res.score].join(" → ");
    const canRetry = attempt < maxAttempts && improving;
    if (canRetry) {
      const trend = lastPrior === undefined ? "" : ` (improving: ${lastPrior} → ${res.score})`;
      const nextScores = [...priorScores, res.score].join(",");
      nextStep = `Grade FAILED (score ${res.score}/${res.passingBar}). Attempt ${attempt} of ${maxAttempts}${trend}. Score trajectory: ${trajectory}. Auto-revise AGAIN: regenerate the deliverable fixing the critique above (carry forward every still-unresolved issue), then re-grade with attempt=${attempt + 1} and prev_scores=[${nextScores}]. Do NOT ship.`;
    } else {
      escalated = true;
      const why = attempt >= maxAttempts
        ? `reached the ${maxAttempts}-attempt cap`
        : `the score stopped improving (${lastPrior} → ${res.score}) — further self-revision is plateauing`;
      nextStep = `Grade FAILED (score ${res.score}/${res.passingBar}) after ${attempt} attempt(s); ${why}. Score trajectory: ${trajectory}. Call owner-notification with the artifact + critique + the score trajectory + your planned next attempt. Do NOT ship.`;
    }
  }

  return { finalOk, gateRan, nextStep, escalated };
}

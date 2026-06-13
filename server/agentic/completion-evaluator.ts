import { runLlmTask } from "../llm-task";
import { logSilentCatch } from "../lib/silent-catch";
import { COMPLETION_EVALUATOR_MODEL, type GoalContract } from "./goal-contract";

// ─────────────────────────────────────────────────────────────────────────────
// Independent Completion Evaluator (Agentic Loop Architecture Spec — core
// principle, June 2026)
//
//   "The model doing the work is never the model deciding it's done."
//
// After the worker steps run, a SEPARATE (cheaper, structurally-distinct) model
// reads the goal contract + the produced EVIDENCE and answers one question: was
// the stop condition met? It judges artifacts/results/errors — not the worker's
// own assertion of success. Self-assessed completion is the #1 cause of both
// premature stops and runaway loops; this externalizes the judgment.
//
// Two parts:
//  1. DETERMINISTIC budget enforcement (no LLM): error budget (failed steps, with
//     optional regression double-count) + resource budget (steps, wall-clock).
//     These hold even if the LLM judge is unavailable.
//  2. LLM completion judgment (maker/checker split): the independent evaluator
//     grades evidence vs the contract's verification method + invariants.
//
// Failure posture (matches platform convention — quality fails OPEN, the loud
// budget ceiling fails toward HONESTY):
//  - LLM judge unavailable/malformed ⇒ evaluatorDegraded=true and we do NOT
//    fabricate an "incomplete" verdict from nothing; we defer to the deterministic
//    budget result (default: done-if-within-budget). A judge blip must never block
//    a legitimately-finished plan, but it IS surfaced as degraded.
//  - Budget exceeded ⇒ verdict "halt" regardless of the LLM, so an over-budget /
//    too-many-failures run is reported honestly instead of as a clean success.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionEvidenceStep {
  taskId: number;
  description: string;
  persona: string;
  status: string;
  resultSnippet?: string;
  error?: string;
  /** true if this step had previously succeeded and a later attempt broke it. */
  regressed?: boolean;
}

export interface CompletionEvidence {
  steps: CompletionEvidenceStep[];
  summarySnippet: string;
  /** verified deliverable links actually being surfaced to the user. */
  deliverableLinks: string[];
  elapsedMs: number;
}

export interface CompletionVerdict {
  verdict: "done" | "incomplete" | "halt";
  /** the independent judge's read of whether end_state was reached. */
  stopConditionMet: boolean;
  invariantsIntact: boolean;
  unmetCriteria: string[];
  reason: string;
  budget: {
    failedSteps: number;
    countedFailures: number;
    maxFailedSteps: number;
    stepsUsed: number;
    maxSteps: number;
    elapsedMs: number;
    maxWallClockMs: number;
    exceeded: boolean;
    exceededReason?: string;
  };
  /** true ⇒ the LLM judge was unavailable; verdict came from budget only. */
  evaluatorDegraded?: boolean;
  evaluatorModel?: string;
}

function enforceBudget(contract: GoalContract, evidence: CompletionEvidence) {
  const failedSteps = evidence.steps.filter(s => s.status === "failed").length;
  const regressions = evidence.steps.filter(s => s.status === "failed" && s.regressed).length;
  // Cascading-failure detection: a fix that breaks a previously-passing thing
  // counts double against the error budget (spec Layer 3).
  const countedFailures = contract.errorBudget.regressionsCountDouble
    ? failedSteps + regressions
    : failedSteps;
  const stepsUsed = evidence.steps.length;

  let exceeded = false;
  let exceededReason: string | undefined;
  if (countedFailures > contract.errorBudget.maxFailedSteps) {
    exceeded = true;
    exceededReason = `error budget: ${countedFailures} counted failure(s) (${failedSteps} failed${regressions ? `, ${regressions} regression(s) double-counted` : ""}) > max ${contract.errorBudget.maxFailedSteps}`;
  } else if (stepsUsed > contract.resourceBudget.maxSteps) {
    exceeded = true;
    exceededReason = `resource budget: ${stepsUsed} steps > max ${contract.resourceBudget.maxSteps}`;
  } else if (evidence.elapsedMs > contract.resourceBudget.maxWallClockMs) {
    exceeded = true;
    exceededReason = `resource budget: ${(evidence.elapsedMs / 1000).toFixed(0)}s wall-clock > max ${(contract.resourceBudget.maxWallClockMs / 1000).toFixed(0)}s`;
  }

  return {
    failedSteps,
    countedFailures,
    maxFailedSteps: contract.errorBudget.maxFailedSteps,
    stepsUsed,
    maxSteps: contract.resourceBudget.maxSteps,
    elapsedMs: evidence.elapsedMs,
    maxWallClockMs: contract.resourceBudget.maxWallClockMs,
    exceeded,
    exceededReason,
  };
}

/**
 * Independently evaluate whether an orchestrated loop actually met its goal
 * contract. Never throws — any internal failure falls open to a degraded,
 * budget-only verdict.
 */
/** Independent judgment of evidence vs contract. Returns null ⇒ degraded. */
export type CompletionJudge = (args: {
  contract: GoalContract;
  evidence: CompletionEvidence;
  tenantId: number;
  timeoutMs?: number;
}) => Promise<{
  stopConditionMet: boolean;
  invariantsIntact: boolean;
  unmetCriteria: string[];
  reason: string;
} | null>;

/** The real independent judge: a separate cheap model grades evidence vs contract. */
const defaultLlmJudge: CompletionJudge = async ({ contract, evidence, tenantId, timeoutMs }) => {
  const stepLines = evidence.steps
    .map(s => {
      const head = `#${s.taskId} [${s.status}] ${s.persona}: ${(s.description || "").slice(0, 140)}`;
      if (s.status === "failed") return `${head}\n   ERROR: ${(s.error || "unknown").slice(0, 240)}`;
      const snip = (s.resultSnippet || "").slice(0, 600).replace(/\s+/g, " ").trim();
      return `${head}${snip ? `\n   OUTPUT: ${snip}` : "\n   OUTPUT: (none)"}`;
    })
    .join("\n");
  const res = await runLlmTask({
    tenantId,
    model: COMPLETION_EVALUATOR_MODEL,
    timeoutMs: timeoutMs || 30_000,
    temperature: 0,
    maxTokens: 1200,
    prompt:
      `You are an INDEPENDENT completion EVALUATOR. You did NOT do this work. Your only job is to judge — from the EVIDENCE below — whether the goal contract's stop condition was actually met. Do not trust worker assertions of success; trust only what the evidence shows (produced outputs, links, errors).\n\n` +
      `GOAL CONTRACT\n` +
      `End state: ${contract.endState}\n` +
      `Verification method: ${contract.verificationMethod}\n` +
      `Invariants (must hold): ${contract.invariants.map((i, n) => `(${n + 1}) ${i}`).join(" ")}\n\n` +
      `EVIDENCE — STEP RESULTS\n${stepLines.slice(0, 12000)}\n\n` +
      `EVIDENCE — VERIFIED DELIVERABLE LINKS SURFACED TO USER: ${evidence.deliverableLinks.length ? evidence.deliverableLinks.join(", ") : "(none)"}\n\n` +
      `Decide:\n` +
      `- stop_condition_met: true ONLY if the verification method is satisfied by the evidence (required artifacts actually exist / are present, not merely claimed).\n` +
      `- invariants_intact: false if ANY invariant appears violated by the evidence (e.g. a claimed deliverable with no backing output, a fabricated link).\n` +
      `- unmet_criteria: short bullet phrases for anything required-but-missing or unverifiable. Empty array if fully done.\n` +
      `- reason: one sentence.`,
    schema: {
      type: "object",
      required: ["stop_condition_met", "invariants_intact", "unmet_criteria", "reason"],
      properties: {
        stop_condition_met: { type: "boolean" },
        invariants_intact: { type: "boolean" },
        unmet_criteria: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
    },
  });
  const j = res.success ? (res.json as any) : null;
  if (!j || typeof j.stop_condition_met !== "boolean") return null;
  return {
    stopConditionMet: j.stop_condition_met,
    invariantsIntact: j.invariants_intact !== false,
    unmetCriteria: Array.isArray(j.unmet_criteria) ? j.unmet_criteria.map((x: any) => String(x)) : [],
    reason: String(j.reason || ""),
  };
};

export async function evaluateCompletion(
  contract: GoalContract,
  evidence: CompletionEvidence,
  // `judge` is an injectable seam: defaults to the independent LLM judge below;
  // tests pass a deterministic stub so budget/return-shaping logic is exercised
  // network-free (avoids the node:test pg-pool / network hang gotcha).
  opts: { tenantId: number; timeoutMs?: number; judge?: CompletionJudge },
): Promise<CompletionVerdict> {
  const budget = enforceBudget(contract, evidence);

  let llm: {
    stopConditionMet?: boolean;
    invariantsIntact?: boolean;
    unmetCriteria?: string[];
    reason?: string;
  } | null = null;
  let degraded = false;

  const judge = opts.judge || defaultLlmJudge;
  try {
    const j = await judge({ contract, evidence, tenantId: opts.tenantId, timeoutMs: opts.timeoutMs });
    if (j && typeof j.stopConditionMet === "boolean") {
      llm = {
        stopConditionMet: j.stopConditionMet,
        invariantsIntact: j.invariantsIntact !== false,
        unmetCriteria: Array.isArray(j.unmetCriteria) ? j.unmetCriteria.map(x => String(x).slice(0, 200)).filter(Boolean).slice(0, 8) : [],
        reason: String(j.reason || "").slice(0, 300),
      };
    } else {
      degraded = true;
    }
  } catch (e) {
    degraded = true;
    logSilentCatch("server/agentic/completion-evaluator.ts", e);
  }

  // Combine. Budget ceiling wins (honest halt). Otherwise defer to the judge.
  // If the judge is degraded, fall open: within-budget ⇒ done (never invent an
  // incomplete from a missing judge), but flag degraded so it is visible.
  let verdict: CompletionVerdict["verdict"];
  let stopConditionMet: boolean;
  let invariantsIntact: boolean;
  let unmetCriteria: string[];
  let reason: string;

  if (budget.exceeded) {
    verdict = "halt";
    stopConditionMet = false;
    invariantsIntact = llm?.invariantsIntact ?? true;
    unmetCriteria = llm?.unmetCriteria?.length ? llm.unmetCriteria : [];
    reason = `Halted on budget: ${budget.exceededReason}.${llm?.reason ? ` Judge: ${llm.reason}` : ""}`;
  } else if (degraded || !llm) {
    verdict = "done";
    stopConditionMet = true;
    invariantsIntact = true;
    unmetCriteria = [];
    reason = "Completion judge unavailable; passed deterministic budget checks (degraded — verdict not independently verified).";
  } else {
    const ok = llm.stopConditionMet === true && llm.invariantsIntact !== false;
    verdict = ok ? "done" : "incomplete";
    stopConditionMet = !!llm.stopConditionMet;
    invariantsIntact = llm.invariantsIntact !== false;
    unmetCriteria = llm.unmetCriteria || [];
    reason = llm.reason || (ok ? "Stop condition met." : "Stop condition not met.");
  }

  return {
    verdict,
    stopConditionMet,
    invariantsIntact,
    unmetCriteria,
    reason,
    budget,
    evaluatorDegraded: degraded || undefined,
    evaluatorModel: COMPLETION_EVALUATOR_MODEL,
  };
}

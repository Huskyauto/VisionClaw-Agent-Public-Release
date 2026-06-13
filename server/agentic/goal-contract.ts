import { runLlmTask } from "../llm-task";
import { logSilentCatch } from "../lib/silent-catch";

// ─────────────────────────────────────────────────────────────────────────────
// Goal Contract (Agentic Loop Architecture Spec — Layer 1, June 2026)
//
// "If you can't write the verification method, the task isn't ready for a loop."
//
// Every orchestrated loop gets a structured contract BEFORE the worker steps are
// judged "done". The contract turns a fuzzy objective into a machine-/model-
// checkable definition of done, plus the budgets that bound the loop. It is the
// reference the INDEPENDENT completion evaluator (completion-evaluator.ts) grades
// the produced evidence against — so completion is no longer the worker grading
// its own homework.
//
// Design invariants:
//  - FAIL OPEN. Contract-building is a QUALITY signal, never a gate. If the cheap
//    extraction LLM is unavailable or malformed, we return a permissive default
//    contract (derivedBy:"default") and the loop proceeds. A contract must never
//    block real work — the worst case is a less-specific verification method.
//  - DETERMINISTIC BUDGETS. errorBudget / resourceBudget are computed from the
//    plan shape with no LLM in the path, so they hold even when extraction fails.
//  - Reusable. Built for the CEO `orchestrate` loop but shape-agnostic — the
//    autonomous background loops (closer, autobuild) can adopt the same contract.
// ─────────────────────────────────────────────────────────────────────────────

export interface GoalContract {
  objective: string;
  /** End state described as a verifiable claim, not an aspiration. */
  endState: string;
  /** The literal check/observation that proves the end state was reached. */
  verificationMethod: string;
  /** Constraints that must hold across ALL steps, not just at the end. */
  invariants: string[];
  /** When to stop retrying and escalate instead. */
  errorBudget: { maxFailedSteps: number; regressionsCountDouble: boolean };
  /** Hard ceilings the harness enforces outside the model. */
  resourceBudget: { maxSteps: number; maxWallClockMs: number };
  /** What happens on halt — who hears about it and with what context. */
  escalationPath: string;
  /** Whether the LLM extraction succeeded, or we fell open to defaults. */
  derivedBy: "llm" | "default";
}

export const COMPLETION_EVALUATOR_MODEL =
  process.env.COMPLETION_EVALUATOR_MODEL || "gemini-2.5-flash";

function defaultContract(objective: string, stepCount: number): GoalContract {
  const steps = Math.max(1, stepCount || 1);
  return {
    objective,
    endState: `Every concrete deliverable implied by the objective exists and is correct: ${objective}`,
    verificationMethod:
      "Inspect each step's produced output against the objective. Every required artifact (file, link, document, message) is present, non-empty, and any URL actually resolves. No required output is missing or fabricated.",
    invariants: [
      "No fabricated, hallucinated, or dead deliverable links / file references.",
      "No tenant-isolation, auth, or safety guard is bypassed to reach the result.",
      "Claimed deliverables are backed by real step evidence, not asserted in prose.",
    ],
    errorBudget: { maxFailedSteps: Math.max(1, Math.ceil(steps / 3)), regressionsCountDouble: true },
    resourceBudget: {
      maxSteps: Math.max(steps, steps + 2),
      maxWallClockMs: Math.min(15 * 60_000, Math.max(5 * 60_000, steps * 90_000)),
    },
    escalationPath:
      "Surface the unmet verification criteria honestly to the user; never present incomplete or unverified work as done.",
    derivedBy: "default",
  };
}

/**
 * Build a goal contract for an objective. Attempts a cheap, schema-validated LLM
 * extraction of the end-state / verification method / invariants; falls open to a
 * permissive default on any failure. Budgets are always deterministic.
 */
export async function buildGoalContract(
  objective: string,
  opts: { stepCount?: number; tenantId: number; timeoutMs?: number },
): Promise<GoalContract> {
  const contract = defaultContract(objective, opts.stepCount || 1);
  const obj = (objective || "").trim();
  if (!obj) return contract;

  try {
    const res = await runLlmTask({
      tenantId: opts.tenantId,
      model: COMPLETION_EVALUATOR_MODEL,
      timeoutMs: opts.timeoutMs || 20_000,
      temperature: 0.1,
      maxTokens: 1200,
      prompt:
        `You are writing a GOAL CONTRACT for an autonomous agent loop. Turn the objective into a machine-checkable definition of done. Do NOT do the task — only specify how to PROVE it is finished.\n\n` +
        `OBJECTIVE:\n${obj.slice(0, 2000)}\n\n` +
        `Return:\n` +
        `- end_state: the finished condition as a single verifiable claim (what concretely must EXIST), not an aspiration.\n` +
        `- verification_method: the literal observation/check that proves end_state — e.g. "a Google Slides link that resolves + a narrated /present/ link", "an email was sent to X", "a PDF file exists and opens". Be specific to THIS objective.\n` +
        `- invariants: 2-4 constraints that must hold throughout (e.g. no fabricated links, correct recipient, no safety bypass).`,
      schema: {
        type: "object",
        required: ["end_state", "verification_method", "invariants"],
        properties: {
          end_state: { type: "string" },
          verification_method: { type: "string" },
          invariants: { type: "array", items: { type: "string" } },
        },
      },
    });
    const j = res.success ? (res.json as any) : null;
    if (j && typeof j.end_state === "string" && j.end_state.trim() && typeof j.verification_method === "string" && j.verification_method.trim()) {
      contract.endState = String(j.end_state).slice(0, 600);
      contract.verificationMethod = String(j.verification_method).slice(0, 800);
      const inv = Array.isArray(j.invariants)
        ? j.invariants.map((x: any) => String(x).slice(0, 200)).filter(Boolean).slice(0, 5)
        : [];
      // Always retain the non-negotiable platform invariants (no fabricated links,
      // no safety bypass, evidence-backed claims) even if the model omitted them;
      // de-dup loosely so the LLM's phrasings don't duplicate the defaults.
      contract.invariants = [...new Set([...inv, ...contract.invariants])].slice(0, 6);
      contract.derivedBy = "llm";
    }
  } catch (e) {
    logSilentCatch("server/agentic/goal-contract.ts", e);
  }
  return contract;
}

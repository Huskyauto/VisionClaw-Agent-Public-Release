/**
 * Haiku-only effort proposals. Shadow/evaluation policy, not an authorization
 * grant or production provider hook. Inputs are trusted task metadata, not text.
 */
export type HaikuEffort = "low" | "medium" | "high";
export interface HaikuEffortContext {
  model: string;
  task: "simple" | "multi-step" | "strict" | "unknown";
  source?: "routine" | "jury" | "approval";
  allowHigh?: boolean;
  promptTokens?: number;
  remainingBudgetFraction?: number;
}
export interface HaikuEffortDecision {
  effort: HaikuEffort;
  reason: string;
  defer: boolean;
  mode: "shadow";
}

export function decideHaikuEffort(context: HaikuEffortContext): HaikuEffortDecision | null {
  if (!context || context.model !== "claude-haiku-5-5" ||
      (context.source !== undefined && context.source !== "routine")) return null;
  const effort: HaikuEffort = context.task === "simple" ? "low"
    : context.task === "strict" && context.allowHigh === true ? "high" : "medium";
  const fraction = context.remainingBudgetFraction;
  const invalidBudget = fraction !== undefined &&
    (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1);
  const defer = invalidBudget || (fraction !== undefined &&
    (fraction <= 0 || (fraction < 0.05 && effort !== "low")));
  return {
    effort,
    reason: defer ? "budget_defer_preserving_quality"
      : effort === "high" ? "authorized_strict_task"
      : effort === "low" ? "validated_simple_task" : "quality_default",
    defer,
    mode: "shadow",
  };
}

export function haikuTrialRunRequested(args: readonly string[], runtime: {
  nodeEnv?: string; deployment?: string;
}): boolean {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--run")) throw new Error("INVALID_TRIAL_ARGUMENTS");
  if (!args.length) return false;
  if (runtime.nodeEnv === "production" ||
      (runtime.deployment !== undefined && !["", "0", "false"].includes(runtime.deployment))) {
    throw new Error("TRIAL_WORKSPACE_ONLY");
  }
  return true;
}

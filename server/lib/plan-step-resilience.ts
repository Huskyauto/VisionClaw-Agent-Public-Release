export interface PlanStepTaskResult {
  success: boolean;
  error?: string;
  refused?: boolean;
}

export interface PlanStepRetryOutcome<T extends PlanStepTaskResult> {
  result: T;
  attempts: number;
}

export const PLAN_STEP_ATTEMPT_TIMEOUTS_MS = [60_000, 180_000] as const;
export const PLAN_STEP_MAX_TOTAL_MS = PLAN_STEP_ATTEMPT_TIMEOUTS_MS.reduce((sum, value) => sum + value, 0);
const TRANSIENT_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isTransientPlanStepFailure(result: PlanStepTaskResult): boolean {
  if (result.success || result.refused) return false;
  const error = String(result.error || "");
  if (/\b(safety|content policy|moderation|policy violation|refusal|user cancel(?:led|ed)?)\b/i.test(error)) {
    return false;
  }
  return /^(?:request was aborted|this operation was aborted|the operation was aborted)\.?$/i.test(error.trim())
    || /^aborterror(?::.*)?$/i.test(error.trim())
    || /\bllm task deadline exceeded\b/i.test(error)
    || /\b(?:timed out|timeout)\b/i.test(error);
}

export async function runPlanStepTaskWithRetry<T extends PlanStepTaskResult>(
  runAttempt: (timeoutMs: number, attempt: number) => Promise<T>,
  onRetry?: (details: { attempt: number; nextAttempt: number; error: string }) => void | Promise<void>,
): Promise<PlanStepRetryOutcome<T>> {
  let result: T | undefined;

  for (let i = 0; i < PLAN_STEP_ATTEMPT_TIMEOUTS_MS.length; i++) {
    try {
      result = await runAttempt(PLAN_STEP_ATTEMPT_TIMEOUTS_MS[i], i + 1);
    } catch (error: any) {
      const normalized = {
        success: false,
        error: `${String(error?.name || "Error")}: ${String(error?.message || error || "unknown error")}`,
      } as T;
      if (!isTransientPlanStepFailure(normalized)) throw error;
      result = normalized;
    }
    const hasAnotherAttempt = i + 1 < PLAN_STEP_ATTEMPT_TIMEOUTS_MS.length;
    if (!hasAnotherAttempt || !isTransientPlanStepFailure(result)) {
      return { result, attempts: i + 1 };
    }
    await onRetry?.({
      attempt: i + 1,
      nextAttempt: i + 2,
      error: String(result.error || "transient plan-step failure"),
    });
  }

  return { result: result!, attempts: PLAN_STEP_ATTEMPT_TIMEOUTS_MS.length };
}

interface TransientPlanRecoveryCandidate {
  status: string;
  ceoDecision: string | null;
  ceoDecidedAt: string | Date | null;
  planJson: unknown;
  executionLog: unknown;
  nowMs?: number;
}

interface StalePlanRecoveryCandidate {
  status: string;
  planJson: unknown;
  executionLog: unknown;
}

function hasStructuredToolStep(planJson: unknown): boolean {
  const steps = (planJson as any)?.steps;
  return !Array.isArray(steps)
    || steps.some(step => !step || typeof step !== "object" || Object.prototype.hasOwnProperty.call(step, "tool"));
}

function hasRecoveryMarker(executionLog: unknown): boolean {
  return Array.isArray(executionLog)
    && executionLog.some(entry => entry?.type === "execution.transient-recovery");
}

export function shouldRecoverStalePlan(candidate: StalePlanRecoveryCandidate): boolean {
  return candidate.status === "executing"
    && !hasStructuredToolStep(candidate.planJson)
    && !hasRecoveryMarker(candidate.executionLog);
}

export function shouldRecoverTransientPlan(candidate: TransientPlanRecoveryCandidate): boolean {
  if (candidate.status !== "failed" || candidate.ceoDecision !== "approved") return false;

  const log = candidate.executionLog;
  if (!Array.isArray(log) || log.length === 0 || hasRecoveryMarker(log)) return false;
  if (hasStructuredToolStep(candidate.planJson)) return false;

  const finalIndex = log.length - 1;
  const finalEntry = log[finalIndex];
  if (finalEntry?.type !== "execution.failed") return false;
  const failureAtMs = Date.parse(String(finalEntry.at || ""));
  const nowMs = candidate.nowMs ?? Date.now();
  if (!Number.isFinite(failureAtMs) || nowMs - failureAtMs < 0 || nowMs - failureAtMs > TRANSIENT_RECOVERY_MAX_AGE_MS) {
    return false;
  }

  if (typeof finalEntry.failedReason === "string" && finalEntry.failedReason) {
    return isTransientPlanStepFailure({ success: false, error: finalEntry.failedReason });
  }

  let currentRunStart = -1;
  for (let i = finalIndex - 1; i >= 0; i--) {
    if (log[i]?.type === "execution.started") {
      currentRunStart = i;
      break;
    }
  }

  for (let i = finalIndex - 1; i > currentRunStart; i--) {
    const entry = log[i];
    if (entry?.type === "execution.deadlock") return false;
    if (entry?.success === false) {
      return isTransientPlanStepFailure({ success: false, error: entry.error });
    }
  }
  return false;
}
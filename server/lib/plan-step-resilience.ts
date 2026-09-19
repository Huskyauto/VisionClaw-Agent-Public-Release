export interface PlanStepTaskResult {
  success: boolean;
  error?: string;
  refused?: boolean;
}

export interface PlanStepRetryOutcome<T extends PlanStepTaskResult> {
  result: T;
  attempts: number;
}

import { createHash } from "node:crypto";

/** Stable JSON encoding used for recovery bindings; object key order is irrelevant. */
export function canonicalRecoveryJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecoveryJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(k =>
    `${JSON.stringify(k)}:${canonicalRecoveryJson((value as Record<string, unknown>)[k])}`,
  ).join(",")}}`;
}

export function recoveryHash(value: unknown): string {
  return createHash("sha256").update(canonicalRecoveryJson(value)).digest("hex");
}
/** Evidence identity excludes only server-generated recovery linkage/observation
 * events. All original execution steps, failures, and external evidence remain
 * binding inputs. */
export function canonicalRecoveryEvidence(log: unknown): unknown[] {
  const entries = Array.isArray(log) ? log : [];
  return entries.filter((entry: any) => {
    const type = typeof entry?.type === "string" ? entry.type : "";
    return !type.startsWith("execution.recovery_") &&
      type !== "execution.recovery.completed";
  });
}
export function deriveRecoveryReplaySafety(
  step: unknown,
  priorEvidence: unknown,
  originalPlanJson?: unknown,
): {
  allowed: boolean; reason: string; idempotencyKey?: string;
} {
  const s: any = step;
  const plan: any = originalPlanJson;
  const action = plan?.repairAction;
  const evidence = Array.isArray(priorEvidence) ? priorEvidence : [];
  if (!s?.tool) return { allowed: true, reason: "no external tool step" };
  // Replay authority is server-owned. Never trust a recoverySafety declaration
  // embedded in planner/model-authored plan JSON.
  if (s.tool === "heartbeat_repair" && action?.kind === "heartbeat_task") {
    const bound = evidence.some((event: any) =>
      event?.type === "repair.approval_binding" &&
      event?.kind === "heartbeat_task" &&
      event?.stepId === s.n &&
      typeof action.bindingHash === "string" &&
      event?.actionHash === action.bindingHash);
    return bound
      ? { allowed: true, reason: "server-bound heartbeat repair verifier" }
      : { allowed: false, reason: "Heartbeat repair has no immutable approval/verifier evidence; create a new review" };
  }
  if (s.tool === "source_repair_handoff" && action?.kind === "source_repair_handoff") {
    const normalizedSourceAction = {
      version: action.version,
      kind: action.kind,
      findingId: action.findingId,
      evidenceVersion: action.evidenceVersion,
      evidenceHash: action.evidenceHash,
    };
    const bound = evidence.some((event: any) =>
      event?.type === "repair.approval_binding" &&
      event?.kind === "source_repair_handoff" &&
      event?.stepId === s.n &&
      event?.actionHash === JSON.stringify(normalizedSourceAction));
    return bound
      ? { allowed: true, reason: "server-bound idempotent source handoff" }
      : { allowed: false, reason: "Source handoff has no immutable approval/idempotency evidence; create a new review" };
  }
  return { allowed: false, reason: "External outcome is uncertain; verify provider state before authorizing any retry" };
}
export function recoveryApprovalActionHash(action: Record<string, unknown>): string {
  const { actionHash: _ignored, ...immutable } = action;
  return recoveryHash(immutable);
}
/** @deprecated use recoveryApprovalActionHash */
export const recoveryActionHash = recoveryApprovalActionHash;

export function canonicalRecoveryStep(candidate: any): Record<string, unknown> {
  return {
    n: candidate?.n ?? null, agent: candidate?.agent ?? null,
    task: typeof candidate?.task === "string" ? candidate.task.slice(0, 2000) : null,
    tools: Array.isArray(candidate?.tools) ? candidate.tools.map(String) : [],
    tool: candidate?.tool ?? null,
    args: candidate?.args && typeof candidate.args === "object"
      ? Object.fromEntries(Object.entries(candidate.args).filter(([key]) => !key.startsWith("_"))) : null,
    depends_on: Array.isArray(candidate?.depends_on) ? candidate.depends_on : [],
  };
}

export interface StaleRecoveryBinding {
  originalPlanId: number;
  tenantId: number;
  originalVersion: number;
  originalFingerprint: string;
  firstUnresolvedStepIndex: number;
  firstUnresolvedStepId: number | string;
  stepHash: string;
  suffixHash: string;
  executionEvidenceHash: string;
  incidentKey: string;
}

/** Derives an immutable, tenant-bound recovery identity without model input. */
export function deriveStaleRecoveryBinding(input: {
  tenantId: number; originalPlanId: number; version: number; planJson: any; executionLog: unknown;
}): StaleRecoveryBinding | null {
  const steps = input.planJson?.steps;
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0 ||
      !Number.isInteger(input.originalPlanId) || input.originalPlanId <= 0 ||
      !Number.isInteger(input.version) || !Array.isArray(steps) || steps.length === 0) return null;
  const log = Array.isArray(input.executionLog) ? input.executionLog : [];
  const completed = new Set(log.filter((e: any) => e?.success === true).map((e: any) => Number(e.step)));
  const first = steps.findIndex((s: any) => !s || !completed.has(Number(s.n)));
  if (first < 0) return null;
  const step = steps[first];
  if (!step || typeof step !== "object" || !Number.isFinite(Number(step.n))) return null;
  const suffix = steps.slice(first);
  const originalFingerprint = recoveryHash(input.planJson);
  const safeArgs = step.args && typeof step.args === "object"
    ? Object.fromEntries(Object.entries(step.args).filter(([key]) => !key.startsWith("_")))
    : null;
  const stepHash = recoveryHash(canonicalRecoveryStep(step));
  const suffixIds = new Set(steps.slice(first).map((candidate: any) => Number(candidate?.n)));
  const suffixHash = recoveryHash(steps.slice(first).map((candidate: any) => canonicalRecoveryStep({
    ...candidate,
    depends_on: Array.isArray(candidate?.depends_on)
      ? candidate.depends_on.filter((dependency: any) => suffixIds.has(Number(dependency))) : [],
  })));
  // Evidence is bounded before hashing so untrusted execution output cannot create
  // an unbounded incident identity or leak into a child plan.
  const evidence = canonicalRecoveryEvidence(log).slice(-12000);
  const executionEvidenceHash = recoveryHash(evidence);
  const identity = {
    tenantId: input.tenantId, originalPlanId: input.originalPlanId,
    originalVersion: input.version, originalFingerprint, firstUnresolvedStepIndex: first,
    firstUnresolvedStepId: step.n, stepHash, suffixHash, executionEvidenceHash,
  };
  return {
    ...identity,
    incidentKey: `stale-recovery:${recoveryHash(identity)}`,
  };
}

export function recoveryOutcomeForOriginal(row: {
  status?: string; execution_log?: unknown; recoveryChildStatus?: string | null;
}): string | null {
  const child = row.recoveryChildStatus;
  if (child === "awaiting_approval") return "active approval";
  if (child === "approved" || child === "executing") return "recovery executing";
  if (child === "completed" || child === "publish_required" || child === "handoff_pending") return child;
  if (child === "rejected" || row.status === "rejected") return "explicitly rejected";
  if (child === "expired") return "actionable blocker";
  const events = Array.isArray(row.execution_log) ? row.execution_log as any[] : [];
  if (events.some(e => e?.type === "execution.recovery_blocker")) return "actionable blocker";
  return null;
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
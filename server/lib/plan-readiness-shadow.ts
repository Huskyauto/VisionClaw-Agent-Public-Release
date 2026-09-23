import { createHash } from "node:crypto";
import { logSilentCatch } from "./silent-catch";

const MAX_STEPS = 50;
const MAX_TEXT = 160;

export interface PlanReadinessStep {
  n?: number;
  task?: string;
  description?: string;
  depends_on?: unknown;
  dependsOn?: unknown;
}

export interface PlanStrategyEvidence {
  alternativesConsidered?: unknown;
  assumptions?: unknown;
  falsificationAttempts?: unknown;
}

export interface PlanReadinessInput {
  planId: number;
  objective: string;
  strategy?: PlanStrategyEvidence;
  steps: ReadonlyArray<PlanReadinessStep>;
}

export interface PlanReadinessAssessment {
  type: "plan.readiness_shadow";
  eventId: string;
  version: 1;
  reportOnly: true;
  planId: number;
  verdict: "ready" | "explore";
  score: number;
  checks: Record<
    "objective" | "plan_structure" | "valid_dependencies" | "verification_plan" | "alternatives_considered" | "falsification_evidence",
    boolean
  >;
  missing: string[];
}

export interface PlanRepairRecommendation {
  type: "plan.repair_shadow";
  eventId: string;
  version: 1;
  reportOnly: true;
  planId: number;
  failedStep: number;
  failureClass: "local" | "structural";
  action: "repair_step" | "reopen_strategy";
  affectedSteps: number[];
  preservedSteps: number[];
}

export function isPlanReadinessShadowEnabled(value?: string): boolean {
  const candidate = arguments.length === 0
    ? process.env.PLAN_READINESS_SHADOW_ENABLED
    : value;
  return candidate === "1";
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
}

function normalizeSteps(steps: ReadonlyArray<PlanReadinessStep>) {
  const byId = new Map<number, { n: number; task: string; dependsOn: number[] }>();
  steps.slice(0, MAX_STEPS).forEach((step, index) => {
    const n = Number.isInteger(step.n) && Number(step.n) > 0 ? Number(step.n) : index + 1;
    const rawDeps = Array.isArray(step.depends_on) ? step.depends_on : Array.isArray(step.dependsOn) ? step.dependsOn : [];
    const dependsOn = [...new Set(rawDeps.filter((item) => Number.isInteger(item) && Number(item) > 0).map(Number))]
      .sort((a, b) => a - b)
      .slice(0, MAX_STEPS);
    // Later entries are authoritative. This mirrors the executor's replan
    // behavior, where current pending work replaces stale colliding step ids.
    byId.set(n, { n, task: text(step.task || step.description), dependsOn });
  });
  return [...byId.values()].sort((a, b) => a.n - b.n);
}

function hasValidDependencyGraph(steps: ReturnType<typeof normalizeSteps>): boolean {
  const ids = new Set(steps.map((step) => step.n));
  if (ids.size !== steps.length) return false;
  if (steps.some((step) => step.dependsOn.some((dep) => dep === step.n || !ids.has(dep)))) return false;
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const byId = new Map(steps.map((step) => [step.n, step]));
  const visit = (id: number): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) if (!visit(dep)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return steps.every((step) => visit(step.n));
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => text(item).length > 0);
}

export function buildPlanReadinessAssessment(input: PlanReadinessInput): PlanReadinessAssessment {
  const steps = normalizeSteps(input.steps);
  const checks = {
    objective: text(input.objective).length >= 12,
    plan_structure: steps.length > 0 && steps.every((step) => step.task.length >= 8),
    valid_dependencies: steps.length > 0 && hasValidDependencyGraph(steps),
    verification_plan: steps.some((step) => /\b(verify|review|test|audit|validate|check)\b/i.test(step.task)),
    alternatives_considered: Number.isInteger(input.strategy?.alternativesConsidered)
      && Number(input.strategy?.alternativesConsidered) >= 2,
    falsification_evidence: hasItems(input.strategy?.assumptions) && hasItems(input.strategy?.falsificationAttempts),
  };
  const missing = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const base = {
    type: "plan.readiness_shadow" as const,
    version: 1 as const,
    reportOnly: true as const,
    planId: Number.isInteger(input.planId) && input.planId > 0 ? input.planId : 0,
    verdict: missing.length === 0 ? "ready" as const : "explore" as const,
    score: Object.values(checks).filter(Boolean).length,
    checks,
    missing,
  };
  return { ...base, eventId: `plan-readiness:${base.planId}:${hash(base)}` };
}

export function buildPlanRepairRecommendation(input: {
  planId: number;
  failedStep: number;
  failure?: string;
  priorFailuresInPlan: number;
  steps: ReadonlyArray<PlanReadinessStep>;
}): PlanRepairRecommendation {
  const steps = normalizeSteps(input.steps);
  const ids = new Set(steps.map((step) => step.n));
  const failedStep = ids.has(input.failedStep) ? input.failedStep : 0;
  const affected = new Set<number>(failedStep ? [failedStep] : []);
  let changed = true;
  while (changed && affected.size < MAX_STEPS) {
    changed = false;
    for (const step of steps) {
      if (!affected.has(step.n) && step.dependsOn.some((dep) => affected.has(dep))) {
        affected.add(step.n);
        changed = true;
      }
    }
  }
  const structural = input.priorFailuresInPlan >= 2
    || /\b(assumption|contradict|invalid strategy|strategy invalid|impossible|no viable route|fundamental)\b/i.test(text(input.failure));
  const base = {
    type: "plan.repair_shadow" as const,
    version: 1 as const,
    reportOnly: true as const,
    planId: Number.isInteger(input.planId) && input.planId > 0 ? input.planId : 0,
    failedStep,
    failureClass: structural ? "structural" as const : "local" as const,
    action: structural ? "reopen_strategy" as const : "repair_step" as const,
    affectedSteps: [...affected].sort((a, b) => a - b),
    preservedSteps: steps.map((step) => step.n).filter((id) => !affected.has(id)).sort((a, b) => a - b),
  };
  return { ...base, eventId: `plan-repair:${base.planId}:${failedStep}:${hash(base)}` };
}

type ShadowOptions<T> = {
  enabled: boolean;
  persist: (event: T) => Promise<void>;
  onError?: (error: unknown) => void;
};

function notifyShadowError(onError: ShadowOptions<unknown>["onError"], error: unknown): void {
  try {
    onError?.(error);
  } catch (observerError) {
    // Error observation must never turn a report-only failure into an
    // executor-visible rejection. The call site also has a terminal catch.
    logSilentCatch("server/lib/plan-readiness-shadow.ts", observerError);
  }
}

export async function preparePlanReadinessShadow(
  input: PlanReadinessInput,
  options: ShadowOptions<PlanReadinessAssessment>,
): Promise<PlanReadinessAssessment | null> {
  if (!options.enabled) return null;
  try {
    const event = buildPlanReadinessAssessment(input);
    await options.persist(event);
    return event;
  } catch (error) {
    notifyShadowError(options.onError, error);
    return null;
  }
}

export async function preparePlanRepairShadow(
  input: Parameters<typeof buildPlanRepairRecommendation>[0],
  options: ShadowOptions<PlanRepairRecommendation>,
): Promise<PlanRepairRecommendation | null> {
  if (!options.enabled) return null;
  try {
    const event = buildPlanRepairRecommendation(input);
    await options.persist(event);
    return event;
  } catch (error) {
    notifyShadowError(options.onError, error);
    return null;
  }
}
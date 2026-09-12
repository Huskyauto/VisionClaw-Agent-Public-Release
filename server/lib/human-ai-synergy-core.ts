/**
 * Pure, report-only scoring for the bounded Human-AI Synergy trial.
 * These fixed weights are trial assumptions, not a validated psychometric tool.
 */
export const SYNERGY_WEIGHTS = {
  outcomeQuality: 0.35,
  timeEfficiency: 0.25,
  errorDetection: 0.2,
  adaptation: 0.2,
} as const;

export const SYNERGY_CONDITIONS = ["human_alone", "ai_alone", "human_ai"] as const;
export type SynergyCondition = (typeof SYNERGY_CONDITIONS)[number];
export type SynergyMeasurements = Record<keyof typeof SYNERGY_WEIGHTS, number>;
export interface HumanAiTrialInput {
  task: string;
  securityPass: boolean;
  arms: Array<{ condition: SynergyCondition; measurements: SynergyMeasurements }>;
}
export interface SynergySemanticPayload {
  trialName: string;
  taskLabel: string;
  participantAlias: string;
  notes: string | null;
  securityPass: boolean;
  arms: HumanAiTrialInput["arms"];
  rubricVersion: string;
}
export interface HumanAiTrialResult {
  valid: true;
  scores: Record<SynergyCondition, number>;
  liftVsHuman: number;
  liftVsAi: number;
  verdict: "positive_synergy" | "no_positive_synergy";
  coverage: 1;
}
export interface InvalidSynergyResult { valid: false; errors: string[]; }

const MAX_TASK_LENGTH = 200;
const dimensions = Object.keys(SYNERGY_WEIGHTS) as Array<keyof typeof SYNERGY_WEIGHTS>;
const round = (n: number) => Number(n.toFixed(2));

export function scoreHumanAiSynergyTrial(
  input: unknown,
): HumanAiTrialResult | InvalidSynergyResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { valid: false, errors: ["input must be an object"] };
  const value = input as Partial<HumanAiTrialInput>;
  if (typeof value.task !== "string" || value.task.trim().length === 0 || value.task.length > MAX_TASK_LENGTH) errors.push("invalid task");
  if (typeof value.securityPass !== "boolean") errors.push("securityPass must be boolean");
  if (!Array.isArray(value.arms) || value.arms.length !== SYNERGY_CONDITIONS.length) {
    errors.push("exactly three arms required");
  }
  const arms = Array.isArray(value.arms) ? value.arms : [];
  const seen = new Set<string>();
  for (const arm of arms) {
    if (!arm || typeof arm !== "object" || !SYNERGY_CONDITIONS.includes((arm as any).condition)) {
      errors.push("invalid condition"); continue;
    }
    const condition = (arm as any).condition as string;
    if (seen.has(condition)) errors.push("duplicate condition");
    seen.add(condition);
    const measurements = (arm as any).measurements;
    if (!measurements || typeof measurements !== "object") { errors.push("missing measurements"); continue; }
    const measurementKeys = Object.keys(measurements);
    if (measurementKeys.some((key) => !dimensions.includes(key as keyof typeof SYNERGY_WEIGHTS)) ||
      measurementKeys.length !== dimensions.length) errors.push("malformed measurements");
    for (const dimension of dimensions) {
      const n = measurements[dimension];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) errors.push(`invalid ${dimension}`);
    }
  }
  for (const condition of SYNERGY_CONDITIONS) if (!seen.has(condition)) errors.push(`missing ${condition}`);
  if (errors.length) return { valid: false, errors: [...new Set(errors)] };
  const scores = {} as Record<SynergyCondition, number>;
  for (const arm of arms) {
    scores[arm.condition] = round(dimensions.reduce((sum, key) => sum + arm.measurements[key] * SYNERGY_WEIGHTS[key], 0));
  }
  const liftVsHuman = round(scores.human_ai - scores.human_alone);
  const liftVsAi = round(scores.human_ai - scores.ai_alone);
  return {
    valid: true, scores, liftVsHuman, liftVsAi, coverage: 1,
    verdict: value.securityPass === true && liftVsHuman > 0 && liftVsAi > 0
      ? "positive_synergy" : "no_positive_synergy",
  };
}

export function sameSynergyPayload(a: SynergySemanticPayload, b: SynergySemanticPayload): boolean {
  const normalize = (payload: SynergySemanticPayload) => JSON.stringify({
    trialName: payload.trialName,
    taskLabel: payload.taskLabel,
    participantAlias: payload.participantAlias,
    notes: payload.notes,
    securityPass: payload.securityPass,
    rubricVersion: payload.rubricVersion,
    arms: [...payload.arms].sort((x, y) => x.condition.localeCompare(y.condition)).map((arm) => ({
      condition: arm.condition,
      measurements: dimensions.reduce((out, key) => ({ ...out, [key]: arm.measurements[key] }), {}),
    })),
  });
  return normalize(a) === normalize(b);
}
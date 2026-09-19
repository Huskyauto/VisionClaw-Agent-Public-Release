export type LoopConvergenceClassification =
  | "insufficient_evidence"
  | "positive"
  | "negative"
  | "divergent"
  | "plateau";

export interface LoopOutcomeObservation {
  loopKind: string;
  policyVersion: string;
  occurredAt: string;
  quality: number;
  costUsd: number;
  latencyMs: number;
  safetyPassed: boolean;
  safetyEvaluated: boolean;
  independentlyEvaluated: boolean;
  persistedQuality: number | null;
  explorationValue: number | null;
}

export interface LoopConvergenceResult {
  loopKind: string | null;
  classification: LoopConvergenceClassification;
  sampleSize: number;
  independentSampleSize: number;
  safetyRegressions: number;
  qualitySlope: number;
  costAdjustedQualitySlope: number;
  persistenceSlope: number;
  explorationSlope: number;
  earlyVariance: number;
  recentVariance: number;
  confidence: number;
  reasons: string[];
}

export interface AllocationRecommendation {
  loopKind: string;
  allocationUnits: number;
  allocationFraction: number;
  convergence: LoopConvergenceClassification;
  mayExecute: false;
  rationale: string;
}

const MIN_INDEPENDENT_SAMPLES = 5;
const EPSILON = 1e-9;

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function slope(values: number[]): number {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index++) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator <= EPSILON ? 0 : numerator / denominator;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function finiteUnit(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return clamp(value);
}

export function analyzeLoopConvergence(
  observations: readonly LoopOutcomeObservation[],
): LoopConvergenceResult {
  const sorted = observations
    .filter((item) => Number.isFinite(Date.parse(item.occurredAt)))
    .slice()
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const independent = sorted.filter((item) => item.independentlyEvaluated);
  const independentTimePoints = new Set(independent.map((item) => item.occurredAt)).size;
  const loopKinds = new Set(sorted.map((item) => item.loopKind));
  const quality = independent.map((item) => clamp(item.quality));
  const costAdjusted = independent.map((item) =>
    clamp(item.quality) / Math.max(0.001, item.costUsd + item.latencyMs / 3_600_000),
  );
  const persistence = independent
    .map((item) => finiteUnit(item.persistedQuality))
    .filter((value): value is number => value !== null);
  const exploration = independent
    .map((item) => finiteUnit(item.explorationValue))
    .filter((value): value is number => value !== null);
  const splitAt = Math.max(1, Math.floor(quality.length / 2));
  const early = quality.slice(0, splitAt);
  const recent = quality.slice(splitAt);
  const safetyRegressions = independent.filter(
    (item) => item.safetyEvaluated && !item.safetyPassed,
  ).length;
  const qualitySlope = slope(quality);
  const costAdjustedQualitySlope = slope(costAdjusted);
  const persistenceSlope = slope(persistence);
  const explorationSlope = slope(exploration);
  const earlyVariance = variance(early);
  const recentVariance = variance(recent);
  const reasons: string[] = [];
  let classification: LoopConvergenceClassification = "plateau";

  if (loopKinds.size > 1) {
    reasons.push("Mixed loop kinds cannot form one convergence trajectory.");
    classification = "insufficient_evidence";
  } else if (
    independent.length < MIN_INDEPENDENT_SAMPLES ||
    independentTimePoints < MIN_INDEPENDENT_SAMPLES
  ) {
    reasons.push(
      `Need at least ${MIN_INDEPENDENT_SAMPLES} independently evaluated outcomes at distinct times.`,
    );
    classification = "insufficient_evidence";
  } else if (safetyRegressions > 0) {
    reasons.push("Independent evidence contains a safety regression.");
    classification = "negative";
  } else {
    const earlyMean = early.reduce((sum, value) => sum + value, 0) / Math.max(1, early.length);
    const recentMean = recent.reduce((sum, value) => sum + value, 0) / Math.max(1, recent.length);
    if (qualitySlope < -0.015 || recentMean < earlyMean - 0.05) {
      reasons.push("Quality is declining across the evaluated trajectory.");
      classification = "negative";
    } else if (
      recent.length >= 2 &&
      recentVariance > Math.max(0.02, earlyVariance * 1.75) &&
      Math.abs(qualitySlope) < 0.03
    ) {
      reasons.push("Outcome variance is rising without sustained quality gain.");
      classification = "divergent";
    } else if (
      qualitySlope >= 0.025 &&
      recentMean >= earlyMean + 0.08 &&
      (persistence.length < MIN_INDEPENDENT_SAMPLES || persistenceSlope >= -0.01)
    ) {
      reasons.push("Independent quality improves and later outcomes retain the gain.");
      classification = "positive";
    } else {
      reasons.push("Evidence is stable but does not show material sustained improvement.");
      classification = "plateau";
    }
  }

  return {
    loopKind: loopKinds.size === 1 ? [...loopKinds][0] : null,
    classification,
    sampleSize: sorted.length,
    independentSampleSize: independent.length,
    safetyRegressions,
    qualitySlope,
    costAdjustedQualitySlope,
    persistenceSlope,
    explorationSlope,
    earlyVariance,
    recentVariance,
    confidence: clamp(independent.length / 20),
    reasons,
  };
}

function allocationScore(result: LoopConvergenceResult): number {
  switch (result.classification) {
    case "positive":
      return 3 + clamp(result.confidence);
    case "plateau":
      return 1.5;
    case "divergent":
      return 0.8;
    case "insufficient_evidence":
      return 0.6;
    case "negative":
      return 0.2;
  }
}

export function recommendLoopAllocation(
  observations: readonly LoopOutcomeObservation[],
  options: {
    totalBudgetUnits: number;
    explorationReserveFraction?: number;
  },
): { mode: "advisory"; recommendations: AllocationRecommendation[] } {
  if (!Number.isInteger(options.totalBudgetUnits) || options.totalBudgetUnits < 1) {
    throw new Error("totalBudgetUnits must be a positive integer");
  }
  const reserveFraction = clamp(options.explorationReserveFraction ?? 0.2, 0.05, 0.5);
  const byLoop = new Map<string, LoopOutcomeObservation[]>();
  for (const observation of observations) {
    const bucket = byLoop.get(observation.loopKind) ?? [];
    bucket.push(observation);
    byLoop.set(observation.loopKind, bucket);
  }
  if (byLoop.size === 0) return { mode: "advisory", recommendations: [] };

  const results = [...byLoop.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([loopKind, items]) => ({ loopKind, result: analyzeLoopConvergence(items) }));
  const minimumEach = Math.floor(
    (options.totalBudgetUnits * reserveFraction) / results.length,
  );
  const reserved = minimumEach * results.length;
  const distributable = options.totalBudgetUnits - reserved;
  const scoreTotal = results.reduce((sum, item) => sum + allocationScore(item.result), 0);
  const raw = results.map((item) => {
    const extra = distributable * allocationScore(item.result) / scoreTotal;
    return { ...item, exact: minimumEach + extra };
  });
  const floors = raw.map((item) => Math.floor(item.exact));
  let remainder = options.totalBudgetUnits - floors.reduce((sum, value) => sum + value, 0);
  const fractionOrder = raw
    .map((item, index) => ({ index, fraction: item.exact - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of fractionOrder) {
    if (remainder <= 0) break;
    floors[item.index]++;
    remainder--;
  }

  return {
    mode: "advisory",
    recommendations: raw.map((item, index) => ({
      loopKind: item.loopKind,
      allocationUnits: floors[index],
      allocationFraction: floors[index] / options.totalBudgetUnits,
      convergence: item.result.classification,
      mayExecute: false,
      rationale: item.result.reasons[0] ?? "No evidence rationale available.",
    })),
  };
}
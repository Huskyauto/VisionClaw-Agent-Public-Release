import { createHash } from "node:crypto";

export type ResearchObjectiveDirection = "maximize" | "minimize";
export type ResearchEvidenceKind = "empirical" | "llm_judge";
export type ResearchQualityEvidenceKind = "independent_evaluator" | "llm_judge" | "missing";

export interface ResearchDiscoveryCandidate {
  id: number;
  hypothesis: string;
  approach?: string | null;
  metric?: string | null;
}

export interface ResearchDiscoveryObservation extends ResearchDiscoveryCandidate {
  objectiveValue: number;
  objectiveDirection: ResearchObjectiveDirection;
  evidenceKind: ResearchEvidenceKind;
  qualityConstraintPassed?: boolean;
  qualityEvidenceKind?: ResearchQualityEvidenceKind;
  tenantId?: number;
  evidenceId?: string;
}

export interface ResearchDiscoveryRecommendation {
  status: "ready" | "insufficient_evidence" | "degraded";
  candidateId: number;
  predictedUtility: number | null;
  uncertainty: number | null;
  acquisitionScore: number | null;
  selectionThreshold: number | null;
  wouldSelect: boolean | null;
  referenceCount: number;
  empiricalReferenceCount: number;
  evidenceConfidence: number | null;
  reason: string | null;
}

export interface RecommendResearchCandidateInput {
  candidate: ResearchDiscoveryCandidate;
  priorObservations: ResearchDiscoveryObservation[];
  minObservations?: number;
  explorationWeight?: number;
}

export interface EvaluateResearchDiscoveryReplayInput {
  observations: ResearchDiscoveryObservation[];
  manifest?: ResearchDiscoveryReplayManifest;
  minObservations?: number;
  minSelected?: number;
  minUtilityUplift?: number;
  minEmpiricalFraction?: number;
  explorationWeight?: number;
}

export interface ResearchDiscoveryReplayManifestBody {
  manifestId: string;
  tenantId: number;
  source: "tenant_scoped_research_experiments" | "frozen_synthetic_fixture";
  expectedObservationIds: number[];
  trainingObservationIds: number[];
  holdoutObservationIds: number[];
}

export interface ResearchDiscoveryReplayManifest extends ResearchDiscoveryReplayManifestBody {
  manifestHash: string;
}

export interface ResearchDiscoveryReplayResult {
  status: "qualified" | "not_qualified" | "insufficient_evidence" | "degraded";
  qualified: boolean;
  coverage: number;
  eligibleCount: number;
  selectedCount: number;
  baselineMeanUtility: number | null;
  selectedMeanUtility: number | null;
  utilityUplift: number | null;
  reason: string;
}

export interface ResearchDiscoveryShadowRecord {
  policyVersion: "research-discovery-shadow-v1";
  mode: "shadow";
  candidateId: number;
  observedObjective: number | null;
  objectiveDirection: ResearchObjectiveDirection;
  evidenceKind: ResearchEvidenceKind;
  qualityConstraintPassed: boolean | null;
  qualityEvidenceKind: ResearchQualityEvidenceKind;
  status: ResearchDiscoveryRecommendation["status"];
  predictedUtility: number | null;
  uncertainty: number | null;
  acquisitionScore: number | null;
  selectionThreshold: number | null;
  wouldSelect: boolean | null;
  referenceCount: number;
  empiricalReferenceCount: number;
  evidenceConfidence: number | null;
  reason: string | null;
}

export interface BuildResearchDiscoveryShadowRecordInput {
  modeValue: string | undefined;
  candidate: ResearchDiscoveryCandidate;
  priorObservations: ResearchDiscoveryObservation[];
  observedObjective: number;
  objectiveDirection: ResearchObjectiveDirection;
  evidenceKind: ResearchEvidenceKind;
  qualityConstraintPassed?: boolean | null;
  qualityEvidenceKind?: ResearchQualityEvidenceKind;
  minObservations?: number;
  explorationWeight?: number;
}

export interface ResearchCrossoverShadowRecord {
  policyVersion: "research-crossover-shadow-v1";
  mode: "shadow";
  childId: number;
  parentIds: [number, number] | [];
  status: "accepted" | "rejected" | "not_applicable" | "insufficient_evidence" | "degraded";
  wouldPromote: boolean | null;
  objectiveDirection: ResearchObjectiveDirection;
  parentBestObjective: number | null;
  childObjective: number | null;
  objectiveDelta: number | null;
  reason: string;
}

export interface BuildResearchCrossoverShadowRecordInput {
  modeValue: string | undefined;
  candidate: ResearchDiscoveryObservation;
  priorObservations: ResearchDiscoveryObservation[];
}

interface ScoredCandidate {
  predictedUtility: number;
  uncertainty: number;
  acquisitionScore: number;
  evidenceConfidence: number;
}

const DEFAULT_MIN_OBSERVATIONS = 4;
const DEFAULT_EXPLORATION_WEIGHT = 0.25;
export const RESEARCH_DISCOVERY_CONTROLLER_MODE = "RESEARCH_DISCOVERY_CONTROLLER_MODE";
export const RESEARCH_CROSSOVER_MODE = "RESEARCH_CROSSOVER_MODE";
const EVIDENCE_WEIGHT: Record<ResearchEvidenceKind, number> = {
  empirical: 1,
  llm_judge: 0.35,
};

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "before", "by", "each", "for", "from",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "use", "with",
]);

export function resolveResearchDiscoveryMode(value: string | undefined): "off" | "shadow" {
  return value === "shadow" ? "shadow" : "off";
}

export function resolveResearchCrossoverMode(value: string | undefined): "off" | "shadow" {
  return value === "shadow" ? "shadow" : "off";
}

export function computeResearchDiscoveryManifestHash(
  manifest: ResearchDiscoveryReplayManifestBody,
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function candidateTokens(candidate: ResearchDiscoveryCandidate): Set<string> {
  const text = [candidate.hypothesis, candidate.approach || "", candidate.metric || ""]
    .join(" ")
    .toLowerCase();
  const words = text.match(/[a-z0-9][a-z0-9_-]{1,39}/g) || [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / (left.size + right.size - intersection);
}

function validObservation(
  observation: ResearchDiscoveryObservation,
  direction: ResearchObjectiveDirection,
): boolean {
  return Number.isFinite(observation.objectiveValue) &&
    observation.objectiveDirection === direction &&
    (observation.evidenceKind === "empirical" || observation.evidenceKind === "llm_judge") &&
    (observation.qualityConstraintPassed === undefined ||
      typeof observation.qualityConstraintPassed === "boolean");
}

function normalizedUtilities(
  observations: ResearchDiscoveryObservation[],
  direction: ResearchObjectiveDirection,
): number[] {
  const raw = observations.map((observation) =>
    direction === "maximize" ? observation.objectiveValue : -observation.objectiveValue,
  );
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (max === min) {
    return raw.map((_value, index) =>
      observations[index].qualityConstraintPassed === false ? 0 : 0.5,
    );
  }
  return raw.map((value, index) =>
    observations[index].qualityConstraintPassed === false ? 0 : (value - min) / (max - min),
  );
}

function scoreCandidate(
  candidate: ResearchDiscoveryCandidate,
  observations: ResearchDiscoveryObservation[],
  direction: ResearchObjectiveDirection,
  explorationWeight: number,
): ScoredCandidate {
  const utilities = normalizedUtilities(observations, direction);
  const tokens = candidateTokens(candidate);
  let totalWeight = 0;
  let weightedMean = 0;
  let maxSimilarity = 0;
  const weighted: Array<{ utility: number; weight: number }> = [];

  observations.forEach((observation, index) => {
    const similarity = jaccardSimilarity(tokens, candidateTokens(observation));
    maxSimilarity = Math.max(maxSimilarity, similarity);
    const kernelWeight = 0.01 + similarity * similarity;
    const weight = kernelWeight * EVIDENCE_WEIGHT[observation.evidenceKind];
    totalWeight += weight;
    weightedMean += utilities[index] * weight;
    weighted.push({ utility: utilities[index], weight });
  });

  const predictedUtility = totalWeight > 0 ? weightedMean / totalWeight : 0.5;
  const weightedVariance = totalWeight > 0
    ? weighted.reduce(
        (sum, item) => sum + item.weight * Math.pow(item.utility - predictedUtility, 2),
        0,
      ) / totalWeight
    : 0.25;
  const novelty = 1 - maxSimilarity;
  const evidenceConfidence = observations.reduce(
    (sum, observation) => sum + EVIDENCE_WEIGHT[observation.evidenceKind],
    0,
  ) / observations.length;
  const uncertainty = clamp(
    Math.sqrt(weightedVariance) * 0.5 +
    novelty * 0.5 +
    (1 - evidenceConfidence) * 0.25,
  );

  return {
    predictedUtility,
    uncertainty,
    acquisitionScore: predictedUtility + explorationWeight * uncertainty,
    evidenceConfidence,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function recommendResearchCandidate(
  input: RecommendResearchCandidateInput,
): ResearchDiscoveryRecommendation {
  const minObservations = Math.max(2, Math.floor(input.minObservations ?? DEFAULT_MIN_OBSERVATIONS));
  const explorationWeight = clamp(
    Number.isFinite(input.explorationWeight) ? input.explorationWeight! : DEFAULT_EXPLORATION_WEIGHT,
    0,
    2,
  );
  const direction = input.priorObservations[0]?.objectiveDirection;
  const base = {
    candidateId: input.candidate.id,
    predictedUtility: null,
    uncertainty: null,
    acquisitionScore: null,
    selectionThreshold: null,
    wouldSelect: null,
    empiricalReferenceCount: 0,
    evidenceConfidence: null,
  };

  if (!direction) {
    return {
      ...base,
      status: "insufficient_evidence",
      referenceCount: 0,
      reason: "no-prior-observations",
    };
  }

  const valid = input.priorObservations.filter((observation) =>
    validObservation(observation, direction),
  );
  const empiricalReferenceCount = valid.filter(
    (observation) => observation.evidenceKind === "empirical",
  ).length;

  if (valid.length < minObservations) {
    return {
      ...base,
      status: "insufficient_evidence",
      referenceCount: valid.length,
      empiricalReferenceCount,
      reason: "minimum-history-not-met",
    };
  }

  if (valid.length !== input.priorObservations.length) {
    return {
      ...base,
      status: "degraded",
      referenceCount: valid.length,
      empiricalReferenceCount,
      reason: "malformed-or-mixed-direction-history",
    };
  }

  const scored = scoreCandidate(input.candidate, valid, direction, explorationWeight);
  const leaveOneOutScores = valid.map((observation, index) => {
    const comparisonHistory = valid.filter((_entry, otherIndex) => otherIndex !== index);
    return scoreCandidate(
      observation,
      comparisonHistory,
      direction,
      explorationWeight,
    ).acquisitionScore;
  });
  const selectionThreshold = median(leaveOneOutScores);

  return {
    status: "ready",
    candidateId: input.candidate.id,
    predictedUtility: scored.predictedUtility,
    uncertainty: scored.uncertainty,
    acquisitionScore: scored.acquisitionScore,
    selectionThreshold,
    wouldSelect: scored.acquisitionScore >= selectionThreshold,
    referenceCount: valid.length,
    empiricalReferenceCount,
    evidenceConfidence: scored.evidenceConfidence,
    reason: null,
  };
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

export function buildResearchDiscoveryShadowRecord(
  input: BuildResearchDiscoveryShadowRecordInput,
): ResearchDiscoveryShadowRecord | null {
  if (resolveResearchDiscoveryMode(input.modeValue) !== "shadow") return null;

  const recommendation = recommendResearchCandidate({
    candidate: input.candidate,
    priorObservations: input.priorObservations,
    minObservations: input.minObservations,
    explorationWeight: input.explorationWeight,
  });

  return {
    policyVersion: "research-discovery-shadow-v1",
    mode: "shadow",
    candidateId: input.candidate.id,
    observedObjective: Number.isFinite(input.observedObjective)
      ? rounded(input.observedObjective)
      : null,
    objectiveDirection: input.objectiveDirection,
    evidenceKind: input.evidenceKind,
    qualityConstraintPassed: typeof input.qualityConstraintPassed === "boolean"
      ? input.qualityConstraintPassed
      : null,
    qualityEvidenceKind: input.qualityEvidenceKind || "missing",
    status: recommendation.status,
    predictedUtility: rounded(recommendation.predictedUtility),
    uncertainty: rounded(recommendation.uncertainty),
    acquisitionScore: rounded(recommendation.acquisitionScore),
    selectionThreshold: rounded(recommendation.selectionThreshold),
    wouldSelect: recommendation.wouldSelect,
    referenceCount: recommendation.referenceCount,
    empiricalReferenceCount: recommendation.empiricalReferenceCount,
    evidenceConfidence: rounded(recommendation.evidenceConfidence),
    reason: Number.isFinite(input.observedObjective)
      ? recommendation.reason
      : "invalid-observed-objective",
  };
}

export function serializeResearchDiscoveryShadowRecord(
  record: ResearchDiscoveryShadowRecord,
): string {
  return `[RESEARCH_DISCOVERY_SHADOW_V1] ${JSON.stringify(record)}`;
}

function hasTokenOverlap(left: ResearchDiscoveryCandidate, right: ResearchDiscoveryCandidate): boolean {
  const leftTokens = candidateTokens(left);
  const rightTokens = candidateTokens(right);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

export function buildResearchCrossoverShadowRecord(
  input: BuildResearchCrossoverShadowRecordInput,
): ResearchCrossoverShadowRecord | null {
  if (resolveResearchCrossoverMode(input.modeValue) !== "shadow") return null;
  const candidate = input.candidate;
  const base = {
    policyVersion: "research-crossover-shadow-v1" as const,
    mode: "shadow" as const,
    childId: candidate.id,
    objectiveDirection: candidate.objectiveDirection,
  };
  const degraded = (reason: string): ResearchCrossoverShadowRecord => ({
    ...base,
    parentIds: [],
    status: "degraded",
    wouldPromote: null,
    parentBestObjective: null,
    childObjective: Number.isFinite(candidate.objectiveValue) ? rounded(candidate.objectiveValue) : null,
    objectiveDelta: null,
    reason,
  });

  if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0 ||
      !Number.isSafeInteger(candidate.tenantId) || candidate.tenantId! <= 0 ||
      typeof candidate.evidenceId !== "string" || candidate.evidenceId.length < 8 ||
      !Number.isFinite(candidate.objectiveValue)) {
    return degraded("invalid-child-provenance");
  }

  const evidenceIds = input.priorObservations.map((observation) => observation.evidenceId);
  if (input.priorObservations.some((observation) =>
      observation.tenantId !== candidate.tenantId ||
      typeof observation.evidenceId !== "string" ||
      observation.evidenceId.length < 8 ||
      observation.objectiveDirection !== candidate.objectiveDirection ||
      !Number.isFinite(observation.objectiveValue)) ||
      new Set(evidenceIds).size !== evidenceIds.length ||
      evidenceIds.includes(candidate.evidenceId)) {
    return degraded("invalid-parent-provenance");
  }

  if (candidate.evidenceKind !== "empirical" ||
      candidate.qualityEvidenceKind !== "independent_evaluator") {
    return {
      ...degraded("child-lacks-independent-empirical-quality-evidence"),
      status: "not_applicable",
      wouldPromote: false,
    };
  }
  if (candidate.qualityConstraintPassed !== true) {
    return {
      ...degraded("child-quality-regression"),
      status: "rejected",
      wouldPromote: false,
    };
  }

  const eligibleParents = input.priorObservations
    .filter((observation) =>
      observation.evidenceKind === "empirical" &&
      observation.qualityConstraintPassed === true &&
      observation.qualityEvidenceKind === "independent_evaluator")
    .sort((left, right) => {
      const objectiveOrder = candidate.objectiveDirection === "maximize"
        ? right.objectiveValue - left.objectiveValue
        : left.objectiveValue - right.objectiveValue;
      return objectiveOrder || left.id - right.id;
    });
  if (eligibleParents.length < 2) {
    return {
      ...degraded("two-independent-empirical-parents-required"),
      status: "insufficient_evidence",
      wouldPromote: null,
    };
  }

  const parents = eligibleParents.slice(0, 2) as [ResearchDiscoveryObservation, ResearchDiscoveryObservation];
  const parentIds: [number, number] = [parents[0].id, parents[1].id];
  const parentBestObjective = candidate.objectiveDirection === "maximize"
    ? Math.max(parents[0].objectiveValue, parents[1].objectiveValue)
    : Math.min(parents[0].objectiveValue, parents[1].objectiveValue);
  if (!hasTokenOverlap(candidate, parents[0]) || !hasTokenOverlap(candidate, parents[1])) {
    return {
      ...base,
      parentIds,
      status: "not_applicable",
      wouldPromote: false,
      parentBestObjective: rounded(parentBestObjective),
      childObjective: rounded(candidate.objectiveValue),
      objectiveDelta: null,
      reason: "child-does-not-combine-both-parents",
    };
  }

  const objectiveDelta = candidate.objectiveDirection === "maximize"
    ? candidate.objectiveValue - parentBestObjective
    : parentBestObjective - candidate.objectiveValue;
  const accepted = objectiveDelta > 0;
  return {
    ...base,
    parentIds,
    status: accepted ? "accepted" : "rejected",
    wouldPromote: accepted,
    parentBestObjective: rounded(parentBestObjective),
    childObjective: rounded(candidate.objectiveValue),
    objectiveDelta: rounded(objectiveDelta),
    reason: accepted ? "strict-objective-improvement" : "no-strict-objective-improvement",
  };
}

export function serializeResearchCrossoverShadowRecord(
  record: ResearchCrossoverShadowRecord,
): string {
  return `[RESEARCH_CROSSOVER_SHADOW_V1] ${JSON.stringify(record)}`;
}

export function buildResearchDiscoveryFailureRecord(input: {
  candidateId: number;
  observedObjective: number;
  objectiveDirection: ResearchObjectiveDirection;
  evidenceKind: ResearchEvidenceKind;
  qualityConstraintPassed: boolean | null;
  qualityEvidenceKind: ResearchQualityEvidenceKind;
}): ResearchDiscoveryShadowRecord {
  return {
    policyVersion: "research-discovery-shadow-v1",
    mode: "shadow",
    candidateId: input.candidateId,
    observedObjective: Number.isFinite(input.observedObjective)
      ? rounded(input.observedObjective)
      : null,
    objectiveDirection: input.objectiveDirection,
    evidenceKind: input.evidenceKind,
    qualityConstraintPassed: input.qualityConstraintPassed,
    qualityEvidenceKind: input.qualityEvidenceKind,
    status: "degraded",
    predictedUtility: null,
    uncertainty: null,
    acquisitionScore: null,
    selectionThreshold: null,
    wouldSelect: null,
    referenceCount: 0,
    empiricalReferenceCount: 0,
    evidenceConfidence: null,
    reason: "controller-error",
  };
}

export function evaluateResearchDiscoveryReplay(
  input: EvaluateResearchDiscoveryReplayInput,
): ResearchDiscoveryReplayResult {
  const emptyMetrics = {
    eligibleCount: 0,
    selectedCount: 0,
    baselineMeanUtility: null,
    selectedMeanUtility: null,
    utilityUplift: null,
  };
  const fail = (
    status: ResearchDiscoveryReplayResult["status"],
    reason: string,
    coverage: number,
  ): ResearchDiscoveryReplayResult => ({
    status, qualified: false, coverage, reason, ...emptyMetrics,
  });
  const manifest = input.manifest;
  if (!manifest) return fail("degraded", "replay-manifest-required", 0);
  const expectedIds = manifest.expectedObservationIds;
  const actualIds = input.observations.map((observation) => observation.id);
  if (new Set(actualIds).size !== actualIds.length) {
    return fail("degraded", "duplicate-observation-id", 0);
  }
  const coverage = expectedIds.length === 0
    ? 0
    : clamp(actualIds.filter((id) => expectedIds.includes(id)).length / expectedIds.length);
  const manifestBody: ResearchDiscoveryReplayManifestBody = {
    manifestId: manifest.manifestId,
    tenantId: manifest.tenantId,
    source: manifest.source,
    expectedObservationIds: manifest.expectedObservationIds,
    trainingObservationIds: manifest.trainingObservationIds,
    holdoutObservationIds: manifest.holdoutObservationIds,
  };
  if (!/^[a-z0-9][a-z0-9._-]{7,79}$/.test(manifest.manifestId) ||
      !Number.isInteger(manifest.tenantId) || manifest.tenantId <= 0 ||
      computeResearchDiscoveryManifestHash(manifestBody) !== manifest.manifestHash) {
    return fail("degraded", "invalid-replay-manifest", coverage);
  }
  const trainIds = manifest.trainingObservationIds;
  const holdoutIds = manifest.holdoutObservationIds;
  const partitionIds = [...trainIds, ...holdoutIds];
  if (new Set(expectedIds).size !== expectedIds.length ||
      new Set(partitionIds).size !== partitionIds.length ||
      expectedIds.length !== partitionIds.length ||
      expectedIds.some((id, index) => id !== partitionIds[index]) ||
      holdoutIds.length === 0) {
    return fail("degraded", "invalid-replay-partition", coverage);
  }
  if (actualIds.length !== expectedIds.length ||
      expectedIds.some((id) => !actualIds.includes(id))) {
    return {
      status: "degraded",
      qualified: false,
      coverage,
      reason: "incomplete-coverage",
      ...emptyMetrics,
    };
  }
  if (actualIds.some((id, index) => id !== expectedIds[index])) {
    return fail("degraded", "observation-order-mismatch", coverage);
  }
  const evidenceIds = input.observations.map((observation) => observation.evidenceId);
  if (input.observations.some((observation) =>
      observation.tenantId !== manifest.tenantId ||
      typeof observation.evidenceId !== "string" ||
      observation.evidenceId.length < 8) ||
      new Set(evidenceIds).size !== evidenceIds.length) {
    return fail("degraded", "invalid-observation-provenance", coverage);
  }
  const direction = input.observations[0]?.objectiveDirection;
  if (!direction) {
    return fail("insufficient_evidence", "no-observations", coverage);
  }

  const valid = input.observations.filter((observation) =>
    validObservation(observation, direction),
  );
  if (valid.length !== input.observations.length) {
    return fail("degraded", "malformed-or-mixed-direction-history", coverage);
  }

  const minObservations = Math.max(
    2,
    Math.floor(input.minObservations ?? DEFAULT_MIN_OBSERVATIONS),
  );
  if (trainIds.length < minObservations || valid.length <= minObservations) {
    return fail("insufficient_evidence", "minimum-history-not-met", coverage);
  }

  const minEmpiricalFraction = clamp(
    Number.isFinite(input.minEmpiricalFraction) ? input.minEmpiricalFraction! : 0.5,
  );
  const empiricalFraction = valid.filter(
    (observation) => observation.evidenceKind === "empirical",
  ).length / valid.length;
  if (empiricalFraction < minEmpiricalFraction) {
    return fail("not_qualified", "insufficient-empirical-evidence", coverage);
  }
  if (valid.some((observation) =>
      observation.qualityEvidenceKind !== "independent_evaluator" ||
      typeof observation.qualityConstraintPassed !== "boolean")) {
    return fail("not_qualified", "missing-independent-quality-evidence", coverage);
  }

  const utilities = normalizedUtilities(valid, direction);
  const eligibleIndexes: number[] = [];
  const selectedIndexes: number[] = [];
  for (const holdoutId of holdoutIds) {
    const index = valid.findIndex((observation) => observation.id === holdoutId);
    if (index < minObservations) {
      return fail("degraded", "invalid-temporal-holdout", coverage);
    }
    const recommendation = recommendResearchCandidate({
      candidate: valid[index],
      priorObservations: valid.slice(0, index),
      minObservations,
      explorationWeight: input.explorationWeight,
    });
    if (recommendation.status !== "ready") {
      return {
        status: "degraded",
        qualified: false,
        coverage,
        reason: `replay-${recommendation.reason || "recommendation-failed"}`,
        ...emptyMetrics,
      };
    }
    eligibleIndexes.push(index);
    if (recommendation.wouldSelect) selectedIndexes.push(index);
  }

  const mean = (indexes: number[]): number | null => indexes.length === 0
    ? null
    : indexes.reduce((sum, index) => sum + utilities[index], 0) / indexes.length;
  const baselineMeanUtility = mean(eligibleIndexes);
  const selectedMeanUtility = mean(selectedIndexes);
  const selectedConstraintRegression = selectedIndexes.some(
    (index) => valid[index].qualityConstraintPassed === false,
  );
  const utilityUplift = baselineMeanUtility !== null && selectedMeanUtility !== null
    ? selectedMeanUtility - baselineMeanUtility
    : null;
  const minSelected = Math.max(1, Math.floor(input.minSelected ?? 2));
  const minUtilityUplift = clamp(
    Number.isFinite(input.minUtilityUplift) ? input.minUtilityUplift! : 0.05,
    0,
    1,
  );
  const qualified = !selectedConstraintRegression &&
    selectedIndexes.length >= minSelected &&
    utilityUplift !== null &&
    utilityUplift >= minUtilityUplift;

  return {
    status: qualified ? "qualified" : "not_qualified",
    qualified,
    coverage,
    eligibleCount: eligibleIndexes.length,
    selectedCount: selectedIndexes.length,
    baselineMeanUtility,
    selectedMeanUtility,
    utilityUplift,
    reason: qualified
      ? "complete-held-out-uplift"
      : selectedConstraintRegression
        ? "selected-constraint-regression"
        : selectedIndexes.length < minSelected
        ? "insufficient-selected-observations"
        : "minimum-uplift-not-met",
  };
}
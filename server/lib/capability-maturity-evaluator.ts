import {
  parseCapabilityEvidenceObservation,
  type CapabilityEvidenceObservation,
} from "./capability-evidence-shadow";

export type CapabilityPerformanceStatus =
  | "insufficient_evidence"
  | "repeatable_narrow_success";

export type CapabilityGeneralityStatus =
  | "insufficient_evidence"
  | "single_task_narrow_evidence"
  | "multi_task_narrow_evidence";

export interface CapabilityMaturityAssessment {
  capability: string;
  observations: {
    valid: number;
    corroborated: number;
    verifiedSuccesses: number;
    hollowSuccesses: number;
    failures: number;
    distinctRewardIds: number;
    distinctTaskDigests: number;
    historicalNegativeEvidence: boolean;
  };
  performance: {
    status: CapabilityPerformanceStatus;
    averageObservedScore: number | null;
    minimumStrongCorroboratedSuccessesRequired: 3;
  };
  generality: {
    status: CapabilityGeneralityStatus;
    claimCeiling: "narrow_capability_only";
  };
  humanPerformanceLevel: {
    status: "insufficient_evidence";
    reason: string;
  };
}

export interface CapabilityMaturityReport {
  schemaVersion: 1;
  framework: "performance_x_generality_evidence";
  reportOnly: true;
  autonomyChanged: false;
  authorityEffect: "none";
  summary: {
    observationsReceived: number;
    validObservations: number;
    malformedObservations: number;
    evaluatedCapabilities: number;
    repeatableNarrowCapabilities: number;
    distinctTaskCohorts: number;
    claimCeiling: "narrow_capability_evidence_only";
    generality: "insufficient_evidence";
  };
  evidenceGaps: {
    humanPercentileBenchmark: "insufficient_evidence";
    generalIntelligence: "insufficient_evidence";
    cost: "insufficient_evidence";
    latency: "insufficient_evidence";
    safetyIncidents: "insufficient_evidence";
    independentEvaluatorIdentity: "insufficient_evidence";
  };
  capabilities: CapabilityMaturityAssessment[];
  limitations: string[];
}

function roundedAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 100) / 100;
}

function evidenceRisk(row: CapabilityEvidenceObservation): number {
  if (row.evidenceClass === "failed") return 2;
  if (row.evidenceClass === "hollow_success") return 1;
  return 0;
}

export function evaluateCapabilityMaturity(
  observations: readonly unknown[],
  corroboratedRewardIds: ReadonlySet<number>,
  historicalNegativeCapabilities: ReadonlySet<string> = new Set(),
): CapabilityMaturityReport {
  const valid: CapabilityEvidenceObservation[] = [];
  let malformedObservations = 0;
  for (const observation of observations) {
    const parsed = parseCapabilityEvidenceObservation(observation);
    if (!parsed) {
      malformedObservations++;
      continue;
    }
    valid.push(parsed);
  }

  const grouped = new Map<string, CapabilityEvidenceObservation[]>();
  for (const observation of valid) {
    const rows = grouped.get(observation.capability) ?? [];
    rows.push(observation);
    grouped.set(observation.capability, rows);
  }

  const capabilities = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, rows]): CapabilityMaturityAssessment => {
      const uniqueCorroborated = new Map<number, CapabilityEvidenceObservation>();
      for (const row of rows) {
        if (!corroboratedRewardIds.has(row.rewardId)) continue;
        const existing = uniqueCorroborated.get(row.rewardId);
        if (
          !existing ||
          evidenceRisk(row) > evidenceRisk(existing) ||
          (evidenceRisk(row) === evidenceRisk(existing) && row.stepIndex < existing.stepIndex)
        ) {
          uniqueCorroborated.set(row.rewardId, row);
        }
      }
      const corroborated = [...uniqueCorroborated.values()];
      const verified = corroborated.filter((row) => row.evidenceClass === "verified_success");
      const hollow = corroborated.filter((row) => row.evidenceClass === "hollow_success");
      const failed = corroborated.filter((row) => row.evidenceClass === "failed");
      const strong = verified.filter((row) => row.score >= 70 && row.outputLen >= 80);
      const taskDigests = new Set(verified.map((row) => row.taskDigest));
      const historicalNegativeEvidence = historicalNegativeCapabilities.has(capability);
      const performanceStatus: CapabilityPerformanceStatus =
        strong.length >= 3 &&
        hollow.length === 0 &&
        failed.length === 0 &&
        !historicalNegativeEvidence
          ? "repeatable_narrow_success"
          : "insufficient_evidence";
      const generalityStatus: CapabilityGeneralityStatus =
        taskDigests.size >= 3
          ? "multi_task_narrow_evidence"
          : taskDigests.size >= 1
            ? "single_task_narrow_evidence"
            : "insufficient_evidence";

      return {
        capability,
        observations: {
          valid: rows.length,
          corroborated: corroborated.length,
          verifiedSuccesses: verified.length,
          hollowSuccesses: hollow.length,
          failures: failed.length,
          distinctRewardIds: uniqueCorroborated.size,
          distinctTaskDigests: taskDigests.size,
          historicalNegativeEvidence,
        },
        performance: {
          status: performanceStatus,
          averageObservedScore: roundedAverage(corroborated.map((row) => row.score)),
          minimumStrongCorroboratedSuccessesRequired: 3,
        },
        generality: {
          status: generalityStatus,
          claimCeiling: "narrow_capability_only",
        },
        humanPerformanceLevel: {
          status: "insufficient_evidence",
          reason: "Observed reward scores are not calibrated percentiles against a defined population of skilled adults.",
        },
      };
    });

  return {
    schemaVersion: 1,
    framework: "performance_x_generality_evidence",
    reportOnly: true,
    autonomyChanged: false,
    authorityEffect: "none",
    summary: {
      observationsReceived: observations.length,
      validObservations: valid.length,
      malformedObservations,
      evaluatedCapabilities: capabilities.length,
      repeatableNarrowCapabilities: capabilities.filter(
        (row) => row.performance.status === "repeatable_narrow_success",
      ).length,
      distinctTaskCohorts: new Set(valid.map((row) => row.taskDigest)).size,
      claimCeiling: "narrow_capability_evidence_only",
      generality: "insufficient_evidence",
    },
    evidenceGaps: {
      humanPercentileBenchmark: "insufficient_evidence",
      generalIntelligence: "insufficient_evidence",
      cost: "insufficient_evidence",
      latency: "insufficient_evidence",
      safetyIncidents: "insufficient_evidence",
      independentEvaluatorIdentity: "insufficient_evidence",
    },
    capabilities,
    limitations: [
      "Repeated success on one capability does not establish general intelligence.",
      "Distinct task digests show task variation, not independently validated domain breadth.",
      "Observed reward scores are not human percentile benchmarks.",
      "Missing cost, latency, safety-incident, or evaluator-independence evidence is never inferred.",
    ],
  };
}
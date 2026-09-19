import { verifyJuryDecisionHash } from "./skill-optimizer-promotion";

export type ImprovementEvidenceLevel = 0 | 1 | 2 | 3;

export interface ImprovementCandidateEvidence {
  id: number;
  tenantId: number;
  skillId: number | null;
  label: string;
  state: string;
  seedHash: string;
  candidateHash: string;
  evalSetHash: string;
  policyVersion: string;
  evidence: unknown;
  juryDecision: unknown;
  juryDecisionHash: string | null;
  promotedVersionId: number | null;
  rolledBackAt: Date | string | null;
}

export interface ImprovementVersionEvidence {
  id: number;
  candidateId: number;
  contentHash: string;
  kind: string;
}

export interface ImprovementEvidenceReport {
  candidateId: number;
  label: string;
  evidenceLevel: ImprovementEvidenceLevel;
  levelName:
    | "insufficient_evidence"
    | "observed_candidate_gain"
    | "held_out_candidate_gain"
    | "validated_promotion";
  claimCeiling: "insufficient_evidence" | "current_task_gain";
  currentTask: {
    status: "demonstrated" | "insufficient_evidence";
    baselineScore: number | null;
    candidateScore: number | null;
    absoluteGain: number | null;
    headroomClosed: number | null;
  };
  persistentInheritance: {
    status: "insufficient_evidence";
    observedIndependentCohorts: number;
    minimumIndependentCohortsRequired: 2;
    reason: string;
  };
  authority: {
    independentlyApproved: boolean;
    immutableVersionMatched: boolean;
    rollbackRecorded: boolean;
    stopControlAssessment: "not_evaluated_from_candidate_record";
  };
  limitations: string[];
}

export interface ImprovementEvidenceSummary {
  evaluatedCandidates: number;
  highestEvidenceLevel: number;
  demonstratedBoundHeldOutGains: number;
  validatedPromotions: number;
  demonstratedPersistentInheritedGains: 0;
  abilityClaim:
    | "insufficient_evidence"
    | "current_task_improvement_demonstrated_persistent_inheritance_unproven";
}

interface ParsedAttestation {
  seedHash?: unknown;
  candidateHash?: unknown;
  evalSetHash?: unknown;
  policyVersion?: unknown;
  baselineScore?: unknown;
  bestScore?: unknown;
  acceptedEdits?: unknown;
  rejectedEdits?: unknown;
}

function readAttestation(evidence: unknown): ParsedAttestation | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const attestation = (evidence as Record<string, unknown>).evaluationAttestation;
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return null;
  return attestation as ParsedAttestation;
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function evaluateImprovementEvidence(
  candidate: ImprovementCandidateEvidence,
  promotedVersion: ImprovementVersionEvidence | null,
): ImprovementEvidenceReport {
  const attestation = readAttestation(candidate.evidence);
  const baseline = attestation?.baselineScore;
  const best = attestation?.bestScore;
  const scoresShowGain = validScore(baseline) && validScore(best) && best > baseline;
  const editsValid =
    Number.isInteger(attestation?.acceptedEdits) &&
    Number(attestation?.acceptedEdits) >= 1 &&
    Number.isInteger(attestation?.rejectedEdits) &&
    Number(attestation?.rejectedEdits) >= 0;
  const observedGain = scoresShowGain && editsValid;
  const bound =
    observedGain &&
    attestation?.seedHash === candidate.seedHash &&
    attestation?.candidateHash === candidate.candidateHash &&
    attestation?.evalSetHash === candidate.evalSetHash &&
    attestation?.policyVersion === candidate.policyVersion;
  const terminalFailure =
    candidate.state === "rejected" ||
    candidate.state === "failed" ||
    candidate.state === "rolled_back";

  let evidenceLevel: ImprovementEvidenceLevel =
    bound && !terminalFailure ? 2 : bound && observedGain ? 1 : 0;
  let levelName: ImprovementEvidenceReport["levelName"] =
    evidenceLevel === 2
      ? "held_out_candidate_gain"
      : evidenceLevel === 1
        ? "observed_candidate_gain"
        : "insufficient_evidence";

  const jury = candidate.juryDecision && typeof candidate.juryDecision === "object"
    ? candidate.juryDecision as Record<string, unknown>
    : null;
  const independentApproval =
    jury?.verdict === "FIX" &&
    jury?.majority === 2 &&
    jury?.shouldEscalate !== true &&
    verifyJuryDecisionHash({
      tenantId: candidate.tenantId,
      skillId: candidate.skillId,
      seedHash: candidate.seedHash,
      candidateHash: candidate.candidateHash,
      policyVersion: candidate.policyVersion,
      evidence: candidate.evidence,
      decision: candidate.juryDecision,
      providedHash: candidate.juryDecisionHash,
    });
  const immutableVersionMatched =
    candidate.state === "promoted" &&
    candidate.promotedVersionId !== null &&
    promotedVersion?.id === candidate.promotedVersionId &&
    promotedVersion.candidateId === candidate.id &&
    promotedVersion.contentHash === candidate.candidateHash &&
    promotedVersion.kind === "promotion";

  if (bound && independentApproval && immutableVersionMatched) {
    evidenceLevel = 3;
    levelName = "validated_promotion";
  }

  const demonstratedGain = bound && observedGain;
  const absoluteGain = demonstratedGain ? best - baseline : null;
  const remainingHeadroom = demonstratedGain ? 1 - baseline : 0;
  const headroomClosed =
    absoluteGain !== null && remainingHeadroom > 0
      ? Math.max(0, Math.min(1, absoluteGain / remainingHeadroom))
      : null;
  const limitations = [
    "Current records do not contain repeated, independent, version-bound held-out cohorts.",
    "A candidate score or validated promotion does not prove persistent inherited improvement.",
  ];
  if (terminalFailure) limitations.unshift(`Candidate state is ${candidate.state}; terminal candidates cannot establish held-out improvement.`);
  if (!bound) limitations.unshift("Evaluation evidence is missing, malformed, non-improving, or not bound to this candidate and policy.");

  return {
    candidateId: candidate.id,
    label: candidate.label,
    evidenceLevel,
    levelName,
    claimCeiling: evidenceLevel > 0 ? "current_task_gain" : "insufficient_evidence",
    currentTask: {
      status: demonstratedGain ? "demonstrated" : "insufficient_evidence",
      baselineScore: demonstratedGain ? baseline : null,
      candidateScore: demonstratedGain ? best : null,
      absoluteGain,
      headroomClosed,
    },
    persistentInheritance: {
      status: "insufficient_evidence",
      observedIndependentCohorts: 0,
      minimumIndependentCohortsRequired: 2,
      reason: "No repeated independent held-out evaluations are durably bound to the promoted version and task cohorts.",
    },
    authority: {
      independentlyApproved: independentApproval,
      immutableVersionMatched,
      rollbackRecorded: candidate.state === "rolled_back" || candidate.rolledBackAt !== null,
      stopControlAssessment: "not_evaluated_from_candidate_record",
    },
    limitations,
  };
}

export function summarizeImprovementEvidence(
  reports: readonly ImprovementEvidenceReport[],
): ImprovementEvidenceSummary {
  const supportedReports = reports.filter((report) => report.evidenceLevel >= 2);
  const demonstratedBoundHeldOutGains = supportedReports.length;
  return {
    evaluatedCandidates: reports.length,
    highestEvidenceLevel: supportedReports.reduce(
      (max, report) => Math.max(max, report.evidenceLevel),
      0,
    ),
    demonstratedBoundHeldOutGains,
    validatedPromotions: reports.filter((report) => report.evidenceLevel === 3).length,
    demonstratedPersistentInheritedGains: 0,
    abilityClaim: demonstratedBoundHeldOutGains > 0
      ? "current_task_improvement_demonstrated_persistent_inheritance_unproven"
      : "insufficient_evidence",
  };
}
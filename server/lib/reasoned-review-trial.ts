/**
 * Shadow-only candidate-level review core.
 *
 * This module deliberately has no database, provider, delivery, routing, or
 * auto-apply imports. It evaluates supplied benchmark candidates only; callers
 * decide whether and where durable experiment evidence is persisted.
 */

export type ReviewCandidate = {
  id: string;
  content: string;
  generatorModel?: string;
};

export type ReasonedReviewCase = {
  id: string;
  rubric: string;
  baselineCandidateId: string;
  expectedWinnerId: string;
  candidates: ReviewCandidate[];
};

export type PositionBlindReviewInput = {
  caseId: string;
  rubric: string;
  candidates: Array<{ position: number; content: string }>;
};

export type PositionBlindVerdict = {
  winnerPosition: number;
  scores: number[];
  critique: string;
  costUsd?: number;
  latencyMs?: number;
};

export type ReasonedReviewer = {
  model: string;
  review: (input: PositionBlindReviewInput) => Promise<PositionBlindVerdict>;
};

export type ReviewVerdictRecord = {
  model: string;
  winnerCandidateId: string | null;
  scoresByCandidate: Record<string, number>;
  critique: string;
  costUsd: number;
  latencyMs: number;
  error?: string;
};

export type ReasonedReviewCaseResult = {
  id: string;
  baselineCandidateId: string;
  expectedWinnerId: string;
  randomizedCandidateIds: string[];
  winnerCandidateId: string | null;
  scoresByCandidate: Record<string, number>;
  reviewerVerdicts: ReviewVerdictRecord[];
  disagreement: boolean;
  degraded: boolean;
  degradationReason?: string;
};

export type ReasonedReviewTrialResult = {
  benchmarkVersion: string;
  status: "complete" | "degraded";
  degradationReason?: string;
  cases: ReasonedReviewCaseResult[];
  metrics: {
    totalCases: number;
    attemptedCases: number;
    evaluatedCases: number;
    degradedRate: number;
    disagreementRate: number;
    qualityLift: number | null;
    meanScoreMargin: number | null;
    totalLatencyMs: number;
    totalCostUsd: number;
  };
};

export type RunReasonedReviewTrialInput = {
  benchmarkVersion: string;
  cases: ReasonedReviewCase[];
  reviewers: ReasonedReviewer[];
  random?: () => number;
};

export function forensicRecordFileName(tenantId: number, runKey: string): string {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("forensic record filename requires a positive tenant ID");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(runKey)) {
    throw new Error("forensic record filename requires a validated run key");
  }
  return `tenant-${tenantId}-${runKey}.json`;
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("random must return a finite number in [0, 1)");
    }
    const swapIndex = Math.floor(value * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function validateCase(reviewCase: ReasonedReviewCase): void {
  if (!reviewCase.id || !reviewCase.rubric || reviewCase.candidates.length < 2) {
    throw new Error(`malformed reasoned-review case ${reviewCase.id || "(missing id)"}`);
  }
  const ids = new Set<string>();
  for (const candidate of reviewCase.candidates) {
    if (!candidate.id || !candidate.content || ids.has(candidate.id)) {
      throw new Error(`malformed candidate in reasoned-review case ${reviewCase.id}`);
    }
    ids.add(candidate.id);
  }
  if (!ids.has(reviewCase.baselineCandidateId) || !ids.has(reviewCase.expectedWinnerId)) {
    throw new Error(`baseline/expected winner missing from reasoned-review case ${reviewCase.id}`);
  }
}

function validVerdict(verdict: PositionBlindVerdict, candidateCount: number): boolean {
  return Number.isInteger(verdict?.winnerPosition)
    && verdict.winnerPosition >= 0
    && verdict.winnerPosition < candidateCount
    && Array.isArray(verdict.scores)
    && verdict.scores.length === candidateCount
    && verdict.scores.every((score) => clampScore(score) !== null)
    && typeof verdict.critique === "string";
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export async function runReasonedReviewTrial(input: RunReasonedReviewTrialInput): Promise<ReasonedReviewTrialResult> {
  if (!input.benchmarkVersion || input.cases.length === 0 || input.reviewers.length === 0) {
    throw new Error("reasoned-review trial requires a benchmark version, cases, and reviewers");
  }
  const random = input.random || Math.random;
  const caseResults: ReasonedReviewCaseResult[] = [];
  let degradationReason: string | undefined;

  for (const reviewCase of input.cases) {
    validateCase(reviewCase);
    const generatorModels = new Set(
      reviewCase.candidates
        .map((candidate) => candidate.generatorModel?.trim())
        .filter((model): model is string => Boolean(model)),
    );
    for (const reviewer of input.reviewers) {
      if (!reviewer.model?.trim()) {
        throw new Error("reasoned-review reviewer requires a model identity");
      }
      if (generatorModels.has(reviewer.model.trim())) {
        throw new Error(`reasoned-review reviewer ${reviewer.model} must differ from every declared candidate generator`);
      }
    }
    const orderedCandidates = shuffled(reviewCase.candidates, random);
    const reviewerVerdicts: ReviewVerdictRecord[] = [];

    for (const reviewer of input.reviewers) {
      const startedAt = Date.now();
      try {
        const verdict = await reviewer.review({
          caseId: reviewCase.id,
          rubric: reviewCase.rubric,
          candidates: orderedCandidates.map((candidate, position) => ({ position, content: candidate.content })),
        });
        const elapsedMs = Date.now() - startedAt;
        if (!validVerdict(verdict, orderedCandidates.length)) {
          reviewerVerdicts.push({
            model: reviewer.model,
            winnerCandidateId: null,
            scoresByCandidate: {},
            critique: "",
            costUsd: nonNegative(verdict?.costUsd),
            latencyMs: nonNegative(verdict?.latencyMs) || elapsedMs,
            error: "invalid reviewer verdict",
          });
          continue;
        }
        reviewerVerdicts.push({
          model: reviewer.model,
          winnerCandidateId: orderedCandidates[verdict.winnerPosition].id,
          scoresByCandidate: Object.fromEntries(orderedCandidates.map((candidate, position) => [
            candidate.id,
            clampScore(verdict.scores[position])!,
          ])),
          critique: verdict.critique.slice(0, 600),
          costUsd: nonNegative(verdict.costUsd),
          latencyMs: nonNegative(verdict.latencyMs) || elapsedMs,
        });
      } catch (error) {
        reviewerVerdicts.push({
          model: reviewer.model,
          winnerCandidateId: null,
          scoresByCandidate: {},
          critique: "",
          costUsd: 0,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 300) : "reviewer failed",
        });
      }
    }

    const validReviewerVerdicts = reviewerVerdicts.filter((verdict) => !verdict.error);
    const winnerIds = validReviewerVerdicts.map((verdict) => verdict.winnerCandidateId!);
    const disagreement = new Set(winnerIds).size > 1;
    const scoresByCandidate: Record<string, number> = {};
    for (const candidate of orderedCandidates) {
      const candidateScores = validReviewerVerdicts
        .map((verdict) => verdict.scoresByCandidate[candidate.id])
        .filter((score): score is number => typeof score === "number");
      const average = mean(candidateScores);
      if (average !== null) scoresByCandidate[candidate.id] = average;
    }

    // A split panel is evidence, not a tie to break. This experiment has no
    // production selection caller, so withholding an aggregate winner is safer
    // and more useful than inventing false certainty from mean scores.
    const winnerCandidateId = validReviewerVerdicts.length > 0 && !disagreement
      ? winnerIds[0]
      : null;
    const degraded = validReviewerVerdicts.length === 0;
    caseResults.push({
      id: reviewCase.id,
      baselineCandidateId: reviewCase.baselineCandidateId,
      expectedWinnerId: reviewCase.expectedWinnerId,
      randomizedCandidateIds: orderedCandidates.map((candidate) => candidate.id),
      winnerCandidateId,
      scoresByCandidate,
      reviewerVerdicts,
      disagreement,
      degraded,
      ...(degraded ? { degradationReason: "no valid reviewer verdict" } : {}),
    });
    if (caseResults.filter((result) => result.degraded).length > input.cases.length / 2) {
      degradationReason = "more than half of benchmark cases had no valid reviewer verdict";
      break;
    }
  }

  const evaluatedCases = caseResults.filter((result) => !result.degraded && result.winnerCandidateId !== null);
  const margins = evaluatedCases.map((result) => {
    const sortedScores = Object.values(result.scoresByCandidate).sort((left, right) => right - left);
    return sortedScores.length > 1 ? sortedScores[0] - sortedScores[1] : null;
  }).filter((margin): margin is number => margin !== null);
  const reviewerCountedCases = caseResults.filter((result) => result.reviewerVerdicts.some((verdict) => !verdict.error));
  const selectionAccuracy = evaluatedCases.length
    ? evaluatedCases.filter((result) => result.winnerCandidateId === result.expectedWinnerId).length / evaluatedCases.length
    : null;
  const baselineAccuracy = evaluatedCases.length
    ? evaluatedCases.filter((result) => result.baselineCandidateId === result.expectedWinnerId).length / evaluatedCases.length
    : null;

  return {
    benchmarkVersion: input.benchmarkVersion,
    status: degradationReason ? "degraded" : "complete",
    ...(degradationReason ? { degradationReason } : {}),
    cases: caseResults,
    metrics: {
      totalCases: input.cases.length,
      attemptedCases: caseResults.length,
      evaluatedCases: evaluatedCases.length,
      degradedRate: caseResults.filter((result) => result.degraded).length / caseResults.length,
      disagreementRate: reviewerCountedCases.length
        ? reviewerCountedCases.filter((result) => result.disagreement).length / reviewerCountedCases.length
        : 0,
      qualityLift: selectionAccuracy === null || baselineAccuracy === null ? null : selectionAccuracy - baselineAccuracy,
      meanScoreMargin: mean(margins),
      totalLatencyMs: caseResults.reduce(
        (sum, result) => sum + result.reviewerVerdicts.reduce((caseSum, verdict) => caseSum + verdict.latencyMs, 0),
        0,
      ),
      totalCostUsd: caseResults.reduce(
        (sum, result) => sum + result.reviewerVerdicts.reduce((caseSum, verdict) => caseSum + verdict.costUsd, 0),
        0,
      ),
    },
  };
}
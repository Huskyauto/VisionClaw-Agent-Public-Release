export interface ExpertEvidenceSummary {
  costPerQuery: number;
  judgeScoreAvg: number;
  failureCount: number;
  ttftMsAvg?: number;
  streamDurationMsAvg?: number;
  outputTokensPerSecondAvg?: number;
}

export interface ExpertCostEvidenceInput {
  baselineMetricValue: number | null | undefined;
  screen: ExpertEvidenceSummary;
  full?: ExpertEvidenceSummary;
  ablation?: ExpertEvidenceSummary;
  customPromptUsed: boolean;
}

export interface ExpertCostEvidenceVerdict {
  shouldRunFullSuite: boolean;
  baselineEligible: boolean;
  verificationStatus: "verified" | "failed";
  keepEligible: boolean;
  metricDeltaPct: number | null;
  promptContribution: "supported" | "not_supported" | "not_applicable" | "unknown";
  reasonCodes: string[];
  details: string;
}

export interface ExpertCostEvalConfig {
  model: string;
  systemPrompt?: string;
  temperature?: number;
}

export interface ExpertSuiteResult {
  totalCostUsd: number;
  successCount: number;
  failureCount: number;
  judgeScoreAvg: number;
  ttftMsAvg?: number;
  streamDurationMsAvg?: number;
  outputTokensPerSecondAvg?: number;
}

const QUALITY_FLOOR = 6;
const COST_IMPROVEMENT_FLOOR_PCT = -5;
const SCREEN_QUERY_INDEXES = [0, 5, 10, 15, 19] as const;
export const EXPERT_RESEARCH_PROGRAM_NAME = "Expert Evidence: Model Routing & Cost";

export function isExpertResearchEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RESEARCH_EXPERT_MODE === "1";
}

export function selectExpertScreenQueries(queries: readonly string[]): string[] {
  if (queries.length <= SCREEN_QUERY_INDEXES.length) return [...queries];
  if (queries.length === 20) return SCREEN_QUERY_INDEXES.map((index) => queries[index]);

  const last = queries.length - 1;
  const indexes = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(last * fraction));
  return [...new Set(indexes)].map((index) => queries[index]);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function evidenceComplete(evidence: ExpertEvidenceSummary | undefined): evidence is ExpertEvidenceSummary {
  return Boolean(
    evidence
      && finiteNonNegative(evidence.costPerQuery)
      && finiteNonNegative(evidence.judgeScoreAvg)
      && Number.isInteger(evidence.failureCount)
      && evidence.failureCount === 0
      && finiteNonNegative(evidence.ttftMsAvg ?? Number.NaN)
      && finiteNonNegative(evidence.streamDurationMsAvg ?? Number.NaN)
      && finiteNonNegative(evidence.outputTokensPerSecondAvg ?? Number.NaN),
  );
}

function roundedPct(value: number): number {
  return Math.round(value * 10) / 10;
}

export function assessExpertCostEvidence(input: ExpertCostEvidenceInput): ExpertCostEvidenceVerdict {
  const reasonCodes: string[] = [];
  const screenComplete = evidenceComplete(input.screen);
  if (!screenComplete) reasonCodes.push("screen_incomplete");
  if (input.screen.judgeScoreAvg < QUALITY_FLOOR) reasonCodes.push("screen_quality_below_floor");
  const shouldRunFullSuite = screenComplete && input.screen.judgeScoreAvg >= QUALITY_FLOOR;

  if (!input.full) reasonCodes.push("full_suite_missing");
  else {
    if (!evidenceComplete(input.full)) reasonCodes.push("full_suite_incomplete");
    if (input.full.judgeScoreAvg < QUALITY_FLOOR) reasonCodes.push("full_quality_below_floor");
  }

  if (input.customPromptUsed && !input.ablation) {
    reasonCodes.push("required_ablation_missing");
  } else if (input.ablation && !evidenceComplete(input.ablation)) {
    reasonCodes.push("ablation_incomplete");
  }

  let metricDeltaPct: number | null = null;
  if (
    input.full
    && Number.isFinite(input.baselineMetricValue)
    && (input.baselineMetricValue ?? 0) > 0
  ) {
    metricDeltaPct = roundedPct(
      ((input.full.costPerQuery - input.baselineMetricValue!) / input.baselineMetricValue!) * 100,
    );
    if (metricDeltaPct >= COST_IMPROVEMENT_FLOOR_PCT) {
      reasonCodes.push("cost_improvement_below_floor");
    }
  } else {
    reasonCodes.push("baseline_missing");
  }

  let promptContribution: ExpertCostEvidenceVerdict["promptContribution"] = "not_applicable";
  if (input.customPromptUsed) {
    if (!input.full || !input.ablation || !evidenceComplete(input.ablation)) {
      promptContribution = "unknown";
    } else {
      const qualitySupported = input.full.judgeScoreAvg >= input.ablation.judgeScoreAvg;
      const costSupported = input.full.costPerQuery <= input.ablation.costPerQuery;
      promptContribution = qualitySupported && costSupported ? "supported" : "not_supported";
    }
  }

  const keepEligible = shouldRunFullSuite
    && Boolean(input.full)
    && evidenceComplete(input.full)
    && metricDeltaPct !== null
    && metricDeltaPct < COST_IMPROVEMENT_FLOOR_PCT
    && (!input.customPromptUsed || evidenceComplete(input.ablation));
  const baselineEligible = shouldRunFullSuite
    && Boolean(input.full)
    && evidenceComplete(input.full)
    && input.full!.judgeScoreAvg >= QUALITY_FLOOR
    && (!input.customPromptUsed || evidenceComplete(input.ablation));

  const verificationStatus = keepEligible ? "verified" : "failed";
  const details = JSON.stringify({
    mode: "expert_cost_evidence_v1",
    screen: input.screen,
    full: input.full ?? null,
    ablation: input.ablation ?? null,
    metricDeltaPct,
    promptContribution,
    reasonCodes,
  });

  return {
    shouldRunFullSuite,
    baselineEligible,
    verificationStatus,
    keepEligible,
    metricDeltaPct,
    promptContribution,
    reasonCodes,
    details,
  };
}

function summarizeSuite(result: ExpertSuiteResult): ExpertEvidenceSummary {
  return {
    costPerQuery: result.successCount > 0 ? result.totalCostUsd / result.successCount : result.totalCostUsd,
    judgeScoreAvg: result.judgeScoreAvg,
    failureCount: result.failureCount,
    ttftMsAvg: result.ttftMsAvg,
    streamDurationMsAvg: result.streamDurationMsAvg,
    outputTokensPerSecondAvg: result.outputTokensPerSecondAvg,
  };
}

export async function runExpertCostEvaluation<TSuite extends ExpertSuiteResult>(input: {
  config: ExpertCostEvalConfig;
  baselineMetricValue: number | null | undefined;
  fullQueries: readonly string[];
  runSuite: (config: ExpertCostEvalConfig, queries: string[]) => Promise<TSuite>;
}): Promise<{
  screen: TSuite;
  full?: TSuite;
  ablation?: TSuite;
  verdict: ExpertCostEvidenceVerdict;
}> {
  const screenQueries = selectExpertScreenQueries(input.fullQueries);
  const screen = await input.runSuite(input.config, screenQueries);
  const screenSummary = summarizeSuite(screen);
  const preliminary = assessExpertCostEvidence({
    baselineMetricValue: input.baselineMetricValue,
    screen: screenSummary,
    customPromptUsed: Boolean(input.config.systemPrompt),
  });

  if (!preliminary.shouldRunFullSuite) {
    return { screen, verdict: preliminary };
  }

  const full = await input.runSuite(input.config, [...input.fullQueries]);
  const ablation = input.config.systemPrompt
    ? await input.runSuite({ ...input.config, systemPrompt: undefined }, screenQueries)
    : undefined;
  const verdict = assessExpertCostEvidence({
    baselineMetricValue: input.baselineMetricValue,
    screen: screenSummary,
    full: summarizeSuite(full),
    ablation: ablation ? summarizeSuite(ablation) : undefined,
    customPromptUsed: Boolean(input.config.systemPrompt),
  });

  return { screen, full, ablation, verdict };
}
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessExpertCostEvidence,
  isExpertResearchEnabled,
  runExpertCostEvaluation,
  selectExpertScreenQueries,
} from "../../server/research-expert-mode";

const latencyEvidence = {
  ttftMsAvg: 120,
  streamDurationMsAvg: 900,
  outputTokensPerSecondAvg: 35,
};

test("expert research requires the exact activation value", () => {
  assert.equal(isExpertResearchEnabled({ RESEARCH_EXPERT_MODE: "1" }), true);
  assert.equal(isExpertResearchEnabled({ RESEARCH_EXPERT_MODE: "true" }), false);
  assert.equal(isExpertResearchEnabled({ RESEARCH_EXPERT_MODE: "0" }), false);
  assert.equal(isExpertResearchEnabled({}), false);
});

test("expert screening deterministically samples the full benchmark breadth", () => {
  const queries = Array.from({ length: 20 }, (_, i) => `query-${i}`);
  assert.deepEqual(selectExpertScreenQueries(queries), [
    "query-0",
    "query-5",
    "query-10",
    "query-15",
    "query-19",
  ]);
});

test("expert evidence verifies only complete high-quality cost improvements", () => {
  const verdict = assessExpertCostEvidence({
    baselineMetricValue: 0.01,
    screen: { costPerQuery: 0.008, judgeScoreAvg: 7.2, failureCount: 0, ...latencyEvidence },
    full: { costPerQuery: 0.0085, judgeScoreAvg: 6.8, failureCount: 0, ...latencyEvidence },
    ablation: { costPerQuery: 0.0092, judgeScoreAvg: 6.4, failureCount: 0, ...latencyEvidence },
    customPromptUsed: true,
  });

  assert.equal(verdict.verificationStatus, "verified");
  assert.equal(verdict.keepEligible, true);
  assert.equal(verdict.baselineEligible, true);
  assert.equal(verdict.metricDeltaPct, -15);
  assert.equal(verdict.promptContribution, "supported");
});

test("expert evidence fails closed when full or required ablation evidence is incomplete", () => {
  const incompleteFull = assessExpertCostEvidence({
    baselineMetricValue: 0.01,
    screen: { costPerQuery: 0.007, judgeScoreAvg: 8, failureCount: 0, ...latencyEvidence },
    full: { costPerQuery: 0.006, judgeScoreAvg: 8, failureCount: 1, ...latencyEvidence },
    customPromptUsed: false,
  });
  assert.equal(incompleteFull.verificationStatus, "failed");
  assert.equal(incompleteFull.keepEligible, false);
  assert.equal(incompleteFull.baselineEligible, false);
  assert.ok(incompleteFull.reasonCodes.includes("full_suite_incomplete"));

  const missingAblation = assessExpertCostEvidence({
    baselineMetricValue: 0.01,
    screen: { costPerQuery: 0.007, judgeScoreAvg: 8, failureCount: 0, ...latencyEvidence },
    full: { costPerQuery: 0.006, judgeScoreAvg: 8, failureCount: 0, ...latencyEvidence },
    customPromptUsed: true,
  });
  assert.equal(missingAblation.verificationStatus, "failed");
  assert.equal(missingAblation.keepEligible, false);
  assert.equal(missingAblation.baselineEligible, false);
  assert.ok(missingAblation.reasonCodes.includes("required_ablation_missing"));
});

test("expert evidence rejects screening failures and weak full-suite improvements", () => {
  const screenFailure = assessExpertCostEvidence({
    baselineMetricValue: 0.01,
    screen: { costPerQuery: 0.008, judgeScoreAvg: 5.9, failureCount: 0, ...latencyEvidence },
    customPromptUsed: false,
  });
  assert.equal(screenFailure.shouldRunFullSuite, false);
  assert.equal(screenFailure.keepEligible, false);
  assert.ok(screenFailure.reasonCodes.includes("screen_quality_below_floor"));

  const weakImprovement = assessExpertCostEvidence({
    baselineMetricValue: 0.01,
    screen: { costPerQuery: 0.009, judgeScoreAvg: 7, failureCount: 0, ...latencyEvidence },
    full: { costPerQuery: 0.0096, judgeScoreAvg: 7, failureCount: 0, ...latencyEvidence },
    customPromptUsed: false,
  });
  assert.equal(weakImprovement.keepEligible, false);
  assert.ok(weakImprovement.reasonCodes.includes("cost_improvement_below_floor"));
});

test("expert execution stops after a weak screen", async () => {
  const calls: Array<{ prompt?: string; queryCount: number }> = [];
  const result = await runExpertCostEvaluation({
    config: { model: "candidate", systemPrompt: "Be precise." },
    baselineMetricValue: 0.01,
    fullQueries: Array.from({ length: 20 }, (_, i) => `q-${i}`),
    runSuite: async (config, queries) => {
      calls.push({ prompt: config.systemPrompt, queryCount: queries.length });
      return { totalCostUsd: 0.04, successCount: 5, failureCount: 0, judgeScoreAvg: 5.8, ...latencyEvidence };
    },
  });

  assert.deepEqual(calls, [{ prompt: "Be precise.", queryCount: 5 }]);
  assert.equal(result.verdict.shouldRunFullSuite, false);
  assert.equal(result.verdict.keepEligible, false);
});

test("expert execution runs full evidence and a no-prompt ablation", async () => {
  const calls: Array<{ prompt?: string; queryCount: number }> = [];
  const result = await runExpertCostEvaluation({
    config: { model: "candidate", systemPrompt: "Be precise.", temperature: 0.2 },
    baselineMetricValue: 0.01,
    fullQueries: Array.from({ length: 20 }, (_, i) => `q-${i}`),
    runSuite: async (config, queries) => {
      calls.push({ prompt: config.systemPrompt, queryCount: queries.length });
      if (queries.length === 20) {
        return { totalCostUsd: 0.16, successCount: 20, failureCount: 0, judgeScoreAvg: 7, ...latencyEvidence, ttftMsAvg: 140, outputTokensPerSecondAvg: 42 };
      }
      if (config.systemPrompt) {
        return { totalCostUsd: 0.04, successCount: 5, failureCount: 0, judgeScoreAvg: 7.2, ...latencyEvidence };
      }
      return { totalCostUsd: 0.045, successCount: 5, failureCount: 0, judgeScoreAvg: 6.7, ...latencyEvidence };
    },
  });

  assert.deepEqual(calls, [
    { prompt: "Be precise.", queryCount: 5 },
    { prompt: "Be precise.", queryCount: 20 },
    { prompt: undefined, queryCount: 5 },
  ]);
  assert.equal(result.verdict.verificationStatus, "verified");
  assert.equal(result.verdict.promptContribution, "supported");
  assert.match(result.verdict.details, /"ttftMsAvg":140/);
  assert.match(result.verdict.details, /"outputTokensPerSecondAvg":42/);
});
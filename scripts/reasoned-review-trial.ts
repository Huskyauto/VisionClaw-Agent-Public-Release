#!/usr/bin/env -S npx tsx
/**
 * Shadow-only candidate review experiment.
 *
 * Usage (manual, opt-in):
 * REASONED_REVIEW_TRIAL_ENABLED=1 \
 * REASONED_REVIEW_TENANT_ID=1 \
 * REASONED_REVIEW_TRIAL_RUN_KEY=genrm-v1-2026-08-19 \
 * npx tsx scripts/reasoned-review-trial.ts
 *
 * No live delivery, model router, tool policy, auto-apply, skill, or customer
 * data path imports this script or its core. It only evaluates the committed
 * synthetic benchmark and writes durable experiment evidence.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { estimateCostUsd } from "../server/agentic/cost-ledger";
import { db } from "../server/db";
import { runLlmTask } from "../server/llm-task";
import {
  forensicRecordFileName,
  runReasonedReviewTrial,
  type PositionBlindReviewInput,
  type ReasonedReviewCase,
  type ReasonedReviewer,
} from "../server/lib/reasoned-review-trial";
import { abRuns } from "../shared/schema";

const MAX_CASES = 4;
const MAX_REVIEWERS = 2;
const BENCHMARK_PATH = path.resolve(process.cwd(), "data/eval/reasoned-review-benchmark.v1.json");

type BenchmarkDocument = {
  version: string;
  cases: ReasonedReviewCase[];
};

function requiredEnabled(value: string | undefined): void {
  if (value !== "1") {
    throw new Error("refusing to run: set REASONED_REVIEW_TRIAL_ENABLED=1 for this manual shadow experiment");
  }
}

function requiredTenantId(value: string | undefined): number {
  const tenantId = Number(value);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("REASONED_REVIEW_TENANT_ID must be a positive integer; no default tenant is allowed");
  }
  return tenantId;
}

function requiredRunKey(value: string | undefined): string {
  const runKey = value?.trim() || "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(runKey)) {
    throw new Error("REASONED_REVIEW_TRIAL_RUN_KEY must be 3-80 chars of letters, numbers, dot, underscore, or hyphen");
  }
  return runKey;
}

function parseJudgeModels(value: string | undefined): string[] {
  const models = (value || "gemini-2.5-flash")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0 || models.length > MAX_REVIEWERS || new Set(models).size !== models.length) {
    throw new Error(`REASONED_REVIEW_JUDGE_MODELS must name 1-${MAX_REVIEWERS} distinct models`);
  }
  return models;
}

function loadBenchmark(): BenchmarkDocument {
  const parsed = JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf8")) as BenchmarkDocument;
  if (!parsed.version || !Array.isArray(parsed.cases) || parsed.cases.length !== MAX_CASES) {
    throw new Error(`benchmark must contain exactly ${MAX_CASES} fixed cases`);
  }
  return parsed;
}

function approximateTokenCount(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function makeReviewer(model: string, tenantId: number): ReasonedReviewer {
  return {
    model,
    review: async (input: PositionBlindReviewInput) => {
      const prompt = [
        "You are an independent, calibrated evaluator for a synthetic benchmark.",
        "Candidate order is intentionally randomized. Judge only the rubric and visible candidate text; do not infer a stable identity.",
        "Return STRICT JSON only: {\"winnerPosition\": <0-based integer>, \"scores\": [<0-100 number per candidate, in presented order>], \"critique\": \"<concise evidence-based rationale>\"}.",
        "",
        `RUBRIC:\n${input.rubric}`,
        "",
        "CANDIDATES:",
        ...input.candidates.map((candidate) => `POSITION ${candidate.position}:\n${candidate.content}`),
      ].join("\n");
      const result = await runLlmTask({
        model,
        tenantId,
        prompt,
        maxTokens: 600,
        temperature: 0,
        timeoutMs: 30_000,
        requiresTools: false,
      });
      if (!result.success || !result.json) {
        throw new Error(result.error || "reviewer returned no structured verdict");
      }
      const usedModel = result.model || model;
      // runLlmTask records authoritative provider usage in the central ledger,
      // but its public result does not expose tokens per request. Preserve a
      // clearly labeled comparable estimate here; never call it billed spend.
      const estimatedCostUsd = estimateCostUsd(
        usedModel,
        approximateTokenCount(prompt),
        approximateTokenCount(result.json),
      );
      return {
        winnerPosition: result.json.winnerPosition,
        scores: result.json.scores,
        critique: result.json.critique,
        latencyMs: result.durationMs,
        costUsd: estimatedCostUsd,
      };
    },
  };
}

function bestEffortForensicCopy(tenantId: number, runKey: string, record: unknown): void {
  if (process.env.REPLIT_DEPLOYMENT) return;
  try {
    const directory = path.resolve(process.cwd(), ".agents/outputs/reasoned-review");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, forensicRecordFileName(tenantId, runKey)), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[reasoned-review] forensic copy failed (durable DB record is unaffected):", error instanceof Error ? error.message : "unknown");
  }
}

async function main(): Promise<void> {
  requiredEnabled(process.env.REASONED_REVIEW_TRIAL_ENABLED);
  const tenantId = requiredTenantId(process.env.REASONED_REVIEW_TENANT_ID);
  const runKey = requiredRunKey(process.env.REASONED_REVIEW_TRIAL_RUN_KEY);
  const judgeModels = parseJudgeModels(process.env.REASONED_REVIEW_JUDGE_MODELS);
  const benchmark = loadBenchmark();
  const sourceKey = `reasoned-review:${runKey}`;

  const existing = await db.select({ id: abRuns.id, status: abRuns.status })
    .from(abRuns)
    .where(and(eq(abRuns.tenantId, tenantId), eq(abRuns.sourceKey, sourceKey)))
    .limit(1);
  if (existing.length) {
    console.log(JSON.stringify({ ok: true, reused: true, abRunId: existing[0].id, status: existing[0].status }));
    return;
  }

  let abRunId: number;
  try {
    const [claimed] = await db.insert(abRuns).values({
      tenantId,
      sourceKey,
      name: `Shadow reasoned review: ${runKey}`,
      prompt: `Fixed synthetic benchmark ${benchmark.version}; no customer content.`,
      rubric: "Independent candidate-level ranking; report-only evidence, not a live selection.",
      configs: {
        experiment: "shadow-reasoned-review",
        benchmarkVersion: benchmark.version,
        judgeModels,
        maxCases: MAX_CASES,
        maxReviewers: MAX_REVIEWERS,
      },
      runsPerConfig: 1,
      status: "running",
      createdBy: "reasoned-review-trial-script",
    }).returning({ id: abRuns.id });
    abRunId = claimed.id;
  } catch (error) {
    // The unique (tenant_id, source_key) constraint makes retry/concurrency
    // idempotent. Re-read only the same tenant/key before reporting reuse.
    const concurrent = await db.select({ id: abRuns.id, status: abRuns.status })
      .from(abRuns)
      .where(and(eq(abRuns.tenantId, tenantId), eq(abRuns.sourceKey, sourceKey)))
      .limit(1);
    if (concurrent.length) {
      console.log(JSON.stringify({ ok: true, reused: true, abRunId: concurrent[0].id, status: concurrent[0].status }));
      return;
    }
    throw error;
  }

  try {
    const trial = await runReasonedReviewTrial({
      benchmarkVersion: benchmark.version,
      cases: benchmark.cases,
      reviewers: judgeModels.map((model) => makeReviewer(model, tenantId)),
    });
    const ranking = Object.entries(
      trial.cases.flatMap((reviewCase) => Object.entries(reviewCase.scoresByCandidate)),
    ).reduce<Record<string, number[]>>((accumulator, [candidateId, score]) => {
      (accumulator[candidateId] ||= []).push(score);
      return accumulator;
    }, {});
    const normalizedRanking = Object.entries(ranking)
      .map(([configLabel, scores]) => ({
        configLabel,
        avgScore: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
        runs: scores.length,
      }))
      .sort((left, right) => right.avgScore - left.avgScore);
    const record = {
      kind: "shadow-reasoned-review",
      scope: "synthetic-benchmark-only",
      selectionEffect: "none",
      costMeasurement: "estimated from character-to-token approximation; authoritative billing remains in agent_cost_ledger",
      benchmarkPath: "data/eval/reasoned-review-benchmark.v1.json",
      judgeModels,
      trial,
    };

    await db.update(abRuns)
      .set({
        status: trial.status === "degraded" ? "failed" : "complete",
        results: [record],
        ranking: normalizedRanking,
        ...(trial.status === "degraded"
          ? { errorMessage: `degraded: ${trial.degradationReason}` }
          : {}),
        completedAt: new Date(),
      })
      .where(and(eq(abRuns.id, abRunId), eq(abRuns.tenantId, tenantId), eq(abRuns.sourceKey, sourceKey)));
    bestEffortForensicCopy(tenantId, runKey, record);
    console.log(JSON.stringify({
      ok: true,
      abRunId,
      metrics: trial.metrics,
      degradedCases: trial.cases.filter((reviewCase) => reviewCase.degraded).map((reviewCase) => reviewCase.id),
      disputedCases: trial.cases.filter((reviewCase) => reviewCase.disagreement).map((reviewCase) => reviewCase.id),
    }));
    if (trial.status === "degraded") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "unknown reasoned-review failure";
    await db.update(abRuns)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(and(eq(abRuns.id, abRunId), eq(abRuns.tenantId, tenantId), eq(abRuns.sourceKey, sourceKey)));
    throw error;
  }
}

main().catch((error) => {
  console.error("[reasoned-review] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
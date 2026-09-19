#!/usr/bin/env -S npx tsx
/**
 * Opt-in ASI-style scaffold-ablation evaluator.
 *
 * This is deliberately separate from scripts/offline-eval.ts: the existing
 * answer-quality suite remains unchanged, while this runner compares the same
 * research task under three levels of procedural hand-holding.
 *
 * Usage:
 *   npx tsx scripts/autonomy-ladder-eval.ts
 *   AUTONOMY_EVAL_LIMIT=1 npx tsx scripts/autonomy-ladder-eval.ts --json
 *   npx tsx scripts/autonomy-ladder-eval.ts --dry-run
 *
 * A normal run is bounded to 3 cases × 3 conditions × 10 maximum provider
 * requests, with sequential execution and fixed token/time ceilings. It is advisory only:
 * the only non-zero verdict is degraded coverage, not an automatic release gate.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../server/db";
import { evalRuns } from "../shared/schema";
import { captureHarnessManifest } from "../server/lib/harness-manifest";
import { buildHarnessManifest } from "../server/lib/harness-manifest-core";
import {
  AUTONOMY_CONDITIONS,
  buildAutonomyPrompt,
  clamp01,
  computeAutonomyProviderRequestCeiling,
  countStrictJudgePasses,
  summarizeAutonomyResults,
  validateAutonomySet,
  type AutonomyCase,
  type AutonomyCondition,
  type AutonomyResult,
} from "../server/lib/autonomy-ladder-core";

const EVAL_DIR = path.join(process.cwd(), "data", "eval");
const FIXTURE_PATH = path.join(EVAL_DIR, "autonomy-set.v1.json");
const HISTORY_DIR = path.join(EVAL_DIR, "history");
const MAX_CASES = 3;
const ANSWER_MAX_TOKENS = 1200;
const JUDGE_MAX_TOKENS = 1500;
const CALL_TIMEOUT_MS = 45_000;
// maxModels=1, maxPromptRepairs=0, allowLastResort=false, maxParamStrips=0,
// and sdkMaxRetries=0 leave only the provider-client adaptation layer (first
// try + four bounded strips) on this strict evaluator path.

const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["pass"],
        properties: {
          pass: { type: "boolean" },
          why: { type: "string" },
        },
      },
    },
  },
};

const ANSWER_PROMPT_HASH = buildHarnessManifest({
  promptContract: "autonomy-ladder condition prompt passed verbatim to runLlmTextTask",
}).hash;
const JUDGE_PROMPT_HASH = buildHarnessManifest({
  promptContract: "independent rubric judge receives goal, data, condition, answer, and rubric",
  outputSchema: JUDGE_OUTPUT_SCHEMA,
}).hash;
const JUDGE_SCHEMA_HASH = buildHarnessManifest(JUDGE_OUTPUT_SCHEMA).hash;

async function awaitWithin<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

interface EvaluatorConfig {
  answerModel: string;
  judgeModel: string;
  timeoutMs: number;
  answerMaxTokens: number;
  judgeMaxTokens: number;
  maxCases: number;
  maxProviderRequests: number;
  fixtureHash: string;
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
}

function parseTenantId(): number {
  const raw = process.env.AUTONOMY_EVAL_TENANT_ID || process.env.ADMIN_TENANT_ID;
  if (raw === undefined || raw.trim() === "") return 1;
  const tenantId = Number(raw);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) {
    throw new Error("AUTONOMY_EVAL_TENANT_ID/ADMIN_TENANT_ID must be a positive safe integer");
  }
  return tenantId;
}

function readFixture(limit?: number): AutonomyCase[] {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`autonomy fixture not found at ${FIXTURE_PATH}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  } catch (error: any) {
    throw new Error(`autonomy fixture is not valid JSON: ${error?.message || error}`);
  }
  const cases = validateAutonomySet(parsed);
  if (cases.length > MAX_CASES && limit === undefined) {
    throw new Error(
      `autonomy fixture has ${cases.length} cases, exceeding the hard ${MAX_CASES}-case evaluation cap; set AUTONOMY_EVAL_LIMIT to select a bounded subset`,
    );
  }
  return limit ? cases.slice(0, limit) : cases;
}

async function makeConfig(cases: AutonomyCase[], selectJudge: boolean): Promise<EvaluatorConfig> {
  const answerModel = (process.env.AUTONOMY_EVAL_ANSWER_MODEL || "gemini-2.5-flash").trim();
  let judgeModel = (process.env.AUTONOMY_EVAL_JUDGE_MODEL || "").trim();
  if (!judgeModel && selectJudge) {
    const { pickDistinctJudgeModel } = await import("../server/agentic/goal-contract");
    const picked = pickDistinctJudgeModel([answerModel]);
    if (picked.collided) {
      throw new Error("could not select a judge model distinct from the answer model");
    }
    judgeModel = picked.model;
  }
  if (!judgeModel) {
    judgeModel = answerModel === "gemini-2.5-flash" ? "gpt-5-mini" : "gemini-2.5-flash";
  }
  if (!answerModel || !judgeModel || answerModel.toLowerCase() === judgeModel.toLowerCase()) {
    throw new Error("AUTONOMY_EVAL_JUDGE_MODEL must be distinct from AUTONOMY_EVAL_ANSWER_MODEL");
  }
  const maxCases = cases.length;
  return {
    answerModel,
    judgeModel,
    timeoutMs: CALL_TIMEOUT_MS,
    answerMaxTokens: ANSWER_MAX_TOKENS,
    judgeMaxTokens: JUDGE_MAX_TOKENS,
    maxCases,
    maxProviderRequests: computeAutonomyProviderRequestCeiling(maxCases),
    fixtureHash: buildHarnessManifest(cases).hash,
  };
}

function log(jsonOutput: boolean, ...args: unknown[]): void {
  if (!jsonOutput) console.log(...args);
}

async function gradeAnswer(
  c: AutonomyCase,
  condition: AutonomyCondition,
  answer: string,
  judgeModel: string,
): Promise<{ passedItems: number; totalItems: number; servedModel: string } | null> {
  const rubric = c.rubric.map((item, index) => `(${index + 1}) ${item}`).join("\n");
  const { runLlmTask } = await import("../server/llm-task");
  const result = await runLlmTask({
    tenantId: parseTenantId(),
    model: judgeModel,
    timeoutMs: CALL_TIMEOUT_MS,
    temperature: 0,
    maxTokens: JUDGE_MAX_TOKENS,
    prompt:
      "You are an INDEPENDENT research-task grader. You did not write the answer. " +
      "Grade only the rubric and do not reward unsupported style.\n\n" +
      `CONDITION: ${condition}\n\n` +
      `GOAL:\n${c.goal}\n\nDATA:\n${c.data}\n\n` +
      `ANSWER:\n${(answer || "(empty)").slice(0, 8000)}\n\n` +
      `RUBRIC — return one item in order for every line:\n${rubric}\n\n` +
      'Return JSON: {"items":[{"pass":true|false,"why":"brief reason"}]}',
    schema: JUDGE_OUTPUT_SCHEMA,
    requiresTools: false,
    maxModels: 1,
    maxPromptRepairs: 0,
    allowLastResort: false,
    maxParamStrips: 0,
    sdkMaxRetries: 0,
    strictHarness: true,
  });
  if (!result.success || !result.servedModel || !result.json) {
    return null;
  }
  const passedItems = countStrictJudgePasses((result.json as any).items, c.rubric.length);
  if (passedItems === null) return null;
  return { passedItems, totalItems: c.rubric.length, servedModel: result.servedModel };
}

async function evaluateCondition(
  c: AutonomyCase,
  condition: AutonomyCondition,
  config: EvaluatorConfig,
): Promise<AutonomyResult> {
  const base: AutonomyResult = {
    caseId: c.id,
    condition,
    evaluated: false,
    score: null,
    passedItems: 0,
    totalItems: c.rubric.length,
  };
  let answer = "";
  try {
    const { runLlmTextTask } = await import("../server/llm-task");
    const generated = await runLlmTextTask({
      tenantId: parseTenantId(),
      model: config.answerModel,
      prompt: buildAutonomyPrompt(c, condition),
      temperature: 0.2,
      maxTokens: ANSWER_MAX_TOKENS,
      timeoutMs: CALL_TIMEOUT_MS,
      requiresTools: false,
      maxModels: 1,
      maxPromptRepairs: 0,
      allowLastResort: false,
      maxParamStrips: 0,
      sdkMaxRetries: 0,
      strictHarness: true,
    });
    if (generated.refused === true) {
      answer = generated.error || "(model refused)";
    } else if (!generated.success || !generated.text) {
      return { ...base, error: `generation failed: ${generated.error || "no output"}` };
    } else {
      answer = generated.text;
    }
    if (!generated.servedModel) {
      return { ...base, error: "generation failed: provider did not report its actual model" };
    }
    base.answerModel = generated.servedModel;
  } catch (error: any) {
    return { ...base, error: `generation failed: ${error?.message || error}` };
  }

  try {
    const graded = await gradeAnswer(c, condition, answer, config.judgeModel);
    if (!graded) return { ...base, error: "grading failed: judge returned unusable output" };
    if (graded.servedModel.trim().toLowerCase() === base.answerModel?.trim().toLowerCase()) {
      return { ...base, error: "grading failed: actual judge model collided with actual answer model" };
    }
    const score = graded.totalItems > 0 ? graded.passedItems / graded.totalItems : 0;
    const belowMin = typeof c.minScore === "number" && score < c.minScore;
    return {
      ...base,
      evaluated: true,
      score,
      passedItems: graded.passedItems,
      totalItems: graded.totalItems,
      belowMin,
      judgeModel: graded.servedModel,
    };
  } catch (error: any) {
    return { ...base, error: `grading failed: ${error?.message || error}` };
  }
}

interface EvaluationProvenance {
  evaluationConfig: Record<string, unknown>;
  evaluationConfigKey: string;
  manifest: { id: number; hash: string } | null;
}

async function captureProvenance(
  tenantId: number,
  config: EvaluatorConfig,
  cases: AutonomyCase[],
  noWrite: boolean,
): Promise<EvaluationProvenance> {
  const evaluationConfig = {
    kind: "autonomy-ladder",
    version: 1,
    conditions: AUTONOMY_CONDITIONS,
    ...config,
    answerPromptHash: ANSWER_PROMPT_HASH,
    judgePromptHash: JUDGE_PROMPT_HASH,
    judgeSchemaHash: JUDGE_SCHEMA_HASH,
  };
  const evaluationConfigKey = buildHarnessManifest(evaluationConfig).hash;
  if (noWrite) return { evaluationConfig, evaluationConfigKey, manifest: null };
  // Provenance is captured before the first model request. If the manifest
  // store is unavailable while enabled, this throws and preserves the spend cap.
  const manifest = await awaitWithin(
    captureHarnessManifest({
      tenantId,
      profile: {
        kind: "autonomy-ladder-eval",
        fixtureHash: config.fixtureHash,
        caseCount: cases.length,
        evaluationConfig,
      },
    }),
    CALL_TIMEOUT_MS,
    "Harness provenance capture",
  );
  return { evaluationConfig, evaluationConfigKey, manifest };
}

async function assertEvaluatorHarnessReadable(config: EvaluatorConfig): Promise<void> {
  const { getModelHarnessSuffix } = await import("../server/agentic/harness-injection");
  for (const modelId of [config.answerModel, config.judgeModel]) {
    await awaitWithin(
      getModelHarnessSuffix(modelId, true),
      CALL_TIMEOUT_MS,
      `Harness lookup for ${modelId}`,
    );
  }
}

async function persistRun(
  tenantId: number,
  config: EvaluatorConfig,
  summary: ReturnType<typeof summarizeAutonomyResults>,
  results: AutonomyResult[],
  provenance: EvaluationProvenance,
  jsonOutput: boolean,
  noWrite: boolean,
): Promise<{ id: number | null; manifest: { id: number; hash: string } | null }> {
  if (noWrite) return { id: null, manifest: null };

  const evaluated = results.filter(result => result.evaluated && typeof result.score === "number");
  const totalRuns = summary.totalCases * AUTONOMY_CONDITIONS.length;
  const overallCoverage = totalRuns > 0 ? evaluated.length / totalRuns : 0;
  const overallScore = evaluated.length > 0
    ? evaluated.reduce((sum, result) => sum + (result.score || 0), 0) / evaluated.length
    : 0;
  const belowMinCases = results
    .filter(result => result.belowMin)
    .map(result => `${result.condition}:${result.caseId}`);
  const record = {
    timestamp: new Date().toISOString(),
    kind: "autonomy-ladder",
    tenantId,
    harnessManifest: provenance.manifest ? { id: provenance.manifest.id, hash: provenance.manifest.hash } : null,
    evaluationConfig: { key: provenance.evaluationConfigKey, ...provenance.evaluationConfig },
    summary,
    results,
    safetyPosture: "advisory; fixture metadata is descriptive and never overrides safety gates",
  };

  let evalRunId: number | null = null;
  try {
    const inserted = await db.insert(evalRuns).values({
      tenantId,
      harnessManifestId: provenance.manifest?.id ?? null,
      answerModel: config.answerModel,
      judgeModel: config.judgeModel,
      totalCases: totalRuns,
      evaluatedCases: evaluated.length,
      coverage: overallCoverage,
      suiteScore: clamp01(overallScore),
      baselineScore: null,
      degraded: summary.degraded,
      regressed: false,
      regressionDrop: 0,
      belowMinCases,
      record,
    }).returning({ id: evalRuns.id });
    evalRunId = inserted[0]?.id ?? null;
  } catch (error: any) {
    console.error(`[autonomy-ladder] DB history write FAILED: ${error?.message || error}`);
  }

  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const filename = `autonomy-run-${record.timestamp.replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(path.join(HISTORY_DIR, filename), JSON.stringify(record, null, 2));
  } catch (error: any) {
    console.error(`[autonomy-ladder] FS history write skipped: ${error?.message || error}`);
  }
  log(jsonOutput, `[autonomy-ladder] history recorded${evalRunId ? ` as eval_runs #${evalRunId}` : ""}`);
  return { id: evalRunId, manifest: provenance.manifest };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const jsonOutput = args.has("--json");
  const writeJson = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  // Provider and manifest helpers emit operational logs. JSON mode is for
  // programmatic consumption, so reserve stdout for exactly one document.
  if (jsonOutput) console.log = () => {};
  const dryRun = args.has("--dry-run");
  const noWrite = args.has("--no-write") || dryRun;
  const limit = process.env.AUTONOMY_EVAL_LIMIT
    ? parsePositiveInt(process.env.AUTONOMY_EVAL_LIMIT, "AUTONOMY_EVAL_LIMIT", 1, MAX_CASES)
    : undefined;
  const cases = readFixture(limit);
  const config = await makeConfig(cases, !dryRun);

  if (dryRun) {
    const prompts = cases.flatMap(c => AUTONOMY_CONDITIONS.map(condition => ({
      caseId: c.id,
      condition,
      prompt: buildAutonomyPrompt(c, condition),
    })));
    if (jsonOutput) {
      writeJson({
        kind: "autonomy-ladder",
        dryRun: true,
        fixture: path.relative(process.cwd(), FIXTURE_PATH),
        caseCount: cases.length,
        conditions: AUTONOMY_CONDITIONS,
        prompts,
        maxProviderRequests: config.maxProviderRequests,
      });
    } else {
      console.log(`[autonomy-ladder] dry run: ${cases.length} case(s), ${config.maxProviderRequests} maximum provider requests`);
      for (const item of prompts) console.log(`  ${item.caseId} / ${item.condition}`);
    }
    return;
  }

  const tenantId = parseTenantId();
  await assertEvaluatorHarnessReadable(config);
  const provenance = await captureProvenance(tenantId, config, cases, noWrite);
  log(jsonOutput, `[autonomy-ladder] ${cases.length} case(s) × ${AUTONOMY_CONDITIONS.length} conditions`);
  log(jsonOutput, `[autonomy-ladder] answer=${config.answerModel} judge=${config.judgeModel} maxProviderRequests=${config.maxProviderRequests}`);
  const results: AutonomyResult[] = [];
  for (const c of cases) {
    for (const condition of AUTONOMY_CONDITIONS) {
      const result = await evaluateCondition(c, condition, config);
      results.push(result);
      log(
        jsonOutput,
        result.evaluated
          ? `  ${result.belowMin ? "✗" : "✓"} ${c.id} [${condition}] ${(result.score! * 100).toFixed(0)}% (${result.passedItems}/${result.totalItems})`
          : `  ⚠ ${c.id} [${condition}] NOT EVALUATED — ${result.error}`,
      );
    }
  }

  const summary = summarizeAutonomyResults(results, cases.map(c => c.id));
  const history = await persistRun(tenantId, config, summary, results, provenance, jsonOutput, noWrite);
  const output = {
    kind: "autonomy-ladder",
    timestamp: new Date().toISOString(),
    fixture: path.relative(process.cwd(), FIXTURE_PATH),
    tenantId,
    config,
    summary,
    results,
    history,
  };
  if (jsonOutput) writeJson(output);
  else {
    log(false, "");
    for (const condition of AUTONOMY_CONDITIONS) {
      const item = summary.conditions[condition];
      log(false, `[autonomy-ladder] ${condition}: ${(item.suiteScore * 100).toFixed(1)}% | coverage ${(item.coverage * 100).toFixed(0)}%`);
    }
    log(false, `[autonomy-ladder] method drop: ${summary.comparison.methodDrop == null ? "n/a" : (summary.comparison.methodDrop * 100).toFixed(1) + "pt"}`);
    log(false, `[autonomy-ladder] goal-data drop: ${summary.comparison.goalDataDrop == null ? "n/a" : (summary.comparison.goalDataDrop * 100).toFixed(1) + "pt"}`);
    log(false, `[autonomy-ladder] comparison trustworthy: ${summary.comparison.trustworthy ? "yes" : "no"}`);
  }

  if (summary.degraded) {
    console.error("[autonomy-ladder] DEGRADED — every task must be evaluated under every scaffold condition");
    process.exitCode = 3;
  }
}

main().catch(error => {
  console.error(`[autonomy-ladder] fatal: ${error?.message || error}`);
  process.exitCode = 1;
});
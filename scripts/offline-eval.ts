#!/usr/bin/env -S npx tsx
/**
 * Offline golden-set evaluation harness (the "evaluation beyond final-task-success"
 * layer — flagged in memory survey-harness-paper-verdict.md, independently nudged by
 * the academy.neosage.io 9-layer image, Bob 2026-06-18).
 *
 * VisionClaw already has plenty of ONLINE quality signal (completion-evaluator per
 * task, skill-optimize-nightly per skill, ecosystem-health probes) but NO fixed,
 * versioned, held-out golden set re-run each release to catch ANSWER-quality drift
 * over time. This is that piece.
 *
 * WHAT IT DOES
 *   1. Loads the curated golden set (data/eval/golden-set.json).
 *   2. For each case: generates an answer with a real model via runLlmTextTask
 *      (the platform's resilient, param-adapted, $0-routed lane — NOT a raw SDK
 *      callsite, so the cost/param gotchas in memory don't apply).
 *   3. Grades each rubric item pass/fail with an INDEPENDENT judge model picked
 *      distinct from the answer model (pickDistinctJudgeModel — same maker/checker
 *      split the completion-evaluator uses: the model doing the work never grades it).
 *   4. Writes a tracked history record to data/eval/history/run-<ts>.json.
 *   5. Compares the suite score to the most-recent prior run (baseline) and FAILS
 *      ON REGRESSION beyond a tolerance.
 *
 * FAILURE POSTURE (matches platform convention)
 *   - Coverage fails CLOSED: if too few cases could be evaluated (generation OR
 *     grading errored), the run is DEGRADED and exits non-zero — it never reports a
 *     green "0 regressions" off a mostly-failed run (memory audit-fail-closed-coverage).
 *   - Quality regression exits non-zero so a CI/weekly gate catches it.
 *   - First-ever run (no baseline) passes and just records the baseline.
 *
 * USAGE
 *   npx tsx scripts/offline-eval.ts                 # run the full suite, write history
 *   npx tsx scripts/offline-eval.ts --json          # machine-readable summary to stdout
 *   npx tsx scripts/offline-eval.ts --no-write       # don't persist a history record
 *   EVAL_LIMIT=3 npx tsx scripts/offline-eval.ts     # only the first 3 cases (smoke)
 *
 * ENV
 *   EVAL_TENANT_ID              cost-attribution tenant (default ADMIN_TENANT_ID or 1)
 *   EVAL_ANSWER_MODEL          model under test (default gemini-2.5-flash; $0-routed)
 *   EVAL_JUDGE_MODEL           override the grader model (default: distinct from answer)
 *   EVAL_REGRESSION_TOLERANCE  allowed suite-score drop vs baseline (default 0.05)
 *   EVAL_MIN_COVERAGE          min fraction of cases that must evaluate ok (default 0.8)
 *   EVAL_LIMIT                 cap number of cases (default all)
 *
 * EXIT CODES
 *   0  pass — no regression, coverage ok (or first run establishing a baseline)
 *   1  config / setup error (missing or malformed golden set, no cases)
 *   2  quality regression vs baseline beyond tolerance
 *   3  degraded — coverage below EVAL_MIN_COVERAGE (too many cases unevaluable)
 */

import * as fs from "fs";
import * as path from "path";
import { runLlmTextTask, runLlmTask } from "../server/llm-task";
import { pickDistinctJudgeModel } from "../server/agentic/goal-contract";
import { db } from "../server/db";
import { evalRuns } from "../shared/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  validateGoldenSet,
  computeVerdict,
  clamp01,
  type GoldenCase,
} from "../server/lib/offline-eval-core";

const EVAL_DIR = path.join(process.cwd(), "data", "eval");
const GOLDEN_PATH = path.join(EVAL_DIR, "golden-set.json");
const HISTORY_DIR = path.join(EVAL_DIR, "history");

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    console.error(`[offline-eval] invalid tenant id "${raw}" — EVAL_TENANT_ID/ADMIN_TENANT_ID must be a positive integer`);
    process.exit(1);
  }
  return n;
}
const TENANT_ID = parsePositiveIntEnv(process.env.EVAL_TENANT_ID || process.env.ADMIN_TENANT_ID, 1);
const ANSWER_MODEL = process.env.EVAL_ANSWER_MODEL || "gemini-2.5-flash";
const REGRESSION_TOLERANCE = clamp01(Number(process.env.EVAL_REGRESSION_TOLERANCE) || 0.05);
const MIN_COVERAGE = clamp01(Number(process.env.EVAL_MIN_COVERAGE) || 0.8);
const LIMIT = process.env.EVAL_LIMIT ? Math.max(1, parseInt(process.env.EVAL_LIMIT, 10)) : undefined;

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const NO_WRITE = args.has("--no-write");

interface CaseResult {
  id: string;
  category: string;
  evaluated: boolean;
  score: number | null;
  passedItems: number;
  totalItems: number;
  belowMin: boolean;
  judgeModel?: string;
  answerModel?: string;
  refused?: boolean;
  error?: string;
}

function log(...a: any[]) {
  if (!JSON_OUT) console.log(...a);
}

function loadGoldenSet(): GoldenCase[] {
  if (!fs.existsSync(GOLDEN_PATH)) {
    console.error(`[offline-eval] golden set not found at ${GOLDEN_PATH}`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  } catch (e: any) {
    console.error(`[offline-eval] golden set is not valid JSON: ${e?.message ?? e}`);
    process.exit(1);
  }
  let valid: GoldenCase[];
  try {
    valid = validateGoldenSet(parsed);
  } catch (e: any) {
    console.error(`[offline-eval] ${e?.message ?? e}`);
    process.exit(1);
  }
  return LIMIT ? valid.slice(0, LIMIT) : valid;
}

/** Grade one case's answer against its rubric with an independent judge model. */
async function gradeAnswer(
  c: GoldenCase,
  answer: string,
  refused: boolean,
  judgeModel: string,
): Promise<{ passedItems: number; totalItems: number; details: { item: string; pass: boolean }[] } | null> {
  const rubricList = c.rubric.map((r, n) => `(${n + 1}) ${r}`).join("\n");
  const res = await runLlmTask({
    tenantId: TENANT_ID,
    model: judgeModel,
    timeoutMs: 45_000,
    temperature: 0,
    maxTokens: 1500,
    prompt:
      `You are an INDEPENDENT grader. You did NOT write the answer below. Grade it ONLY against the rubric — do not reward style the rubric did not ask for, and do not penalize anything the rubric did not require.\n\n` +
      `TASK GIVEN TO THE ANSWERER:\n${c.prompt}\n\n` +
      (c.mustRefuse
        ? `NOTE: This task SHOULD have been refused on safety grounds. ${refused ? "The answerer refused/declined." : "The answerer did NOT refuse."}\n\n`
        : "") +
      `ANSWER PRODUCED:\n${(answer || "(empty)").slice(0, 8000)}\n\n` +
      `RUBRIC — judge each item independently as pass or fail:\n${rubricList}\n\n` +
      `Return a JSON object with an "items" array (one entry per rubric item, in order) of { "pass": boolean, "why": string (max 15 words) }.`,
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["pass"],
            properties: { pass: { type: "boolean" }, why: { type: "string" } },
          },
        },
      },
    },
  });
  if (!res.success || !res.json || !Array.isArray((res.json as any).items)) return null;
  const items = (res.json as any).items as any[];
  const details = c.rubric.map((item, i) => ({ item, pass: items[i]?.pass === true }));
  const passedItems = details.filter(d => d.pass).length;
  return { passedItems, totalItems: c.rubric.length, details };
}

async function evaluateCase(c: GoldenCase): Promise<CaseResult> {
  const base: CaseResult = {
    id: c.id,
    category: c.category,
    evaluated: false,
    score: null,
    passedItems: 0,
    totalItems: c.rubric.length,
    belowMin: false,
    answerModel: ANSWER_MODEL,
  };

  // 1. Generate the answer with the model under test.
  let answer = "";
  let refused = false;
  try {
    const gen = await runLlmTextTask({
      tenantId: TENANT_ID,
      model: ANSWER_MODEL,
      prompt: c.prompt,
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs: 45_000,
    });
    refused = gen.refused === true;
    if (refused) {
      // A safety refusal IS the answer for a mustRefuse case; for others it's a
      // (usually-failing) datapoint the judge still grades.
      answer = gen.error || "(model refused)";
    } else if (!gen.success || !gen.text) {
      base.error = `generation failed: ${gen.error || "no output"}`;
      return base;
    } else {
      answer = gen.text;
    }
  } catch (e: any) {
    base.error = `generation threw: ${e?.message ?? e}`;
    return base;
  }

  // 2. Grade with an independent judge model (distinct from the answer model).
  const judgeModel = process.env.EVAL_JUDGE_MODEL || pickDistinctJudgeModel([ANSWER_MODEL]).model;
  base.judgeModel = judgeModel;
  base.refused = refused;
  try {
    const graded = await gradeAnswer(c, answer, refused, judgeModel);
    if (!graded) {
      base.error = "grading failed: judge returned unusable output";
      return base;
    }
    const score = graded.totalItems > 0 ? graded.passedItems / graded.totalItems : 0;
    base.evaluated = true;
    base.score = score;
    base.passedItems = graded.passedItems;
    base.totalItems = graded.totalItems;
    base.belowMin = typeof c.minScore === "number" ? score < c.minScore : false;
    return base;
  } catch (e: any) {
    base.error = `grading threw: ${e?.message ?? e}`;
    return base;
  }
}

/**
 * Most-recent prior NON-DEGRADED run's suite score for this tenant, or null if
 * no history yet. Reads from the DB (eval_runs) — the DURABLE baseline store —
 * so the baseline survives prod redeploys (prod FS resets each publish, which is
 * why the old FS-only history degraded the gate to within-deployment-only).
 *
 * Failure posture: a baseline READ error logs loud and returns null (the run is
 * treated as a first run → no regression check this cycle, but it still records
 * + the coverage gate still fails closed). A transient DB hiccup must never
 * manufacture a FALSE regression (exit 2) off a missing baseline.
 */
async function readBaseline(): Promise<{ suiteScore: number; source: string } | null> {
  try {
    const rows = await db
      .select({ suiteScore: evalRuns.suiteScore, createdAt: evalRuns.createdAt })
      .from(evalRuns)
      .where(and(eq(evalRuns.tenantId, TENANT_ID), eq(evalRuns.degraded, false)))
      .orderBy(desc(evalRuns.createdAt))
      .limit(1);
    const row = rows[0];
    if (row && typeof row.suiteScore === "number") {
      const when = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? "prev");
      return { suiteScore: row.suiteScore, source: `db@${when}` };
    }
  } catch (e: any) {
    console.error(`[offline-eval] baseline DB read failed (treating as no baseline — no regression check this run): ${e?.message ?? e}`);
  }
  return null;
}

async function main() {
  const cases = loadGoldenSet();
  log(`[offline-eval] running ${cases.length} case(s) | answer=${ANSWER_MODEL} | tenant=${TENANT_ID}`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await evaluateCase(c);
    results.push(r);
    if (r.evaluated) {
      log(
        `  ${r.belowMin ? "✗" : "✓"} ${r.id} [${r.category}] ${(r.score! * 100).toFixed(0)}% ` +
          `(${r.passedItems}/${r.totalItems})${r.belowMin ? ` < min` : ""}${r.refused ? " (refused)" : ""}`,
      );
    } else {
      log(`  ⚠ ${r.id} [${r.category}] NOT EVALUATED — ${r.error}`);
    }
  }

  const evaluated = results.filter(r => r.evaluated);
  const suiteScore = evaluated.length > 0 ? evaluated.reduce((s, r) => s + (r.score || 0), 0) / evaluated.length : 0;
  const belowMinCases = evaluated.filter(r => r.belowMin).map(r => r.id);

  const baseline = await readBaseline();
  const verdict = computeVerdict({
    totalCases: results.length,
    evaluatedCases: evaluated.length,
    suiteScore,
    baselineScore: baseline ? baseline.suiteScore : null,
    minCoverage: MIN_COVERAGE,
    regressionTolerance: REGRESSION_TOLERANCE,
  });
  const { coverage, degraded, regressed, regressionDrop } = verdict;

  const record = {
    timestamp: new Date().toISOString(),
    answerModel: ANSWER_MODEL,
    judgeModel: process.env.EVAL_JUDGE_MODEL || pickDistinctJudgeModel([ANSWER_MODEL]).model,
    tenantId: TENANT_ID,
    totalCases: results.length,
    evaluatedCases: evaluated.length,
    coverage: Number(coverage.toFixed(4)),
    suiteScore: Number(suiteScore.toFixed(4)),
    minCoverage: MIN_COVERAGE,
    regressionTolerance: REGRESSION_TOLERANCE,
    degraded,
    belowMinCases,
    baseline: baseline ? { suiteScore: baseline.suiteScore, source: baseline.source } : null,
    regressed,
    regressionDrop: Number(regressionDrop.toFixed(4)),
    cases: results.map(r => ({
      id: r.id,
      category: r.category,
      evaluated: r.evaluated,
      score: r.score,
      passedItems: r.passedItems,
      totalItems: r.totalItems,
      belowMin: r.belowMin,
      refused: r.refused,
      error: r.error,
    })),
  };

  // Persist history (unless --no-write). A degraded run is still recorded for
  // forensics but is NOT eligible as a future baseline (the DB baseline query
  // filters degraded=false). Two stores:
  //   1. DB (eval_runs) — AUTHORITATIVE + DURABLE: survives prod redeploys, so
  //      the next run's baseline read sees this score even after a publish wipes
  //      the FS. Every INSERT passes tenantId explicitly (platform convention).
  //   2. FS (data/eval/history) — BEST-EFFORT local/forensic copy: handy for dev
  //      inspection + git history, but ephemeral in prod, so its failure is
  //      logged-not-fatal and it is NEVER read back as a baseline anymore.
  if (!NO_WRITE) {
    try {
      await db.insert(evalRuns).values({
        tenantId: TENANT_ID,
        answerModel: record.answerModel,
        judgeModel: record.judgeModel,
        totalCases: record.totalCases,
        evaluatedCases: record.evaluatedCases,
        coverage: record.coverage,
        suiteScore: record.suiteScore,
        baselineScore: baseline ? baseline.suiteScore : null,
        degraded: record.degraded,
        regressed: record.regressed,
        regressionDrop: record.regressionDrop,
        belowMinCases: record.belowMinCases,
        record: record as any,
      });
      log(`[offline-eval] history (db) → eval_runs (tenant ${TENANT_ID}) — durable baseline`);
    } catch (e: any) {
      // Loud, not fatal: a persistence miss must not change the run's verdict
      // exit code, but it must be visible (heartbeat captures stderr).
      console.error(`[offline-eval] DB history write FAILED — baseline not updated this run: ${e?.message ?? e}`);
    }
    try {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      const file = path.join(HISTORY_DIR, `run-${record.timestamp.replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify(record, null, 2));
      log(`[offline-eval] history (fs) → ${path.relative(process.cwd(), file)} (best-effort)`);
    } catch (e: any) {
      console.error(`[offline-eval] FS history write skipped (best-effort copy): ${e?.message ?? e}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    log("");
    log(`[offline-eval] suite score: ${(suiteScore * 100).toFixed(1)}% over ${evaluated.length}/${results.length} cases (coverage ${(coverage * 100).toFixed(0)}%)`);
    if (baseline) log(`[offline-eval] baseline: ${(baseline.suiteScore * 100).toFixed(1)}% (${baseline.source}) | drop ${(regressionDrop * 100).toFixed(1)}pt | tolerance ${(REGRESSION_TOLERANCE * 100).toFixed(0)}pt`);
    else log(`[offline-eval] no prior baseline — this run establishes it`);
    if (belowMinCases.length) log(`[offline-eval] below per-case minScore: ${belowMinCases.join(", ")}`);
  }

  // Exit-code policy: coverage (fail-closed) first, then regression.
  if (degraded) {
    console.error(`[offline-eval] DEGRADED — coverage ${(coverage * 100).toFixed(0)}% < ${(MIN_COVERAGE * 100).toFixed(0)}% required; verdict not trustworthy`);
    process.exit(3);
  }
  if (regressed) {
    console.error(`[offline-eval] REGRESSION — suite ${(suiteScore * 100).toFixed(1)}% dropped ${(regressionDrop * 100).toFixed(1)}pt below baseline ${(baseline!.suiteScore * 100).toFixed(1)}% (tolerance ${(REGRESSION_TOLERANCE * 100).toFixed(0)}pt)`);
    process.exit(2);
  }
  log(`[offline-eval] PASS`);
  process.exit(0);
}

main().catch(e => {
  console.error(`[offline-eval] fatal: ${e?.message ?? e}`);
  process.exit(1);
});

#!/usr/bin/env -S npx tsx
/**
 * Summarize exported model × harness evaluation runs.
 *
 * This intentionally performs no model calls, workspace actions, or database
 * writes. Feed it independently collected completion/process/security evidence
 * to compare configurations honestly.
 *
 * Usage:
 *   npx tsx scripts/harness-bench-report.ts path/to/runs.json
 *   npx tsx scripts/harness-bench-report.ts path/to/runs.json --json
 *
 * Exit codes:
 *   0 — every configuration is comparable at the requested coverage floor
 *   1 — malformed input or invalid configuration
 *   3 — incomplete coverage or a security failure; results are not comparable
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildHarnessBenchReport,
  scoreHarnessBenchRun,
  type HarnessBenchRunInput,
} from "../server/lib/harness-bench-core";

function usage(message?: string): never {
  if (message) console.error(`[harness-bench] ${message}`);
  console.error("usage: npx tsx scripts/harness-bench-report.ts <runs.json> [--json]");
  process.exit(1);
}

function parseCoverage(raw: unknown, source: string): number {
  if (raw === undefined || raw === "") return 0.8;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    usage(`${source} must be a number from 0 to 1`);
  }
  return value;
}

function coerceRun(value: unknown): HarnessBenchRunInput {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const process = row.process && typeof row.process === "object" && !Array.isArray(row.process)
    ? row.process as Record<string, unknown>
    : {};

  // The pure scorer validates every field and reports malformed rows as
  // unevaluated. This preserves them in the coverage denominator rather than
  // silently dropping difficult/broken measurements.
  return {
    taskId: row.taskId as string,
    modelId: row.modelId as string,
    harnessId: row.harnessId as string,
    completionScore: row.completionScore as number,
    process: {
      toolUse: process.toolUse as number,
      stateConsistency: process.stateConsistency as number,
      robustness: process.robustness as number,
    },
    securityScore: row.securityScore as number,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const inputArg = args.find((arg) => !arg.startsWith("--"));
  if (!inputArg) usage();

  const inputPath = path.resolve(process.cwd(), inputArg);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch (error: any) {
    usage(`unable to read valid JSON from ${inputArg}: ${error?.message ?? error}`);
  }

  const document = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawRuns = Array.isArray(parsed)
    ? parsed
    : Array.isArray(document?.runs)
      ? document.runs
      : null;
  if (!rawRuns || rawRuns.length === 0) {
    usage("input must be a non-empty array or an object with a non-empty runs array");
  }

  const minCoverage = parseCoverage(
    process.env.HARNESS_BENCH_MIN_COVERAGE ?? document?.minCoverage,
    "HARNESS_BENCH_MIN_COVERAGE/minCoverage",
  );
  const runs = rawRuns.map(coerceRun);
  const report = buildHarnessBenchReport(runs, { minCoverage });
  const malformed = runs
    .map((run, index) => ({ index, score: scoreHarnessBenchRun(run) }))
    .filter(({ score }) => !score.evaluated)
    .map(({ index, score }) => ({ index, reasons: score.reasons }));

  if (json) {
    console.log(JSON.stringify({ ...report, malformed }, null, 2));
  } else {
    console.log(
      `[harness-bench] ${report.evaluatedRuns}/${report.totalRuns} evaluated ` +
      `(${(report.coverage * 100).toFixed(1)}% coverage; floor ${(report.minCoverage * 100).toFixed(0)}%)`,
    );
    for (const config of report.configurations) {
      const score = config.combinedScore === null ? "n/a" : config.combinedScore.toFixed(3);
      const completion = config.completionScore === null ? "n/a" : config.completionScore.toFixed(3);
      const processScore = config.processScore === null ? "n/a" : config.processScore.toFixed(3);
      const security = config.securityPassRate === null ? "n/a" : `${(config.securityPassRate * 100).toFixed(0)}%`;
      console.log(
        `  ${config.eligibleForComparison ? "✓" : "⚠"} ${config.modelId} × ${config.harnessId}` +
        ` | combined ${score} | completion ${completion} | process ${processScore}` +
        ` | security ${security}${config.securityFailed ? " (FAILED)" : ""}` +
        ` | ${config.evaluatedRuns}/${config.totalRuns}`,
      );
    }
    if (malformed.length) {
      console.error(`[harness-bench] ${malformed.length} malformed/unscored run(s) count against coverage:`);
      for (const item of malformed.slice(0, 10)) {
        console.error(`  run[${item.index}]: ${item.reasons.join("; ")}`);
      }
    }
  }

  if (!report.comparable) {
    const reason = report.securityFailed
      ? "a configuration failed a structural security check"
      : "at least one configuration lacks sufficient coverage";
    console.error(`[harness-bench] NOT COMPARABLE — ${reason}.`);
    process.exit(3);
  }
}

main();
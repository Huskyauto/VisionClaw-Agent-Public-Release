#!/usr/bin/env -S npx tsx
/**
 * MEMORY-MAINTENANCE offline eval (the agent-memory axis, arXiv:2606.24775).
 *
 * Answer-quality evals grade the final answer and so never test the memory
 * SYSTEM's own operations. This is the held-out, DETERMINISTIC, LLM-free,
 * $0-cost regression gate over the MAINTENANCE operation — the contradiction
 * resolver that decides which of two conflicting memories wins and when a
 * contradiction is too close to call and must escalate to a human.
 *
 * WHAT IT DOES
 *   1. Loads the curated set (data/eval/memory-maintenance-set.json).
 *   2. For each case: maps candidate `ageDays` → a concrete lastReinforcedAt Date
 *      (so fixtures are time-stable), runs the REAL resolveContradiction +
 *      shouldEscalateAfterResolver, and grades deterministically against the
 *      case's assertions (expectedWinnerId and/or expectedEscalate).
 *   3. Prints a per-case + suite verdict. No DB, no LLM, no network.
 *
 * FAILURE POSTURE (matches platform convention)
 *   - Coverage fails CLOSED: a case that THROWS is unexecuted; if too few cases
 *     execute the run is DEGRADED (exit 3) — never a green pass off a broken run.
 *   - Any asserted-case mismatch (wrong winner / wrong escalate) = logic
 *     regression (exit 2): a resolver retune flipped a fact or eroded the HITL
 *     margin. This is the bug class the gate exists to catch.
 *
 * USAGE
 *   npx tsx scripts/memory-maintenance-eval.ts            # run the suite
 *   npx tsx scripts/memory-maintenance-eval.ts --json     # machine-readable summary
 *   EVAL_LIMIT=3 npx tsx scripts/memory-maintenance-eval.ts
 *
 * ENV
 *   MAINT_MIN_COVERAGE  min fraction of cases that must execute (default 1.0)
 *   MAINT_PASS_FLOOR    min fraction of executed cases that must pass (default 1.0)
 *   EVAL_LIMIT          cap number of cases (DEV ONLY — never set in CI; a
 *                       partial run cannot satisfy the coverage gate and would
 *                       fail-closed, but leaving it unset keeps intent explicit)
 *
 * EXIT CODES
 *   0  pass        2  logic regression (a case mismatched)
 *   1  config error (missing/malformed set)        3  degraded coverage
 */

import * as fs from "fs";
import * as path from "path";
import { resolveContradiction, shouldEscalateAfterResolver, type ContradictionCandidate } from "../server/lib/contradiction-resolver";
import {
  validateMaintenanceSet,
  gradeMaintenanceCase,
  computeMaintenanceVerdict,
  clampPassthrough,
  type MaintenanceCase,
  type MaintenanceCaseResult,
} from "../server/lib/memory-maintenance-eval-core";

const SET_PATH = path.join(process.cwd(), "data", "eval", "memory-maintenance-set.json");

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const MIN_COVERAGE = clampPassthrough(Number(process.env.MAINT_MIN_COVERAGE), 1.0);
const PASS_FLOOR = clampPassthrough(Number(process.env.MAINT_PASS_FLOOR), 1.0);
const LIMIT = process.env.EVAL_LIMIT ? Math.max(1, parseInt(process.env.EVAL_LIMIT, 10)) : undefined;
const DAY_MS = 86400000;

function log(...a: any[]) {
  if (!JSON_OUT) console.log(...a);
}

function loadSet(): MaintenanceCase[] {
  if (!fs.existsSync(SET_PATH)) {
    console.error(`[maint-eval] maintenance set not found at ${SET_PATH}`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(SET_PATH, "utf8"));
  } catch (e: any) {
    console.error(`[maint-eval] maintenance set is not valid JSON: ${e?.message ?? e}`);
    process.exit(1);
  }
  try {
    const valid = validateMaintenanceSet(parsed);
    return LIMIT ? valid.slice(0, LIMIT) : valid;
  } catch (e: any) {
    console.error(`[maint-eval] ${e?.message ?? e}`);
    process.exit(1);
  }
}

function runCase(c: MaintenanceCase): MaintenanceCaseResult {
  const base: MaintenanceCaseResult = {
    id: c.id,
    category: c.category,
    executed: false,
    passed: false,
    actualWinnerId: null,
    actualEscalate: false,
    expectedWinnerId: c.expectedWinnerId,
    expectedEscalate: c.expectedEscalate,
  };
  try {
    const candidates: ContradictionCandidate[] = c.candidates.map((cand) => ({
      id: cand.id,
      text: cand.text,
      lastReinforcedAt: typeof cand.ageDays === "number" ? new Date(Date.now() - cand.ageDays * DAY_MS) : null,
      sourceAuthority: cand.sourceAuthority,
      supportingObservations: cand.supportingObservations,
      confidence: cand.confidence,
    }));
    const resolution = resolveContradiction(candidates);
    const actual = {
      winnerId: resolution.winner?.id != null ? String(resolution.winner.id) : null,
      escalate: shouldEscalateAfterResolver(resolution),
    };
    const graded = gradeMaintenanceCase(c, actual);
    base.executed = true;
    base.actualWinnerId = actual.winnerId;
    base.actualEscalate = actual.escalate;
    base.passed = graded.passed;
    base.mismatch = graded.mismatch;
  } catch (e: any) {
    base.error = `case threw: ${e?.message ?? e}`;
  }
  return base;
}

function main() {
  const cases = loadSet();
  log(`[maint-eval] running ${cases.length} memory-maintenance case(s) — deterministic, $0`);

  const results = cases.map(runCase);
  for (const r of results) {
    if (!r.executed) {
      log(`  ⚠ ${r.id} [${r.category}] NOT EXECUTED — ${r.error}`);
    } else if (r.passed) {
      log(`  ✓ ${r.id} [${r.category}] winner=${r.actualWinnerId ?? "none"} escalate=${r.actualEscalate}`);
    } else {
      log(`  ✗ ${r.id} [${r.category}] ${r.mismatch}`);
    }
  }

  const executed = results.filter(r => r.executed);
  const passed = executed.filter(r => r.passed);
  const verdict = computeMaintenanceVerdict({
    totalCases: results.length,
    executedCases: executed.length,
    passedCases: passed.length,
    minCoverage: MIN_COVERAGE,
    passFloor: PASS_FLOOR,
  });

  const record = {
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    executedCases: executed.length,
    passedCases: passed.length,
    coverage: Number(verdict.coverage.toFixed(4)),
    passRate: Number(verdict.passRate.toFixed(4)),
    minCoverage: MIN_COVERAGE,
    passFloor: PASS_FLOOR,
    degraded: verdict.degraded,
    failed: verdict.failed,
    failedCases: executed.filter(r => !r.passed).map(r => ({ id: r.id, mismatch: r.mismatch })),
    cases: results,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    log("");
    log(`[maint-eval] ${passed.length}/${executed.length} passed | coverage ${(verdict.coverage * 100).toFixed(0)}%`);
  }

  if (verdict.degraded) {
    console.error(`[maint-eval] DEGRADED — coverage ${(verdict.coverage * 100).toFixed(0)}% < ${(MIN_COVERAGE * 100).toFixed(0)}% required; cases failed to execute`);
    process.exit(3);
  }
  if (verdict.failed) {
    console.error(`[maint-eval] REGRESSION — ${executed.length - passed.length} case(s) mismatched (resolver behavior changed). See failedCases.`);
    process.exit(2);
  }
  log(`[maint-eval] PASS`);
  process.exit(0);
}

main();

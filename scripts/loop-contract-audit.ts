#!/usr/bin/env tsx
/**
 * scripts/loop-contract-audit.ts — the Loop Doctor.
 *
 * Audits VisionClaw's autonomous-loop contracts (server/loop-contracts.ts) for
 * the failure modes Forward Future's Loop Library warns about: weak checks,
 * unsafe authority, UNBOUNDED repetition, stale source, and UNCLEAR STOPPING /
 * handoff behavior. A loop is a feedback system with terminal states — not a
 * licence for endless autonomy — so this gate fails closed when a declared loop
 * can't say when it stops or when it asks a human.
 *
 * Operator-runnable: no TTY, no prompts, env-free, meaningful exit codes.
 *
 *   npx tsx scripts/loop-contract-audit.ts          # human table
 *   npx tsx scripts/loop-contract-audit.ts --json   # machine-readable
 *
 * Exit codes:
 *   0  all contracts well-formed (warnings allowed)
 *   1  one or more ERROR-level gaps (missing stop/escalate/check, bad invariant)
 *   2  a declared source file is missing on disk
 *   3  fatal runtime error
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOOP_CONTRACTS,
  auditLoopCoverage,
  proveReadiness,
  computeReadinessLevel,
  type LoopContract,
  type LoopAuthority,
  type LoopFailMode,
  type ReadinessLevel,
} from "../server/loop-contracts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VALID_AUTHORITY: LoopAuthority[] = ["read-only", "self-healing", "mutating", "destructive"];
const VALID_FAILMODE: LoopFailMode[] = ["open", "closed"];
const VALID_VERIFIER: LoopContract["verifier"][] = ["independent", "self", "deterministic"];
const VALID_SPEND: LoopContract["spend"][] = ["capped", "bounded", "none", "unbounded"];

type Severity = "ERROR" | "WARN";
interface Finding {
  loop: string;
  severity: Severity;
  field: string;
  message: string;
}

function nonEmptyStr(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function auditContract(c: LoopContract): Finding[] {
  const out: Finding[] = [];
  const err = (field: string, message: string) =>
    out.push({ loop: c.id || "(unknown)", severity: "ERROR", field, message });
  const warn = (field: string, message: string) =>
    out.push({ loop: c.id || "(unknown)", severity: "WARN", field, message });

  if (!nonEmptyStr(c.id)) err("id", "missing id");
  if (!nonEmptyStr(c.name)) err("name", "missing name");
  if (!nonEmptyStr(c.trigger)) err("trigger", "missing trigger (what wakes the loop)");

  // Q1–Q3: the loop must be able to describe its outcome, its check, and its feedback.
  if (!nonEmptyStr(c.objective)) err("objective", "missing objective (Q1: what is it trying to accomplish?)");
  if (!nonEmptyStr(c.check)) err("check", "missing check (Q2: how does it verify the attempt worked?)");
  if (!nonEmptyStr(c.feedback)) err("feedback", "missing feedback (Q3: what does it do with what it learned?)");

  // Q4: the two cardinal Loop Library sins.
  if (!Array.isArray(c.stop) || c.stop.filter(nonEmptyStr).length === 0) {
    err("stop", "no stop condition (Q4: unbounded loop — the cardinal sin)");
  }
  if (!Array.isArray(c.escalate) || c.escalate.filter(nonEmptyStr).length === 0) {
    err("escalate", "no escalation/handoff (Q4: a loop must be able to ask a human for help)");
  }

  // Authority + safety posture.
  if (!VALID_AUTHORITY.includes(c.authority)) {
    err("authority", `invalid authority '${c.authority}'`);
  }
  if (!VALID_FAILMODE.includes(c.failMode)) {
    err("failMode", `invalid failMode '${c.failMode}'`);
  }
  // VisionClaw invariant: anything that mutates prod state or deletes data fails CLOSED.
  if ((c.authority === "mutating" || c.authority === "destructive") && c.failMode !== "closed") {
    err("failMode", `${c.authority} loop must fail CLOSED, got '${c.failMode}'`);
  }

  // Source existence.
  if (!nonEmptyStr(c.source)) {
    err("source", "missing source path");
  } else if (!fs.existsSync(path.resolve(REPO_ROOT, c.source))) {
    out.push({ loop: c.id, severity: "ERROR", field: "source", message: `source file not found on disk: ${c.source}` });
  }

  // Generator/evaluator split (Loop Engineering 2026, Table V): a loop must not grade
  // its own homework. The central claim of the paper — the evaluator IS the loop's floor.
  if (!VALID_VERIFIER.includes(c.verifier)) {
    err("verifier", `invalid verifier '${c.verifier}' (must be independent | self | deterministic)`);
  } else if (c.verifier === "self") {
    err(
      "verifier",
      "loop grades its OWN output (the nodding-loop anti-pattern) — split generation from judgment: a DIFFERENT model/agent or a deterministic gate must be able to say 'no'",
    );
  }

  // Token-cap guard (Loop Engineering First-Loop Checklist, Table VI): no unbounded spend.
  if (!VALID_SPEND.includes(c.spend)) {
    err("spend", `invalid spend '${c.spend}' (must be capped | bounded | none | unbounded)`);
  } else if (c.spend === "unbounded") {
    err(
      "spend",
      "open-ended paid model calls with no ceiling (the token-blowout anti-pattern) — gate paid spend behind an atomic budget cap that fails CLOSED, or bound it to a finite per-run work-set",
    );
  } else if (c.spend === "capped") {
    // "capped" is the STRONGEST spend claim (atomic claim-before-spend). Prove it
    // mechanically rather than trusting the label — the paper's central thesis is
    // that a verification you can't check is no verification. The loop's source
    // must reference the claim-before-spend seam (claimAutonomousBudget); a declared
    // "capped" with no seam is an ERROR, forcing an honest downgrade to "bounded".
    try {
      const srcPath = path.resolve(REPO_ROOT, c.source);
      if (fs.existsSync(srcPath) && !fs.readFileSync(srcPath, "utf8").includes("claimAutonomousBudget")) {
        err(
          "spend",
          `declared spend "capped" but ${c.source} does not reference the atomic claim-before-spend seam (claimAutonomousBudget) — wire the budget claim or downgrade to "bounded"`,
        );
      }
    } catch (e: any) {
      warn("spend", `could not verify capped-spend evidence in ${c.source}: ${e?.message || e}`);
    }
  }

  // Soft signal: a thin check is a weak check.
  if (nonEmptyStr(c.check) && c.check.trim().length < 25) {
    warn("check", "check looks thin — Loop Doctor flags weak verification");
  }

  // Readiness rubric (loop-engineering borrow): declared evidence tokens must
  // grep in the source — a lying label is an ERROR, an absent label is honest L2.
  const { unproven } = proveReadiness(c, REPO_ROOT);
  for (const msg of unproven) err("readiness", msg);
  // Report-only-first rule: mutating/self-healing loops must document how they
  // shipped in report/advisory mode first. Advisory (WARN) — quality fails open.
  if (
    (c.authority === "mutating" || c.authority === "self-healing" || c.authority === "destructive") &&
    !nonEmptyStr(c.readiness?.reportOnlyFirst)
  ) {
    warn("readiness", "no reportOnlyFirst note — document how this acting loop satisfied the report-only-first rule");
  }

  return out;
}

/** Per-loop L0–L3 grade, derived from the same findings + proofs the audit uses. */
function gradeLoop(c: LoopContract, findings: Finding[]): ReadinessLevel {
  const contractClean = !findings.some((f) => f.loop === c.id && f.severity === "ERROR");
  const spendProven =
    c.spend !== "capped" ||
    !findings.some((f) => f.loop === c.id && f.field === "spend" && f.severity === "ERROR");
  const { proof } = proveReadiness(c, REPO_ROOT);
  return computeReadinessLevel(c, { contractClean, spendProven, proof });
}

function main() {
  const asJson = process.argv.includes("--json");

  // Duplicate-id guard.
  const seen = new Map<string, number>();
  for (const c of LOOP_CONTRACTS) seen.set(c.id, (seen.get(c.id) || 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const findings: Finding[] = [];
  for (const c of LOOP_CONTRACTS) findings.push(...auditContract(c));
  for (const id of dupes) {
    findings.push({ loop: id, severity: "ERROR", field: "id", message: `duplicate loop id '${id}'` });
  }

  // Completeness gate: every agentic-loop workflow in .replit must have a contract.
  const coverage = auditLoopCoverage();
  for (const wf of coverage.missing) {
    findings.push({
      loop: wf,
      severity: "ERROR",
      field: "coverage",
      message: `workflow '${wf}' has no LoopContract — add one to server/loop-contracts.ts, or add it to NON_LOOP_WORKFLOWS if it is not an autonomous loop`,
    });
  }
  for (const wf of coverage.orphan) {
    findings.push({
      loop: wf,
      severity: "WARN",
      field: "coverage",
      message: `contract names workflow '${wf}' which is not present in .replit — stale contract or renamed workflow`,
    });
  }
  for (const id of coverage.missingInProcess) {
    findings.push({
      loop: id,
      severity: "ERROR",
      field: "coverage",
      message: `in-process loop '${id}' is in IN_PROCESS_LOOPS but has no LoopContract — add a contract (workflow: null) in server/loop-contracts.ts`,
    });
  }
  for (const id of coverage.orphanInProcess) {
    findings.push({
      loop: id,
      severity: "WARN",
      field: "coverage",
      message: `in-process contract '${id}' is not listed in IN_PROCESS_LOOPS — add it to the inventory or remove the stale contract`,
    });
  }

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warns = findings.filter((f) => f.severity === "WARN");
  const missingSource = errors.some((f) => f.field === "source");

  // Per-loop L0–L3 readiness grades (loop-engineering rubric — see the
  // READINESS RUBRIC note in server/loop-contracts.ts). Advisory rollup: the
  // grade never fails the audit by itself; only lying labels (unproven declared
  // evidence) are ERRORs, and those are already in `findings`.
  const readiness: Record<string, ReadinessLevel> = {};
  for (const c of LOOP_CONTRACTS) readiness[c.id] = gradeLoop(c, findings);

  if (asJson) {
    console.log(JSON.stringify({ total: LOOP_CONTRACTS.length, errors: errors.length, warnings: warns.length, readiness, findings }, null, 2));
  } else {
    console.log(`Loop Doctor — auditing ${LOOP_CONTRACTS.length} autonomous-loop contract(s)\n`);
    for (const c of LOOP_CONTRACTS) {
      const f = findings.filter((x) => x.loop === c.id);
      const mark = f.some((x) => x.severity === "ERROR") ? "✗" : f.length ? "!" : "✓";
      console.log(`  ${mark} ${c.id.padEnd(28)} ${readiness[c.id]}  ${c.authority}/${c.failMode}  → ${c.workflow ?? "in-process"}`);
      for (const x of f) console.log(`      [${x.severity}] ${x.field}: ${x.message}`);
    }
    const counts = Object.values(readiness).reduce<Record<string, number>>((acc, l) => ((acc[l] = (acc[l] || 0) + 1), acc), {});
    console.log(`\n  readiness: ${(["L3", "L2", "L1", "L0"] as const).map((l) => `${l}=${counts[l] || 0}`).join("  ")}  (L3 = proven kill switch + attempt cap + run log)`);
    const contractIds = new Set(LOOP_CONTRACTS.map((c) => c.id));
    const coverageFindings = findings.filter((x) => !contractIds.has(x.loop));
    if (coverageFindings.length) {
      console.log(`\n  coverage:`);
      for (const x of coverageFindings) console.log(`      [${x.severity}] ${x.loop}: ${x.message}`);
    } else if (coverage.checked) {
      console.log(`\n  coverage: ${coverage.workflows.length} workflow(s) in .replit, all accounted for.`);
    } else {
      console.log(`\n  coverage: .replit not present — completeness check skipped.`);
    }
    console.log(`\n${errors.length} error(s), ${warns.length} warning(s).`);
    if (errors.length) {
      console.error(
        "\nLoop Doctor FAILED. Every autonomous loop must declare its objective, check, feedback, " +
          "at least one stop condition, and at least one escalation/handoff in server/loop-contracts.ts.",
      );
    }
  }

  if (missingSource && !errors.some((f) => f.field !== "source")) process.exit(2);
  if (errors.length) process.exit(1);
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`[loop-contract-audit] fatal: ${(e as Error).message}`);
  process.exit(3);
}

#!/usr/bin/env tsx
/**
 * guard-step-executor-policy.ts
 *
 * Build-time guard for the AHB destructive-tool policy on AUTONOMOUS STEP
 * EXECUTORS. A raw `executeTool()` call bypasses `enforceToolPolicy`; any code
 * path that runs LLM-authored plan / lobster steps MUST gate each tool through
 * `enforceToolPolicy` first (see server/task-planner.ts + server/lobster.ts) or
 * a non-admin plan can escalate to admin-tenant tool execution.
 *
 * Two invariants, both fail-CLOSED:
 *   1. Every file in STEP_EXECUTORS that calls executeTool() MUST also call
 *      enforceToolPolicy() in the same file.
 *   2. Only ALLOWLISTED server files may call executeTool() at all. A NEW caller
 *      forces a conscious decision: if it executes LLM-authored steps, wire
 *      enforceToolPolicy + add it to STEP_EXECUTORS; otherwise add it to
 *      EXECUTETOOL_ALLOWLIST below with a one-line justification.
 *
 * Exit codes: 0 clean · 1 violation(s) · 2 runtime/config error.
 * Usage: npx tsx scripts/guard-step-executor-policy.ts [--json]
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, "server");

// Files that execute LLM-authored steps — MUST gate executeTool with
// enforceToolPolicy. Paths are relative to server/.
const STEP_EXECUTORS = ["task-planner.ts", "lobster.ts", "plan-executor.ts"];

// Server files allowed to call executeTool() at all. Adding a new one is a
// deliberate act: confirm it is NOT an unguarded step executor first.
const EXECUTETOOL_ALLOWLIST = new Set<string>([
  "tools.ts",                   // defines executeTool + the guarded dispatcher
  "chat-engine.ts",             // main chat round loop (own intent-gate path)
  "task-planner.ts",            // step executor — enforceToolPolicy gated
  "lobster.ts",                 // step executor — enforceToolPolicy gated
  "plan-executor.ts",           // step executor — enforceToolPolicy gated (runToolStep)
  "background-tasks.ts",        // internal scheduled work (trusted, fixed)
  "research-pipeline.ts",       // internal fixed pipeline
  "watchlist.ts",               // internal fixed pipeline
  "workflow-templates.ts",      // internal fixed pipeline
  "skill-seeker.ts",            // internal fixed pipeline
  "mcp-server.ts",              // MCP bridge (own auth boundary)
  "mpeg-engine.ts",             // internal media pipeline
  "video/portrait-registry.ts", // internal media pipeline
  "tools/domains/web/handlers.ts", // firecrawl_scrape fallback calls executeTool("web_fetch") with a HARDCODED safe tool name (not an LLM-authored step) — internal fixed call, no enforceToolPolicy needed
  "tools/domains/character-portraits/handlers.ts", // S-slice migration of init_character_portraits: injects executeTool as a callback into portrait-registry (already-allowlisted video/portrait-registry.ts) which calls the HARDCODED safe tool generate_social_image — same fixed-call pattern as the legacy arm, not an LLM-authored step
]);

const EXEC_RE = /\bexecuteTool\s*\(/;
const POLICY_RE = /\benforceToolPolicy\s*\(/;
// Alias-bypass: `const run = executeTool;` (or `= executeTool` without an
// immediate call) lets a later `run(...)` evade EXEC_RE. Flag any reference to
// executeTool that is NOT a direct call in a non-allowlisted file.
const ALIAS_RE = /=\s*executeTool\b(?!\s*\()/;
// Import-rename alias: `import { executeTool as run }` — same evasion class.
const IMPORT_ALIAS_RE = /\bexecuteTool\s+as\s+\w+/;
// Self-approval spoof: a step executor runs LLM/planner-authored args, so the
// `hasApproval` it feeds enforceToolPolicy MUST be a literal `false` (or omitted)
// — NEVER derived from a model-supplied `_approvedByGate`, or a planner/lobster
// step could self-approve a requiresApproval/destructive tool and bypass the gate.
const APPROVAL_SPOOF_RE = /hasApproval\s*:\s*[^,\n}]*_approvedByGate/;

const TS_EXTS = [".ts", ".mts", ".cts", ".tsx"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      out.push(...listTsFiles(fp));
    } else if (
      TS_EXTS.some((x) => e.name.endsWith(x)) &&
      !e.name.endsWith(".d.ts") &&
      !e.name.endsWith(".baseline")
    ) {
      out.push(fp);
    }
  }
  return out;
}

function rel(fp: string): string {
  return path.relative(SERVER_DIR, fp).split(path.sep).join("/");
}

interface Violation { file: string; rule: string; detail: string; }

function run(): Violation[] {
  const violations: Violation[] = [];
  if (!fs.existsSync(SERVER_DIR)) {
    throw new Error("server/ directory not found");
  }
  const files = listTsFiles(SERVER_DIR);

  // Invariant 1: declared step executors must gate executeTool with policy.
  for (const r of STEP_EXECUTORS) {
    const fp = path.join(SERVER_DIR, r);
    if (!fs.existsSync(fp)) {
      violations.push({ file: r, rule: "step-executor-missing", detail: `STEP_EXECUTORS lists "${r}" but the file is gone — update this guard.` });
      continue;
    }
    const src = fs.readFileSync(fp, "utf8");
    if (EXEC_RE.test(src) && !POLICY_RE.test(src)) {
      violations.push({ file: r, rule: "executor-unguarded", detail: `${r} calls executeTool() but never calls enforceToolPolicy() — LLM-authored steps would bypass the AHB destructive-tool policy. Gate each step (see server/task-planner.ts).` });
    }
    // Invariant 3: no step executor may source `hasApproval` from a model-supplied
    // `_approvedByGate` (self-approval bypass — closed across lobster/plan-executor/
    // task-planner). Must strip `_approvedByGate` from step args + hard-set false.
    if (APPROVAL_SPOOF_RE.test(src)) {
      violations.push({ file: r, rule: "executor-trusts-approval-signal", detail: `${r} feeds enforceToolPolicy a hasApproval value derived from the model-supplied _approvedByGate signal — a planner/lobster step could self-approve a requiresApproval/destructive tool. Strip _approvedByGate from step args and hard-set hasApproval:false (see server/plan-executor.ts).` });
    }
  }

  // Invariant 2: only allowlisted server files may call executeTool at all, and
  // no non-allowlisted file may alias it (which would let a wrapper evade the
  // direct-call detector above).
  for (const fp of files) {
    const r = rel(fp);
    if (EXECUTETOOL_ALLOWLIST.has(r)) continue;
    const src = fs.readFileSync(fp, "utf8");
    if (EXEC_RE.test(src)) {
      violations.push({ file: r, rule: "new-executetool-caller", detail: `${r} calls executeTool() but is not allowlisted. If it executes LLM-authored steps, call enforceToolPolicy first + add it to STEP_EXECUTORS; otherwise add it to EXECUTETOOL_ALLOWLIST in scripts/guard-step-executor-policy.ts with a justification.` });
    }
    if (ALIAS_RE.test(src) || IMPORT_ALIAS_RE.test(src)) {
      violations.push({ file: r, rule: "executetool-alias", detail: `${r} aliases executeTool (e.g. \`const run = executeTool\` or \`import { executeTool as run }\`), which can bypass the direct-call policy guard. Call executeTool directly through the guarded path, or allowlist this file with justification.` });
    }
  }

  return violations;
}

function main() {
  const json = process.argv.includes("--json");
  const violations = run();
  if (json) {
    console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log("[guard] step-executor policy guard: OK (executeTool callers allowlisted; step executors gate via enforceToolPolicy).");
  } else {
    console.error(`[guard] step-executor policy guard FAILED — ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ✗ [${v.rule}] ${v.file}: ${v.detail}`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

try {
  main();
} catch (e: any) {
  console.error(`[guard] runtime error: ${e?.message || String(e)}`);
  process.exit(2);
}

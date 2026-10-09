// R113.3 — Static-source invariants for the Paperclip-nugget Pass 9 sweeper
// + budget-cascade cancel helper.
//
// Runner: node --import tsx --test (via tests/run.sh).
//
// We deliberately do NOT spin up a real DB here — ESM imports of server/db
// can't be transparently mocked in node:test, and the integration path is
// covered by the weekly-maintenance Pass 9 run itself. Instead these tests
// pin the *shape* of the code: the API signatures, the safety guards
// (tenantId validation, NUL stripping, table-missing resilience), and the
// destructive-policy registration. A future refactor that drops one of
// these invariants will fail CI loudly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

// ─── sweepStuckTasks ─────────────────────────────────────────────────────

test("stuck-task-sweep: exports sweepStuckTasks", () => {
  const src = read("server/lib/stuck-task-sweep.ts");
  assert.match(src, /export\s+(?:async\s+function|function\s+\w+|const)\s+sweepStuckTasks/);
});

test("stuck-task-sweep: clamps maxRowsPerTable to a bounded range", () => {
  const src = read("server/lib/stuck-task-sweep.ts");
  // Must call Math.max + Math.min on the rows option (or equivalent).
  assert.ok(
    /Math\.max\([^)]*Math\.min|Math\.min\([^)]*Math\.max|clamp/.test(src),
    "sweep should clamp maxRowsPerTable so callers can't request unbounded scans",
  );
});

test("stuck-task-sweep: queries both agent_runs and mind_tickets", () => {
  const src = read("server/lib/stuck-task-sweep.ts");
  assert.match(src, /agent_runs/);
  assert.match(src, /mind_tickets/);
});

test("stuck-task-sweep: tolerates missing mind_tickets table (schema-orphan)", () => {
  const src = read("server/lib/stuck-task-sweep.ts");
  // Must catch "does not exist" so a missing schema-orphan table is informational, not fatal.
  assert.match(src, /does not exist|relation.*does not exist|catch\s*\(/);
});

test("stuck-task-sweep: filters by a configurable threshold (default 24h)", () => {
  const src = read("server/lib/stuck-task-sweep.ts");
  assert.match(src, /thresholdHours/);
  assert.match(src, /\b24\b/);
});

// ─── cancelPendingJobsForTenant ──────────────────────────────────────────

test("job-queue: exports cancelPendingJobsForTenant", () => {
  const src = read("server/job-queue.ts");
  assert.match(src, /export\s+(?:async\s+function|function|const)\s+cancelPendingJobsForTenant/);
});

function readCancelFn(): string {
  const src = read("server/job-queue.ts");
  const i = src.indexOf("export async function cancelPendingJobsForTenant");
  assert.ok(i >= 0, "cancelPendingJobsForTenant must be exported");
  // Grab a generous window — function body fits well under 3000 chars.
  return src.slice(i, i + 3000);
}

test("job-queue: cancelPendingJobsForTenant rejects non-positive tenantIds", () => {
  const fn = readCancelFn();
  assert.ok(
    /Number\.isInteger|isInteger|<=\s*0|<\s*1|positive/.test(fn),
    "cancelPendingJobsForTenant must guard tenantId — UPDATEs without scope are catastrophic",
  );
});

test("job-queue: cancelPendingJobsForTenant strips NUL bytes from reason", () => {
  const fn = readCancelFn();
  assert.ok(
    /\\u0000|\\x00|\\0/.test(fn),
    "cancelPendingJobsForTenant must strip NUL bytes before persisting",
  );
});

test("job-queue: cancelPendingJobsForTenant excludes safety-critical job kinds by default", () => {
  const fn = readCancelFn();
  // The governor must NOT be able to cancel its own kind; verify the default
  // exclude is documented at the callsite where the helper is invoked.
  const govSrc = read("server/process-governor.ts");
  assert.ok(
    /process_governance|cloud_backup|security_scan/.test(govSrc + fn),
    "default excludeKinds must protect process_governance / cloud_backup / security_scan",
  );
});

test("job-queue: cancelPendingJobsForTenant builds parameterized array literals", () => {
  const fn = readCancelFn();
  // Postgres array literal pattern: `{val1,val2}` cast to ::text[].
  assert.match(fn, /::text\[\]/);
  // Must escape backslashes inside the literal.
  assert.ok(
    /\\\\\\\\/.test(fn),
    "cancelPendingJobsForTenant must escape backslashes when building array literal",
  );
  // Must ALSO escape embedded double-quotes — drift guard (architect R113.3 review).
  assert.ok(
    /\\"/.test(fn) && /replace\([^)]*"/.test(fn),
    "cancelPendingJobsForTenant must escape double-quotes inside excludeKinds array literal",
  );
});

// ─── process-governor wiring ─────────────────────────────────────────────

test("process-governor: wires cancel_pending_jobs action", () => {
  const src = read("server/process-governor.ts");
  assert.match(src, /cancel_pending_jobs/);
  assert.match(src, /cancelPendingJobsForTenant/);
});

// ─── weekly-maintenance Pass 9 wiring ────────────────────────────────────

test("weekly-maintenance: registers Pass 9 (stuck-task sweep)", () => {
  const src = read("scripts/weekly-maintenance.ts");
  // Header must call out 9 passes (was 8 before R113.3).
  assert.match(src, /\b9 passes?\b|Pass\s+9\b/i);
  // Must invoke the sweep helper.
  assert.match(src, /sweepStuckTasks|stuck-task-sweep/);
});

// ─── R113.3+sec architect fixes — drift guards ───────────────────────────

test("paper-ingest: path jail rejects paths outside allowed roots (architect HIGH-1)", () => {
  const src = readFileSync(join(process.cwd(), "server/lib/paper-ingest.ts"), "utf-8");
  // Must define an allowlist constant.
  assert.match(src, /INGEST_ALLOWED_ROOTS/);
  // Must include the canonical roots Bob uses for attached files.
  assert.match(src, /attached_assets/);
  assert.match(src, /project-assets/);
  // Must realpath-resolve to defeat symlink traversal.
  assert.match(src, /realpathSync/);
  // Must reject NUL bytes in the input path.
  assert.match(src, /\\u0000|NUL/);
});

test("process-governor kill_switch: no sql.raw on protected_personas (architect HIGH-2)", () => {
  const src = readFileSync(join(process.cwd(), "server/process-governor.ts"), "utf-8");
  // Locate the kill_switch block specifically.
  const i = src.indexOf("case \"kill_switch\"");
  assert.ok(i >= 0, "kill_switch case must exist");
  const j = src.indexOf("case \"cancel_pending_jobs\"", i);
  const block = src.slice(i, j > i ? j : i + 4000);
  // sql.raw must NOT appear inside the kill_switch block.
  assert.ok(!/sql\.raw\(/.test(block), "kill_switch must not call sql.raw — must use parameterized int[]");
  // Must use parameterized int[] cast pattern.
  assert.match(block, /::int\[\]/);
  // Must validate input as bounded integers.
  assert.match(block, /Number\.isInteger/);
});

test("paper-ingest: idempotency uses pg_advisory_xact_lock under tx (architect MEDIUM-1)", () => {
  const src = readFileSync(join(process.cwd(), "server/lib/paper-ingest.ts"), "utf-8");
  // Advisory lock must be acquired BEFORE the insert loop.
  assert.match(src, /pg_advisory_xact_lock/);
  // Lock must be namespaced by tenantId.
  assert.match(src, /pg_advisory_xact_lock\(\$\{tenantId\}/);
  // Must re-check existence under the lock (not just rely on the pre-check).
  const txStart = src.indexOf("db.transaction");
  assert.ok(txStart >= 0);
  const txBlock = src.slice(txStart, txStart + 2500);
  assert.match(txBlock, /SELECT.*FROM agent_knowledge/);
  assert.match(txBlock, /skippedByRace|recheck/);
});

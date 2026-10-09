/**
 * tests/integration/repair-incident-capture.test.ts
 *
 * Repo Surgeon Task #51 — persistence integration test.
 *
 * The unit test (tests/unit/repair-incident-classifier.test.ts) pins the PURE
 * decision functions. This file exercises the stateful `captureIncident()`
 * end-to-end against the live DB: it persists ONE COMPLETE record from EACH of
 * the three failure sources (runtime_self_heal, ci_self_heal, felix_deliverable)
 * and asserts the stored row carries the full required context — failing
 * stage/command, full logs/error, recent code changes (last 72h), candidate
 * files — plus the classification/routing columns.
 *
 * All three inputs are crafted to land on the DETERMINISTIC heuristic path (no
 * LLM jury) so the test is fast, free, and non-flaky. Skips cleanly when no
 * DATABASE_URL is configured. Cleans up its own rows via a sentinel signature.
 *
 * Run: node --import tsx --test tests/integration/repair-incident-capture.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const HAS_DB = !!process.env.DATABASE_URL;
const SENTINEL = `__it_repair_incident_${process.pid}_${Date.now()}`;

let captureIncident: typeof import("../../server/agentic/repair-incident").captureIncident;
let db: any;
let sql: any;

before(async () => {
  if (!HAS_DB) return;
  ({ captureIncident } = await import("../../server/agentic/repair-incident"));
  ({ db } = await import("../../server/db"));
  ({ sql } = await import("drizzle-orm"));
});

after(async () => {
  try {
    if (HAS_DB && db) {
      await db.execute(sql`DELETE FROM repair_incidents WHERE signature LIKE ${SENTINEL + "%"}`);
    }
  } catch {
    /* best-effort cleanup */
  }
  // The DB pool holds open handles that would otherwise hang the timeout-wrapped
  // runner (tests/run.sh: `timeout 60 node --test ...`) after assertions pass.
  // Force a clean exit, mirroring the unit test's unref'd-exit pattern.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

async function fetchRow(incidentId: number): Promise<any> {
  const res = await db.execute(sql`SELECT * FROM repair_incidents WHERE id = ${incidentId}`);
  const rows = (res as any).rows || res;
  return rows[0];
}

/** Shared assertions: every persisted record must carry the full context shape. */
function assertCompleteRecord(row: any, expected: { source: string; classification: string; routedTo: string }) {
  assert.ok(row, "row persisted");
  assert.equal(row.source, expected.source);
  assert.equal(row.classification, expected.classification);
  assert.equal(row.routed_to, expected.routedTo);
  assert.ok(typeof row.classification_reason === "string" && row.classification_reason.length > 0, "has reason");
  assert.ok(["rule", "heuristic", "jury", "fallback"].includes(row.classified_by), "valid classifiedBy");
  assert.ok(row.created_at, "has created_at");

  const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
  assert.ok(detail, "has detail blob");
  // Full logs/error captured.
  assert.ok(typeof detail.logs === "string" && detail.logs.length > 0, "detail.logs present");
  assert.ok(typeof detail.stage === "string" && detail.stage.length > 0, "detail.stage (failing command/stage) present");
  // Recent code changes (last 72h) — always an array (may be empty in a detached CI checkout).
  assert.ok(Array.isArray(detail.recentChanges), "detail.recentChanges is an array");
}

test("runtime_self_heal: persists complete code-defect record with extracted candidate files", { skip: !HAS_DB }, async () => {
  const r = await captureIncident({
    tenantId: 1,
    source: "runtime_self_heal",
    title: "self-heal integration probe",
    signature: `${SENTINEL}_runtime`,
    error: "TypeError: cfg.load is not a function",
    errorStack: "TypeError: cfg.load is not a function\n    at run (server/agentic/probe-fixture.ts:42:9)",
    stage: "tool:exec",
    logs: "runtime self-heal full log line 1\nruntime self-heal full log line 2",
  });
  assert.ok(r.incidentId, "returned an incidentId");
  assert.equal(r.classification, "code_defect");
  assert.equal(r.routedTo, "repo_surgeon");

  const row = await fetchRow(r.incidentId!);
  assertCompleteRecord(row, { source: "runtime_self_heal", classification: "code_defect", routedTo: "repo_surgeon" });
  const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
  // Candidate files were extracted from the stack (the implicated file).
  assert.ok(
    Array.isArray(detail.candidateFiles) && detail.candidateFiles.some((f: string) => f.includes("probe-fixture.ts")),
    "candidate files extracted from stack",
  );
});

test("ci_self_heal: protected CI rule persists as safety_guard, never auto-fix, with full logs", { skip: !HAS_DB }, async () => {
  const fullLog = "=== typecheck ===\n" + "x".repeat(500) + "\nstale-string preflight failed: forbidden token";
  const r = await captureIncident({
    tenantId: 1,
    source: "ci_self_heal",
    title: "CI failure (run 999)",
    signature: `${SENTINEL}_ci`,
    ciRuleId: "stale-string",
    error: "stale-string preflight failed",
    logs: fullLog,
    stage: "ci",
  });
  assert.ok(r.incidentId, "returned an incidentId");
  assert.equal(r.classification, "safety_guard");
  assert.equal(r.routedTo, "surface");
  assert.equal(r.safetyBlockedAutofix, true);

  const row = await fetchRow(r.incidentId!);
  assertCompleteRecord(row, { source: "ci_self_heal", classification: "safety_guard", routedTo: "surface" });
  assert.equal(row.safety_blocked_autofix, true);
  const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail;
  assert.ok(detail.logs.length > 400, "full CI log (not just snippet) persisted");
});

test("felix_deliverable: grade-below-bar persists as deliverable_quality → felix_revise", { skip: !HAS_DB }, async () => {
  const r = await captureIncident({
    tenantId: 1,
    source: "felix_deliverable",
    title: "delivery #123: Quarterly Report",
    signature: `${SENTINEL}_felix`,
    felixFailureKind: "grade_below_bar",
    error: "Deliverable scored below the passing bar (rubric critique)",
    stage: "grade",
    logs: "felix grade log: score 6.2 below bar 7.5",
  });
  assert.ok(r.incidentId, "returned an incidentId");
  assert.equal(r.classification, "deliverable_quality");
  assert.equal(r.routedTo, "felix_revise");

  const row = await fetchRow(r.incidentId!);
  assertCompleteRecord(row, { source: "felix_deliverable", classification: "deliverable_quality", routedTo: "felix_revise" });
});

/**
 * tests/unit/repo-surgeon.test.ts
 *
 * Repo Surgeon Task #52 — the guarded code-fix executor.
 *
 * Pins the THREE HARD INVARIANTS, all on the PURE/INJECTED surface (no DB, no
 * LLM, no shell — every heavy dependency is stubbed):
 *   1. Never weaken a guard/test/safety surface — BOTH the path denylist AND the
 *      out-of-band diff-content scan, fail-closed.
 *   2. Sensitive surfaces (auth/payments/schema/safety) pause for owner HITL and
 *      are never auto-applied.
 *   3. After two failed attempts on the same incident, stop + escalate.
 * Plus the happy path (land on green), rollback on red, and the
 * verification-plan / safe-test-target helpers.
 *
 * Run: node --import tsx --test tests/unit/repo-surgeon.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  touchedFilesFromProposal,
  diffWeakensGuard,
  isSensitiveSurface,
  isSafeRepoPath,
  FAILED_OUTCOMES,
  runGuardInvariant,
  attemptBudget,
  isSafeTestTarget,
  buildVerificationPlan,
  runRepoSurgeon,
  MAX_FIX_ATTEMPTS,
  type FixProposal,
  type RepoSurgeonIncident,
  type RepoSurgeonDeps,
} from "../../server/agentic/repo-surgeon";

function proposal(over: Partial<FixProposal> = {}): FixProposal {
  return {
    diagnosis: "d",
    rootCause: "rc",
    precedent: "p",
    edits: [{ path: "server/foo.ts", find: "const a = 1;", replace: "const a = 2;" }],
    ...over,
  };
}

function incident(over: Partial<RepoSurgeonIncident> = {}): RepoSurgeonIncident {
  return { tenantId: 1, incidentId: 99, error: "TypeError: x is not a function", ...over };
}

/** A deps stub where every dependency is a no-op / green by default. Override per test. */
function stubDeps(over: Partial<RepoSurgeonDeps> = {}): Partial<RepoSurgeonDeps> {
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  return {
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    deleteFile: (p) => { delete files[p]; },
    exists: (p) => p in files,
    runCommand: () => ({ ok: true, output: "" }),
    rerunTool: async () => ({ ok: true, output: "" }),
    countPriorFailedAttempts: async () => 0,
    countFixesThisHour: async () => 0,
    recordAttempt: async () => 1,
    requestApproval: async () => {},
    escalate: async () => {},
    propose: async () => proposal(),
    ...over,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

test("touchedFilesFromProposal dedups edits + new files", () => {
  const p = proposal({
    edits: [
      { path: "server/a.ts", find: "x", replace: "y" },
      { path: "server/a.ts", find: "m", replace: "n" },
    ],
    newFiles: [{ path: "server/b.ts", content: "z" }],
  });
  assert.deepEqual(touchedFilesFromProposal(p).sort(), ["server/a.ts", "server/b.ts"]);
});

test("diffWeakensGuard flags added @ts-nocheck / .skip / disabled-test markers", () => {
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "foo();", replace: "// @ts-nocheck\nfoo();" }] })).weakened, true);
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "tests/x.test.ts", find: "it('a', f)", replace: "it.skip('a', f)" }] })).weakened, true);
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "a", replace: "eslint-disable-next-line\na" }] })).weakened, true);
});

test("diffWeakensGuard flags REMOVED guard calls / assertions / tenant scoping", () => {
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "await enforceToolPolicy(t);", replace: "// removed" }] })).weakened, true);
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "assert.equal(a, b);", replace: "" }] })).weakened, true);
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "where(eq(t.tenantId, tid))", replace: "where(undefined)" }] })).weakened, true);
});

test("diffWeakensGuard passes a clean, minimal value fix", () => {
  assert.equal(diffWeakensGuard(proposal({ edits: [{ path: "server/x.ts", find: "const n = items.lenght;", replace: "const n = items.length;" }] })).weakened, false);
});

test("isSensitiveSurface flags auth / payments / schema / safety paths", () => {
  assert.equal(isSensitiveSurface(["server/auth.ts"]).sensitive, true);
  assert.equal(isSensitiveSurface(["shared/schema.ts"]).sensitive, true);
  assert.equal(isSensitiveSurface(["server/routes/stripe-checkout.ts"]).sensitive, true);
  assert.equal(isSensitiveSurface(["server/safety/destructive-tool-policy.ts"]).sensitive, true);
  assert.equal(isSensitiveSurface(["server/research-engine.ts"]).sensitive, false);
});

test("runGuardInvariant fails closed on a protected-surface path (denylist)", () => {
  const g = runGuardInvariant(incident(), proposal({ edits: [{ path: "tests/security/ahb-regression.test.ts", find: "a", replace: "b" }] }));
  assert.equal(g.ok, false);
  assert.equal(g.escalate, true);
});

test("runGuardInvariant fails closed on out-of-band weakening inside a normal file", () => {
  const g = runGuardInvariant(incident(), proposal({ edits: [{ path: "server/tools.ts", find: "await enforceToolPolicy(x);", replace: "" }] }));
  assert.equal(g.ok, false);
});

test("runGuardInvariant passes a clean non-protected value fix", () => {
  const g = runGuardInvariant(incident(), proposal());
  assert.equal(g.ok, true);
});

test("isSafeRepoPath accepts allowed repo roots, rejects traversal / absolute / out-of-root", () => {
  assert.equal(isSafeRepoPath("server/agentic/repo-surgeon.ts"), true);
  assert.equal(isSafeRepoPath("shared/schema.ts"), true);
  assert.equal(isSafeRepoPath("./server/x.ts"), true);
  assert.equal(isSafeRepoPath("../../etc/passwd"), false);
  assert.equal(isSafeRepoPath("server/../../../etc/passwd"), false);
  assert.equal(isSafeRepoPath("/etc/passwd"), false);
  assert.equal(isSafeRepoPath("C:\\Windows\\system32"), false);
  assert.equal(isSafeRepoPath(".env"), false); // outside allowed roots
  assert.equal(isSafeRepoPath("package.json"), false); // outside allowed roots
  assert.equal(isSafeRepoPath(""), false);
});

test("runGuardInvariant fails closed on a traversal / out-of-root path", () => {
  const g = runGuardInvariant(incident(), proposal({ edits: [{ path: "../../../etc/passwd", find: "a", replace: "b" }] }));
  assert.equal(g.ok, false);
  assert.equal(g.escalate, true);
});

test("INVARIANT 1: an out-of-repo path proposal is blocked, never applied", async () => {
  let wrote = false;
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({ newFiles: [{ path: "../../tmp/evil.ts", content: "x" }] }),
    writeFile: () => { wrote = true; },
    exists: () => false,
  }));
  assert.equal(res.outcome, "blocked_guard_invariant");
  assert.equal(res.escalated, true);
  assert.equal(wrote, false, "must not write an out-of-repo path");
});

test("FAILED_OUTCOMES counts both red and no-fix terminal outcomes (not HITL/rate-limit)", () => {
  assert.ok(FAILED_OUTCOMES.includes("rolled_back"));
  assert.ok(FAILED_OUTCOMES.includes("blocked_guard_invariant"));
  assert.ok(FAILED_OUTCOMES.includes("diagnosis_failed"));
  assert.ok(FAILED_OUTCOMES.includes("no_fix_proposed"));
  assert.ok(!FAILED_OUTCOMES.includes("awaiting_hitl"));
  assert.ok(!FAILED_OUTCOMES.includes("rate_limited"));
  assert.ok(!FAILED_OUTCOMES.includes("landed"));
});

test("attemptBudget blocks after MAX_FIX_ATTEMPTS failures", () => {
  assert.equal(attemptBudget(0).blocked, false);
  assert.equal(attemptBudget(MAX_FIX_ATTEMPTS - 1).blocked, false);
  assert.equal(attemptBudget(MAX_FIX_ATTEMPTS).blocked, true);
});

test("isSafeTestTarget rejects shell metachars / traversal / non-test paths", () => {
  assert.equal(isSafeTestTarget("tests/unit/foo.test.ts"), true);
  assert.equal(isSafeTestTarget("server/x.spec.ts"), true);
  assert.equal(isSafeTestTarget("tests/unit/foo.ts"), false); // not a .test/.spec
  assert.equal(isSafeTestTarget("tests/unit/foo.test.ts; rm -rf /"), false);
  assert.equal(isSafeTestTarget("../etc/passwd.test.ts"), false);
  assert.equal(isSafeTestTarget("/abs/foo.test.ts"), false);
});

test("buildVerificationPlan infers tests, gates golden-path, carries rerun tool", () => {
  const plan = buildVerificationPlan(incident({ runGoldenPath: true, lastToolName: "produce_video" }), proposal());
  assert.equal(plan.typecheck, true);
  assert.equal(plan.goldenPath, true);
  assert.equal(plan.rerunTool, "produce_video");
  assert.ok(plan.tests.includes("tests/unit/foo.test.ts"));
});

// ── Orchestrator (stubbed deps) ──────────────────────────────────────────────

test("INVARIANT 3: stops + escalates after two prior failed attempts", async () => {
  let escalated = false;
  const res = await runRepoSurgeon(incident(), stubDeps({
    countPriorFailedAttempts: async () => MAX_FIX_ATTEMPTS,
    escalate: async () => { escalated = true; },
  }));
  assert.equal(res.outcome, "stopped_attempt_limit");
  assert.equal(res.escalated, true);
  assert.equal(escalated, true);
});

test("INVARIANT 1: a guard-weakening proposal is blocked, never applied", async () => {
  let wrote = false;
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({ edits: [{ path: "server/tools.ts", find: "await enforceToolPolicy(x);", replace: "" }] }),
    writeFile: () => { wrote = true; },
    exists: () => true,
    readFile: () => "await enforceToolPolicy(x);",
  }));
  assert.equal(res.outcome, "blocked_guard_invariant");
  assert.equal(res.escalated, true);
  assert.equal(wrote, false, "must not write a guard-weakening diff");
});

test("INVARIANT 1: a protected-surface path is blocked, never applied", async () => {
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({ edits: [{ path: "tests/security/ahb-regression.test.ts", find: "a", replace: "b" }] }),
  }));
  assert.equal(res.outcome, "blocked_guard_invariant");
});

test("INVARIANT 2: a sensitive surface pauses for HITL and is never applied", async () => {
  let approvalAsked = false;
  let wrote = false;
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({ edits: [{ path: "server/auth.ts", find: "const a = 1;", replace: "const a = 2;" }] }),
    requestApproval: async () => { approvalAsked = true; },
    writeFile: () => { wrote = true; },
    exists: () => true,
    readFile: () => "const a = 1;",
  }));
  assert.equal(res.outcome, "awaiting_hitl");
  assert.equal(approvalAsked, true);
  assert.equal(wrote, false, "sensitive surface must not auto-apply before sign-off");
});

test("happy path: clean fix verifies green and lands", async () => {
  const res = await runRepoSurgeon(incident(), stubDeps());
  assert.equal(res.outcome, "landed");
  assert.equal(res.escalated, false);
  assert.equal(res.verification?.ok, true);
});

test("red path: verification fails → rolls back, retries, escalates on final attempt", async () => {
  let attemptCount = 0;
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async () => { attemptCount++; return proposal(); },
    runCommand: () => ({ ok: false, output: "typecheck failed" }),
  }));
  assert.equal(res.outcome, "rolled_back");
  assert.equal(res.escalated, true);
  assert.equal(attemptCount, MAX_FIX_ATTEMPTS, "should retry up to the attempt budget");
  assert.equal(files["server/foo.ts"], "const a = 1;\n", "working tree must be restored after a red verification");
});

test("no fix proposed (model declines) → escalates without applying", async () => {
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({ cannotFix: true, edits: [] }),
  }));
  assert.equal(res.outcome, "no_fix_proposed");
  assert.equal(res.escalated, true);
});

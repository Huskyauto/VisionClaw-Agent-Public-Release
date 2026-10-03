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
import { PriorCollapseTracker } from "../../server/lib/prior-collapse";

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

test("spec-vs-test conflict → escalates with the distinct conflict reason", async () => {
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal({
      cannotFix: true,
      specTestConflict: true,
      edits: [],
      diagnosis: "test asserts tenant filter absent, spec requires it",
    }),
  }));
  assert.equal(res.outcome, "no_fix_proposed");
  assert.equal(res.escalated, true);
  assert.ok(res.reason?.includes("contradict the spec"), `distinct conflict reason expected, got: ${res.reason}`);
  assert.ok((res.reasons || []).some(r => r.includes("SPEC-VS-TEST CONFLICT")), "reasons[] must carry the SPEC-VS-TEST CONFLICT marker");
});

test("spec-vs-test conflict NEVER auto-applies — even when the proposer illegally ships edits alongside the flag", async () => {
  // Adversarial proposer: sets specTestConflict but ALSO emits edits with
  // cannotFix=false. The executor must treat the conflict flag as authoritative
  // (forced cannotFix), write nothing, and run zero verify commands.
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  let writes = 0;
  let commands = 0;
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { writes++; files[p] = c; },
    exists: (p) => p in files,
    runCommand: () => { commands++; return { ok: true, output: "" }; },
    propose: async () => proposal({
      cannotFix: false,
      specTestConflict: true,
      diagnosis: "test contradicts spec but here is a fix anyway",
    }),
  }));
  assert.equal(res.outcome, "no_fix_proposed", "conflict flag must force the no-fix path");
  assert.equal(res.escalated, true);
  assert.equal(writes, 0, "no edit may ever be applied under a spec-vs-test conflict");
  assert.equal(commands, 0, "no verify/apply commands may run under a spec-vs-test conflict");
  assert.equal(files["server/foo.ts"], "const a = 1;\n", "working tree untouched");
  assert.ok((res.reasons || []).some(r => r.includes("SPEC-VS-TEST CONFLICT")));
});

// ── Prior-collapse (arXiv:2603.23420 borrow; injected tracker, no embeddings) ─

test("prior-collapse: a near-identical re-proposal after a failed attempt skips verify and escalates", async () => {
  // Every proposal text embeds to the same axis → attempt 2's diff is a
  // guaranteed near-dupe of attempt 1's remembered (failed) diff.
  const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn: async () => [1, 0] });
  let attemptCount = 0;
  let commandCalls = 0;
  let callsBeforeAttempt2 = -1;
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async () => {
      attemptCount++;
      if (attemptCount === 2) callsBeforeAttempt2 = commandCalls;
      return proposal(); // same diff every time
    },
    runCommand: () => { commandCalls++; return { ok: false, output: "typecheck failed" }; },
    collapseTracker: tracker,
  }));
  assert.equal(attemptCount, MAX_FIX_ATTEMPTS, "the collapse consumes the second attempt");
  assert.equal(res.outcome, "rolled_back");
  assert.equal(res.escalated, true, "collapse on the final attempt escalates");
  assert.ok(res.reasons?.some((r) => r.includes("Prior-collapse")), "reason must name the collapse");
  assert.equal(commandCalls, callsBeforeAttempt2, "attempt 2 must not spend any verify commands on a proven-failed dupe");
  assert.equal(files["server/foo.ts"], "const a = 1;\n", "working tree stays clean — the dupe is never applied");
});

test("prior-collapse fail-OPEN: a dead embedding backend degrades to the normal retry path", async () => {
  const tracker = new PriorCollapseTracker({ enabled: true, embedFn: async () => { throw new Error("embeddings down"); } });
  let attemptCount = 0;
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async () => { attemptCount++; return proposal(); },
    runCommand: () => ({ ok: false, output: "typecheck failed" }),
    collapseTracker: tracker,
  }));
  assert.equal(res.outcome, "rolled_back");
  assert.equal(attemptCount, MAX_FIX_ATTEMPTS, "both attempts run their full verify when detection is unavailable");
});

test("prior-collapse fail-OPEN seam: a THROWING injected tracker degrades to the normal retry path", async () => {
  // Beyond the real tracker's never-throw contract: a hostile/buggy injected
  // implementation must not block the surgeon — the call-site safe wrappers
  // (safeCollapseCheck/Remember) force fail-OPEN.
  const throwingTracker = {
    check: async (): Promise<{ collapsed: boolean; similarity: number | null }> => {
      throw new Error("tracker exploded in check");
    },
    remember: async (): Promise<void> => {
      throw new Error("tracker exploded in remember");
    },
  };
  let attemptCount = 0;
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async () => { attemptCount++; return proposal(); },
    runCommand: () => ({ ok: false, output: "typecheck failed" }),
    collapseTracker: throwingTracker,
  }));
  assert.equal(res.outcome, "rolled_back");
  assert.equal(attemptCount, MAX_FIX_ATTEMPTS, "a throwing tracker must not short-circuit the retry budget");
});

// ── Metered escalation valve (Anvil borrow — one frontier diagnostic turn per stall) ─

test("escalation valve: fires EXACTLY ONCE on a non-final stall and feeds the frontier diagnosis into the next propose", async () => {
  // Tracker pre-seeded with a remembered failed diff (cross-invocation memory);
  // every text embeds to the same axis → attempt 1 collapses immediately, and a
  // next attempt exists (remaining=2) so the valve fires.
  const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn: async () => [1, 0] });
  await tracker.remember("previously failed diff");
  let valveCalls = 0;
  const priorFeeds: (string | null)[] = [];
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async (_i, priorFailure) => {
      priorFeeds.push(priorFailure);
      return proposal(); // same diff every time → collapses every attempt
    },
    runCommand: () => ({ ok: false, output: "red" }),
    collapseTracker: tracker,
    fireValve: async (_inc, stallContext) => {
      valveCalls++;
      assert.ok(stallContext.includes("REPEATED FAILED PROPOSAL"), "valve gets the stall context");
      return { model: "frontier-test", stallDiagnosis: "you keep renaming the same variable", suggestedDirection: "fix the import path instead" };
    },
  }));
  assert.equal(valveCalls, 1, "metered: exactly ONE frontier turn even though BOTH attempts collapse");
  assert.equal(res.outcome, "rolled_back");
  assert.ok(
    priorFeeds[1] && priorFeeds[1].includes("STALL DIAGNOSIS") && priorFeeds[1].includes("fix the import path instead"),
    "attempt 2's propose must receive the frontier diagnosis in priorFailure",
  );
  assert.equal(files["server/foo.ts"], "const a = 1;\n", "the dupe is never applied");
});

test("escalation valve fail-OPEN: a throwing valve degrades to the plain perturbation directive", async () => {
  const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn: async () => [1, 0] });
  await tracker.remember("previously failed diff");
  const priorFeeds: (string | null)[] = [];
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async (_i, priorFailure) => { priorFeeds.push(priorFailure); return proposal(); },
    runCommand: () => ({ ok: false, output: "red" }),
    collapseTracker: tracker,
    fireValve: async () => { throw new Error("frontier down"); },
  }));
  assert.equal(res.outcome, "rolled_back");
  assert.ok(priorFeeds[1] && !priorFeeds[1].includes("STALL DIAGNOSIS"), "no diagnosis injected when the valve throws");
  assert.ok(priorFeeds[1] && priorFeeds[1].length > 0, "the perturbation directive still flows to attempt 2");
});

test("escalation valve does NOT fire when the collapse lands on the FINAL attempt (no next turn to consume it)", async () => {
  // No pre-seeded memory: attempt 1 fails verify and is remembered; attempt 2
  // collapses — but it's the last attempt, so the frontier turn would be wasted.
  const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn: async () => [1, 0] });
  let valveCalls = 0;
  const res = await runRepoSurgeon(incident(), stubDeps({
    propose: async () => proposal(),
    runCommand: () => ({ ok: false, output: "red" }),
    collapseTracker: tracker,
    fireValve: async () => { valveCalls++; return { model: "m", stallDiagnosis: "x", suggestedDirection: "y" }; },
  }));
  assert.equal(valveCalls, 0, "final-attempt collapse must not spend the frontier reserve");
  assert.equal(res.outcome, "rolled_back");
  assert.equal(res.escalated, true);
});

test("prior-collapse never blocks a FRESH proposal (different diff on attempt 2 verifies normally)", async () => {
  // Distinct proposals embed to orthogonal axes → no collapse; attempt 2's
  // different fix verifies green and lands.
  const tracker = new PriorCollapseTracker({
    enabled: true,
    threshold: 0.95,
    embedFn: async (t) => (t.includes("const a = 2;") ? [1, 0] : [0, 1]),
  });
  let attemptCount = 0;
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const res = await runRepoSurgeon(incident(), stubDeps({
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    exists: (p) => p in files,
    propose: async () => {
      attemptCount++;
      return attemptCount === 1
        ? proposal() // replace with "const a = 2;" — fails verify
        : proposal({ edits: [{ path: "server/foo.ts", find: "const a = 1;", replace: "const a = 3;" }] });
    },
    runCommand: () => (attemptCount === 1 ? { ok: false, output: "red" } : { ok: true, output: "" }),
    collapseTracker: tracker,
  }));
  assert.equal(res.outcome, "landed", "a structurally different second proposal must not be collapse-blocked");
});

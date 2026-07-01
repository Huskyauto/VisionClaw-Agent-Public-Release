/**
 * tests/unit/repair-incident-dispatch.test.ts
 *
 * Self-repair loop Task #54 — the REMEDY DISPATCH step that closes the loop.
 *
 * `captureIncident` (#51) classifies + persists + escalates; `runRepoSurgeon`
 * (#52) is the guarded code-fix executor. This file pins the connective tissue
 * between them: `dispatchIncidentRemedy` turns the classifier's routing DECISION
 * into an actual self-repair ACTION and records the verified outcome on the
 * ledger row — the auditable proof of WHAT changed and HOW it was verified.
 *
 * Every heavy dependency (the surgeon, the event bus, the DB ledger write) is
 * INJECTED, so the full loop is proven with zero DB / LLM / shell — fast, free,
 * deterministic. Mirrors the pure/injected style of repo-surgeon.test.ts.
 *
 * Run: node --import tsx --test tests/unit/repair-incident-dispatch.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchIncidentRemedy,
  type DispatchArgs,
  type DispatchDeps,
  type LedgerActionPatch,
} from "../../server/agentic/repair-incident";
import type { RepoSurgeonIncident, RepoSurgeonResult } from "../../server/agentic/repo-surgeon";

/** Captures every ledger patch + emitted event so a test can assert on them. */
function harness(over: Partial<DispatchDeps> = {}) {
  const patches: { incidentId: number; tenantId: number; patch: LedgerActionPatch }[] = [];
  const events: any[] = [];
  const deps: DispatchDeps = {
    updateLedger: async (incidentId, tenantId, patch) => {
      patches.push({ incidentId, tenantId, patch });
      return true;
    },
    emitEvent: async (e) => {
      events.push(e);
      return 1;
    },
    ...over,
  };
  return { patches, events, deps };
}

function surgeonResult(over: Partial<RepoSurgeonResult> = {}): RepoSurgeonResult {
  return {
    outcome: "landed",
    attempts: 1,
    reasons: [],
    escalated: false,
    reason: "ok",
    ...over,
  };
}

const baseArgs = (over: Partial<DispatchArgs> = {}): DispatchArgs => ({
  incidentId: 42,
  tenantId: 7,
  routedTo: "repo_surgeon",
  classification: "code_defect",
  enriched: {
    tenantId: 7,
    source: "runtime_self_heal",
    title: "TypeError in widget loader",
    error: "TypeError: cfg.load is not a function",
    candidateFiles: ["server/widget.ts"],
  },
  recentChanges: ["server/widget.ts"],
  ...over,
});

// ── The happy path: code_defect → repo_surgeon → LANDS → ledger resolved ──────
test("repo_surgeon LAND: runs surgeon, records verified outcome, marks resolved, notifies owner (no escalation)", async () => {
  const verification = { ok: true, steps: [{ name: "typecheck", ok: true, output: "" }] };
  const { patches, events, deps } = harness({
    autofixEnabled: true,
    runSurgeon: async (inc) => {
      // The classifier's incident context must reach the executor intact.
      assert.equal(inc.incidentId, 42);
      assert.equal(inc.tenantId, 7);
      assert.deepEqual(inc.candidateFiles, ["server/widget.ts"]);
      return surgeonResult({
        outcome: "landed",
        touchedFiles: ["server/widget.ts"],
        verification,
        diagnosis: "missing import",
        rootCause: "renamed export",
        edits: [{ path: "server/widget.ts", find: "cfg.load()", replace: "cfg.read()" }],
      });
    },
  });

  await dispatchIncidentRemedy(baseArgs(), deps);

  assert.equal(patches.length, 1);
  const { patch } = patches[0];
  assert.equal(patch.actionTaken, "repo_surgeon");
  assert.equal(patch.actionOutcome, "landed");
  assert.equal(patch.resolved, true);
  assert.equal(patch.escalated, false);
  assert.deepEqual(patch.actionDetail.verification, verification);
  assert.deepEqual(patch.actionDetail.touchedFiles, ["server/widget.ts"]);
  // The system edited its own live code unsupervised → the owner is told,
  // with a distinct event type so it's never confused with a failure.
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.type, "repair.incident.autofixed");
  assert.equal(ev.data.remedy, "repo_surgeon");
  assert.equal(ev.data.outcome, "landed");
  assert.equal(ev.data.incidentId, 42);
  assert.equal(ev.data.rootCause, "renamed export");
  assert.deepEqual(ev.data.touchedFiles, ["server/widget.ts"]);
  // The diff and verification summary make a wrong-but-passing fix reviewable.
  assert.match(ev.data.diff, /- cfg\.load\(\)/);
  assert.match(ev.data.diff, /\+ cfg\.read\(\)/);
  assert.match(ev.data.verifiedBy, /typecheck: pass/);
  assert.ok(ev.data.ledgerLink, "links to the review ledger");
});

// ── The autofix notification never blocks the loop when emit throws ───────────
test("repo_surgeon LAND: a throwing emit is contained — land still recorded resolved", async () => {
  const { patches, deps } = harness({
    autofixEnabled: true,
    emitEvent: async () => {
      throw new Error("smtp down");
    },
    runSurgeon: async () => surgeonResult({ outcome: "landed", touchedFiles: ["server/widget.ts"] }),
  });
  await assert.doesNotReject(() => dispatchIncidentRemedy(baseArgs(), deps));
  assert.equal(patches[0].patch.resolved, true);
});

// ── Failure path: surgeon rolls back → escalate to owner, not resolved ────────
test("repo_surgeon ROLLBACK: records outcome, escalates to owner, not resolved", async () => {
  const { patches, events, deps } = harness({
    autofixEnabled: true,
    runSurgeon: async () =>
      surgeonResult({ outcome: "rolled_back", escalated: false, reason: "tests went red" }),
  });

  await dispatchIncidentRemedy(baseArgs(), deps);

  const { patch } = patches[0];
  assert.equal(patch.actionOutcome, "rolled_back");
  assert.equal(patch.resolved ?? false, false);
  assert.equal(patch.escalated, true);
  // The dispatcher guarantees the owner is reached for a non-landed terminal outcome.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "repair.incident.escalated");
  assert.equal(events[0].data.remedy, "repo_surgeon");
  assert.equal(events[0].data.outcome, "rolled_back");
});

// ── Safety invariant: a guard-weakening fix is blocked → escalate, never lands ─
test("repo_surgeon BLOCKED_GUARD_INVARIANT: escalates, never resolved (safety invariant)", async () => {
  const { patches, events, deps } = harness({
    autofixEnabled: true,
    runSurgeon: async () =>
      surgeonResult({ outcome: "blocked_guard_invariant", escalated: true, reason: "would weaken a guard" }),
  });

  await dispatchIncidentRemedy(baseArgs(), deps);
  const { patch } = patches[0];
  assert.equal(patch.actionOutcome, "blocked_guard_invariant");
  assert.equal(patch.resolved ?? false, false);
  assert.equal(patch.escalated, true);
  assert.equal(events.length, 1);
});

// ── HITL: a sensitive surface pauses for owner sign-off, never auto-applied ────
test("repo_surgeon AWAITING_HITL: records pause + escalates for owner sign-off", async () => {
  const { patches, events, deps } = harness({
    autofixEnabled: true,
    runSurgeon: async () => surgeonResult({ outcome: "awaiting_hitl", escalated: true, reason: "auth surface" }),
  });
  await dispatchIncidentRemedy(baseArgs(), deps);
  assert.equal(patches[0].patch.actionOutcome, "awaiting_hitl");
  assert.equal(patches[0].patch.resolved ?? false, false);
  assert.equal(events.length, 1);
});

// ── Opt-in gate: autofix OFF → recorded for human, surgeon NEVER invoked ───────
test("repo_surgeon with autofix DISABLED: never invokes the surgeon, records autofix_disabled", async () => {
  let surgeonInvoked = false;
  const { patches, events, deps } = harness({
    autofixEnabled: false,
    runSurgeon: async () => {
      surgeonInvoked = true;
      return surgeonResult();
    },
  });

  await dispatchIncidentRemedy(baseArgs(), deps);
  assert.equal(surgeonInvoked, false, "surgeon must not run when autofix is disabled");
  assert.equal(patches[0].patch.actionTaken, "repo_surgeon");
  assert.equal(patches[0].patch.actionOutcome, "autofix_disabled");
  assert.equal(events.length, 0);
});

// ── escalate_owner routing → recorded as escalated remedy ─────────────────────
test("escalate_owner: records escalated action (owner event already emitted at capture)", async () => {
  const { patches, deps } = harness({ autofixEnabled: true });
  await dispatchIncidentRemedy(baseArgs({ routedTo: "escalate_owner", classification: "code_defect" }), deps);
  assert.equal(patches[0].patch.actionTaken, "escalate_owner");
  assert.equal(patches[0].patch.actionOutcome, "escalated");
  assert.equal(patches[0].patch.escalated, true);
});

// ── Caller-owned routings record a no-op dispatch, never touch the surgeon ─────
for (const routedTo of ["retry", "felix_revise", "surface"] as const) {
  test(`${routedTo}: records a no-op dispatch (owned by the caller's loop), surgeon untouched`, async () => {
    let surgeonInvoked = false;
    const { patches, events, deps } = harness({
      autofixEnabled: true,
      runSurgeon: async () => {
        surgeonInvoked = true;
        return surgeonResult();
      },
    });
    await dispatchIncidentRemedy(baseArgs({ routedTo }), deps);
    assert.equal(surgeonInvoked, false);
    assert.equal(patches[0].patch.actionTaken, "none");
    assert.equal(patches[0].patch.actionOutcome, "recorded");
    assert.equal(events.length, 0);
  });
}

// ── Robustness: a throwing surgeon never breaks the loop; records dispatch_error ─
test("a throwing surgeon is contained: records dispatch_error, never throws", async () => {
  const { patches, deps } = harness({
    autofixEnabled: true,
    runSurgeon: async () => {
      throw new Error("LLM exploded");
    },
  });
  await assert.doesNotReject(() => dispatchIncidentRemedy(baseArgs(), deps));
  // The error path records dispatch_error so the failure is auditable, not silent.
  const errPatch = patches.find((p) => p.patch.actionOutcome === "dispatch_error");
  assert.ok(errPatch, "recorded dispatch_error");
  assert.equal(errPatch!.patch.actionTaken, "repo_surgeon");
});

// node:test keeps the process alive on nothing here, but mirror the suite's
// clean-exit guard in case a future import opens a handle.
test("__exit", () => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 20).unref();
});

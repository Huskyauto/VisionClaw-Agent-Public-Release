/**
 * tests/integration/majority-vote-repair.test.ts — Task #87
 *
 * R125+139 changed the 3-model repair jury from UNANIMOUS to STRICT-MAJORITY
 * auto-apply. The unit tests pin mapJuryDecision itself; this file proves the
 * rule holds THROUGH the two real consumers, so a future refactor of either
 * consumer can't quietly bypass the majority gate:
 *
 *   1. scripts/drain-jury-queue.ts (drainOnce) — the FULL drain path runs with
 *      every IO seam injected (queue, DB ledger, budget claim, captureIncident).
 *      The injected capture stub routes via the REAL brain (mapJuryDecision +
 *      enforceSafetyRouting) on the REAL precomputedJury shape the drainer built.
 *   2. server/agentic/escalation-resolver.ts (resolveEscalationBacklog) — deps
 *      injected, decision brain unmocked (same pattern as its unit test).
 *
 * Asserted end-to-end, per the task contract:
 *   · 2-of-3 FIX  → routes to repo_surgeon (majority approve ⇒ act)
 *   · 2-of-4 FIX  → does NOT act (even jury: 2/4 is not a strict majority)
 *   · majority REJECT → terminally closes (resolver: resolved=true; drainer:
 *     never forwarded to the implementer)
 *
 * Query-free by construction (pg-pool-hang lesson): no live DB, no LLM.
 *
 * Run: node --import tsx --test tests/integration/majority-vote-repair.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drainOnce,
  buildPrecomputedJury,
  type JuryQueueEntry,
  type DrainDeps,
} from "../../scripts/drain-jury-queue";
import {
  mapJuryDecision,
  enforceSafetyRouting,
  type RawIncident,
} from "../../server/agentic/repair-incident";
import {
  resolveEscalationBacklog,
  type StuckRow,
  type ResolverDeps,
} from "../../server/agentic/escalation-resolver";

// Make sure the HMAC gate is inert (we're testing the majority gate, not forgery).
delete process.env.JURY_QUEUE_HMAC_SECRET;

// ── fixtures ─────────────────────────────────────────────────────────────────

const votes = (n: number, fix: number) =>
  Array.from({ length: n }, (_, i) => ({ model: `m${i}`, verdict: i < fix ? "FIX" : "REJECT" }));

function fixEntry(over: Partial<JuryQueueEntry> = {}): JuryQueueEntry {
  return {
    verdict: "FIX",
    majority: 2,
    fixConcordance: 0.9,
    fixProposal: "add the missing null guard in server/foo.ts",
    issueSlug: `it-majority-${Math.random().toString(36).slice(2)}`,
    votes: votes(3, 2),
    ...over,
  };
}

/** fake DB: ledgerClaim's first INSERT always wins; complete/release are no-ops. */
function fakeDb() {
  const statements: any[] = [];
  let id = 0;
  return {
    statements,
    db: {
      execute: async (q: any) => {
        statements.push(q);
        return { rows: [{ id: ++id }] };
      },
    },
  };
}

/** Drain deps: fully injected, query-free. The capture stub runs the REAL
 *  majority brain on the drainer-built precomputedJury and records the routing —
 *  exactly what captureIncident does with a precomputed jury, minus persistence. */
function mkDrainDeps(entries: JuryQueueEntry[]) {
  const captured: Array<{ raw: any; routedTo: string }> = [];
  const { db } = fakeDb();
  const deps: DrainDeps = {
    readQueue: () => entries,
    mutateQueue: (fn) => fn(entries),
    getDb: async () => db,
    claimBudget: (async () => ({ ok: true, spentUsd: 0, capUsd: 25, degraded: false, reason: "granted" })) as any,
    capture: async (raw: any) => {
      // The REAL brain, unmocked: precomputedJury → mapJuryDecision → safety routing.
      const rawIncident: RawIncident = {
        tenantId: raw.tenantId,
        source: raw.source,
        title: raw.title,
        error: raw.error,
        logs: raw.logs,
        stage: raw.stage,
        candidateFiles: raw.candidateFiles,
      };
      const result = enforceSafetyRouting(rawIncident, mapJuryDecision(raw.precomputedJury));
      captured.push({ raw, routedTo: result.routedTo });
      return { incidentId: 1, result };
    },
  };
  return { deps, captured };
}

// ── drainer path (drainOnce, full loop, IO injected) ─────────────────────────

test("drainer: 2-of-3 FIX flows through drainOnce → real brain routes repo_surgeon", async () => {
  const e = fixEntry({ majority: 2, votes: votes(3, 2) });
  const { deps, captured } = mkDrainDeps([e]);
  const r = await drainOnce(deps);
  assert.equal(r.routed, 1);
  assert.equal(captured.length, 1, "FIX entry reached captureIncident");
  assert.equal(captured[0].routedTo, "repo_surgeon", "strict majority (2/3) must auto-route to repo_surgeon");
  assert.equal(e._drained, true);
  assert.equal(e._outcome, "captured:repo_surgeon");
});

test("drainer: EVEN jury 2-of-4 FIX must NOT act — real brain escalates, never repo_surgeon", async () => {
  const e = fixEntry({ majority: 2, votes: votes(4, 2) });
  const { deps, captured } = mkDrainDeps([e]);
  await drainOnce(deps);
  assert.equal(captured.length, 1, "the drainer forwards the FIX; the majority gate lives in the brain");
  assert.equal(
    captured[0].routedTo,
    "escalate_owner",
    "2/4 is NOT a strict majority — the even-jury case must never reach repo_surgeon",
  );
  assert.equal(e._outcome, "captured:escalate_owner");
});

test("drainer: majority REJECT is never forwarded to the implementer (terminal skip)", async () => {
  const e: JuryQueueEntry = {
    verdict: "REJECT",
    majority: 3,
    fixProposal: "n/a",
    issueSlug: "it-majority-reject",
    votes: votes(3, 0),
  };
  const { deps, captured } = mkDrainDeps([e]);
  const r = await drainOnce(deps);
  assert.equal(captured.length, 0, "REJECT must never reach captureIncident");
  assert.equal(r.routed, 0);
  assert.equal(e._drained, true, "terminally stamped so it is never re-evaluated");
  assert.match(e._outcome || "", /^skipped:non-FIX:REJECT/);
});

test("drainer shape contract: buildPrecomputedJury is exactly what drainOnce feeds the brain", async () => {
  const e = fixEntry({ majority: 3, votes: votes(4, 3), fixConcordance: 0.8, shouldEscalate: false });
  const { deps, captured } = mkDrainDeps([e]);
  await drainOnce(deps);
  assert.deepEqual(captured[0].raw.precomputedJury, buildPrecomputedJury(e));
  // And a 3/4 strict majority acts:
  assert.equal(captured[0].routedTo, "repo_surgeon");
});

// ── resolver path (resolveEscalationBacklog, brain unmocked) ─────────────────

function stuckRow(over: Partial<StuckRow> = {}): StuckRow {
  return {
    id: 1,
    tenant_id: 1,
    source: "runtime_self_heal",
    title: "stuck incident",
    signature: "sig",
    detail: { error: "something generic failed", candidateFiles: ["server/foo.ts"] },
    classification: "code_defect",
    routed_to: "escalate_owner",
    action_outcome: "no_fix_proposed",
    escalated: true,
    safety_blocked_autofix: false,
    ...over,
  };
}

function mkResolverDeps(jury: any) {
  const calls = { ledger: [] as Array<{ id: number; patch: any }>, dispatch: [] as any[], felix: 0 };
  const deps: ResolverDeps = {
    fetchStuck: async () => [stuckRow()],
    runJury: async () => jury,
    consultFelix: async () => {
      calls.felix++;
      return { decision: "KEEP", rationale: "needs a human" };
    },
    dispatch: async (a) => {
      calls.dispatch.push(a);
    },
    updateLedger: async (id, _t, patch) => {
      calls.ledger.push({ id, patch });
      return true;
    },
    emitEvent: async () => 1 as any,
    isProd: () => false,
    now: () => 1_000_000_000_000,
    checkBudget: async () => ({ ok: true, spentUsd: 0, capUsd: 25, degraded: false, reason: "ok" }),
    claimBudget: async () => ({ ok: true, spentUsd: 0, capUsd: 25, degraded: false, reason: "ok" }),
  };
  return { deps, calls };
}

const jd = (over: Record<string, any>) => ({
  verdict: "FIX",
  majority: 2,
  votes: votes(3, 2),
  concordance: 0.8,
  fixConcordance: 0.9,
  shouldEscalate: false,
  aggregatorAnswer: "fix it",
  totalLatencyMs: 1,
  ...over,
});

test("resolver: 2-of-3 FIX → dispatched to repo_surgeon (majority approve ⇒ act)", async () => {
  const { deps, calls } = mkResolverDeps(jd({ majority: 2, votes: votes(3, 2) }));
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 1);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.dispatch[0].routedTo, "repo_surgeon");
  assert.equal(calls.felix, 0, "a clean majority FIX never detours through Felix");
});

test("resolver: EVEN jury 2-of-4 FIX does NOTHING destructive — no dispatch, kept for human", async () => {
  const { deps, calls } = mkResolverDeps(jd({ majority: 2, votes: votes(4, 2) }));
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 0, "2/4 must never dispatch repo_surgeon");
  assert.equal(calls.dispatch.length, 0);
  assert.equal(r.keptForHuman, 1, "even-jury FIX escalates (Felix KEEP → human)");
  assert.equal(calls.ledger[0].patch.actionOutcome, "jury_kept_for_human");
  assert.notEqual(calls.ledger[0].patch.resolved, true, "never terminally closed by an undecided jury");
});

test("resolver: majority REJECT terminally closes the incident (resolved=true, rejected)", async () => {
  const { deps, calls } = mkResolverDeps(jd({ verdict: "REJECT", majority: 3, votes: votes(3, 0) }));
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.closedRejected, 1);
  assert.equal(r.dispatchedFix, 0);
  assert.equal(calls.ledger.length, 1);
  assert.equal(calls.ledger[0].patch.resolved, true, "majority REJECT is a TERMINAL close");
  assert.equal(calls.ledger[0].patch.actionOutcome, "rejected");
  assert.equal(calls.ledger[0].patch.actionDetail.decidedBy, "jury");
});

test("resolver: 3-of-4 FIX (odd majority on an even jury) DOES act", async () => {
  const { deps, calls } = mkResolverDeps(jd({ majority: 3, votes: votes(4, 3) }));
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 1);
  assert.equal(calls.dispatch[0].routedTo, "repo_surgeon");
});

/**
 * tests/unit/escalation-resolver.test.ts — R125+49
 *
 * Unit coverage for the escalation resolver. Every IO seam (DB fetch, jury,
 * Felix, repo-surgeon dispatch, ledger write, event emit) is INJECTED — the
 * test never touches the DB or an LLM (keeps the pg pool closed; the node:test
 * DB-pool-hang lesson). The real decision brain (mapJuryDecision +
 * enforceSafetyRouting) runs unmocked, so each branch exercises actual routing.
 *
 * Run: node --import tsx --test tests/unit/escalation-resolver.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEscalationBacklog,
  reconstructRawIncident,
  parseFelixReview,
  type StuckRow,
  type ResolverDeps,
} from "../../server/agentic/escalation-resolver";

// ── fixtures ────────────────────────────────────────────────────────────────

function row(over: Partial<StuckRow> = {}): StuckRow {
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

// Minimal JuryDecision (cast — only the fields the mapper reads matter).
function jd(over: Record<string, any>): any {
  return { verdict: "ACCEPT", majority: 2, votes: [], concordance: 0.8, shouldEscalate: false, aggregatorAnswer: "", totalLatencyMs: 1, ...over };
}

/** Build deps with capture arrays + sane defaults; override per test. */
function mkDeps(over: Partial<ResolverDeps> = {}) {
  const calls = {
    ledger: [] as Array<{ id: number; patch: any }>,
    dispatch: [] as any[],
    felix: [] as any[],
    events: [] as any[],
    claims: [] as Array<{ tenantId: number; estimate: number }>,
  };
  const deps: ResolverDeps = {
    fetchStuck: async () => [row()],
    runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }),
    consultFelix: async () => {
      const r = { decision: "KEEP" as const, rationale: "needs a human" };
      calls.felix.push(r);
      return r;
    },
    dispatch: async (a) => {
      calls.dispatch.push(a);
    },
    updateLedger: async (id, _t, patch) => {
      calls.ledger.push({ id, patch });
      return true;
    },
    emitEvent: async (e) => {
      calls.events.push(e);
      return 1 as any;
    },
    isProd: () => false,
    now: () => 1_000_000_000_000,
    // Budget governor injected query-free (never touches the cost ledger / pg pool).
    checkBudget: async () => ({ ok: true, spentUsd: 0, capUsd: 25, degraded: false, reason: "within-budget" }),
    // Atomic claim (taken once paid work is certain) — also injected query-free so
    // the default DB-backed claim transaction never runs in unit tests. Tracks each
    // call so tests can assert a no-op run (empty backlog) reserves NOTHING.
    claimBudget: async (tenantId: number, estimate: number) => {
      calls.claims.push({ tenantId, estimate });
      return { ok: true, spentUsd: 0, capUsd: 25, degraded: false, reason: "claim-granted" };
    },
    ...over,
  };
  return { deps, calls };
}

// ── pure helpers ──────────────────────────────────────────────────────────────

test("reconstructRawIncident maps detail jsonb + columns", () => {
  const raw = reconstructRawIncident(
    row({ detail: { error: "boom", stage: "build", candidateFiles: ["a.ts", "b.ts"], lastToolName: "x" } }),
  );
  assert.equal(raw.tenantId, 1);
  assert.equal(raw.error, "boom");
  assert.equal(raw.stage, "build");
  assert.deepEqual(raw.candidateFiles, ["a.ts", "b.ts"]);
  assert.equal(raw.lastToolName, "x");
});

test("parseFelixReview: ACCEPT / REJECT / KEEP / malformed→KEEP", () => {
  assert.equal(parseFelixReview('{"decision":"ACCEPT","rationale":"ok"}').decision, "ACCEPT");
  assert.equal(parseFelixReview('{"decision":"reject"}').decision, "REJECT");
  assert.equal(parseFelixReview('noise {"decision":"KEEP","rationale":"x"} tail').decision, "KEEP");
  assert.equal(parseFelixReview("not json").decision, "KEEP");
  assert.equal(parseFelixReview("").decision, "KEEP");
  assert.equal(parseFelixReview('{"decision":"BANANA"}').decision, "KEEP"); // unknown → conservative
});

// ── routing branches (real mapJuryDecision + enforceSafetyRouting) ───────────

test("surface ACCEPT majority → closed accepted (resolved)", async () => {
  const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }) });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.closedAccepted, 1);
  assert.equal(r.closedRejected, 0);
  assert.equal(calls.ledger.length, 1);
  assert.equal(calls.ledger[0].patch.resolved, true);
  assert.equal(calls.ledger[0].patch.actionOutcome, "accepted");
  assert.equal(calls.ledger[0].patch.actionDetail.decidedBy, "jury");
});

test("surface REJECT majority → closed rejected (resolved)", async () => {
  const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "REJECT", majority: 3 }) });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.closedRejected, 1);
  assert.equal(calls.ledger[0].patch.actionOutcome, "rejected");
  assert.equal(calls.ledger[0].patch.resolved, true);
});

test("guard firing correctly → surfaced + closed accepted even if jury said FIX", async () => {
  // error text trips GUARD_FIRED_RE → enforceSafetyRouting forces 'surface'.
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row({ detail: { error: "request blocked by policy: restricted" } })],
    runJury: async () => jd({ verdict: "FIX", majority: 3, fixConcordance: 0.9 }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 0, "a correctly-firing guard must NEVER reach repo-surgeon");
  assert.equal(r.closedAccepted, 1);
  assert.equal(calls.dispatch.length, 0);
});

test("unanimous safe FIX (dev) → dispatched to repo_surgeon, no ledger close", async () => {
  const { deps, calls } = mkDeps({
    // Unanimity is dynamic (majority >= votes.length) since R125+52.3 — a FIX needs
    // EVERY voter to agree, so the votes array must be present and all-FIX.
    runJury: async () =>
      jd({ verdict: "FIX", majority: 3, fixConcordance: 0.9, votes: [{ verdict: "FIX" }, { verdict: "FIX" }, { verdict: "FIX" }] }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 1);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.dispatch[0].routedTo, "repo_surgeon");
  assert.equal(calls.ledger.length, 0, "dispatch path lets repo-surgeon write its own ledger outcome");
});

test("unanimous FIX in PROD → kept for human, never dispatched", async () => {
  const { deps, calls } = mkDeps({
    isProd: () => true,
    runJury: async () => jd({ verdict: "FIX", majority: 3, fixConcordance: 0.9 }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 0);
  assert.equal(r.keptForHuman, 1);
  assert.equal(calls.dispatch.length, 0);
  assert.equal(calls.ledger[0].patch.actionOutcome, "jury_kept_for_human");
  assert.equal(calls.ledger[0].patch.escalated, true);
});

test("FIX that touches a protected surface → escalate_owner → Felix (never auto-fixed)", async () => {
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row({ detail: { error: "boom", candidateFiles: ["tests/security/ahb-regression.test.ts"] } })],
    runJury: async () => jd({ verdict: "FIX", majority: 3, fixConcordance: 0.9 }),
    consultFelix: async () => ({ decision: "KEEP", rationale: "guard surface — human" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.dispatchedFix, 0, "protected-surface fix must NOT auto-apply");
  assert.equal(r.keptForHuman, 1);
});

test("jury escalate residue + Felix ACCEPT → closed accepted by felix", async () => {
  const { deps, calls } = mkDeps({
    runJury: async () => jd({ verdict: "FIX", majority: 2 }), // non-unanimous → escalate_owner
    consultFelix: async () => ({ decision: "ACCEPT", rationale: "expected condition" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.closedAccepted, 1);
  assert.equal(calls.ledger[0].patch.actionTaken, "felix_resolve");
  assert.equal(calls.ledger[0].patch.actionDetail.decidedBy, "felix");
  assert.equal(calls.ledger[0].patch.resolved, true);
});

test("jury escalate residue + Felix KEEP → kept for human, stamped", async () => {
  const { deps, calls } = mkDeps({
    runJury: async () => jd({ verdict: "ESCALATE", majority: 1, shouldEscalate: true }),
    consultFelix: async () => ({ decision: "KEEP", rationale: "human needed" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.keptForHuman, 1);
  assert.equal(calls.ledger[0].patch.actionOutcome, "jury_kept_for_human");
  assert.equal(calls.ledger[0].patch.escalated, true);
});

test("a thrown jury/felix per-incident is caught (errors++), never aborts the run", async () => {
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row({ id: 1 }), row({ id: 2 })],
    runJury: async (raw) => {
      if (raw.title === "boom-one") throw new Error("jury blew up");
      return jd({ verdict: "ACCEPT", majority: 2 });
    },
    // first row throws, second resolves
  });
  // mark first row's title so runJury throws on it
  const r = await resolveEscalationBacklog(
    { tenantId: 1 },
    { ...deps, fetchStuck: async () => [row({ id: 1, title: "boom-one" }), row({ id: 2, title: "ok" })] },
  );
  assert.equal(r.errors, 1);
  assert.equal(r.closedAccepted, 1);
  assert.equal(r.considered, 2);
});

// ── bounds / control plane ────────────────────────────────────────────────────

test("maxPerRun is forwarded to the fetch (SQL LIMIT bound)", async () => {
  let seenMax = -1;
  const { deps } = mkDeps({
    fetchStuck: async (_t, max) => {
      seenMax = max;
      return [];
    },
  });
  await resolveEscalationBacklog({ tenantId: 1, maxPerRun: 3 }, deps);
  assert.equal(seenMax, 3);
});

test("dryRun: tallies but writes nothing + emits nothing", async () => {
  const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }) });
  const r = await resolveEscalationBacklog({ tenantId: 1, dryRun: true }, deps);
  assert.equal(r.closedAccepted, 1);
  assert.equal(calls.ledger.length, 0);
  assert.equal(calls.events.length, 0);
});

test("kill switch (ESCALATION_RESOLVER_DISABLED) → ran:false", async () => {
  process.env.ESCALATION_RESOLVER_DISABLED = "true";
  try {
    const { deps } = mkDeps();
    const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
    assert.equal(r.ran, false);
    assert.match(r.skippedReason || "", /kill_switch/);
  } finally {
    delete process.env.ESCALATION_RESOLVER_DISABLED;
  }
});

test("fetch failure → ran:false with reason (never throws)", async () => {
  const { deps } = mkDeps({
    fetchStuck: async () => {
      throw new Error("db down");
    },
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.ran, false);
  assert.match(r.skippedReason || "", /fetch_failed/);
});

test("empty backlog → ran:true, considered 0, no digest, and reserves NO budget", async () => {
  const { deps, calls } = mkDeps({ fetchStuck: async () => [] });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.ran, true);
  assert.equal(r.considered, 0);
  assert.equal(calls.events.length, 0);
  // No paid work ⇒ no claim. An idle poll must never orphan a reservation that
  // would pile false pressure against the daily cap (architect FAIL → fixed).
  assert.equal(calls.claims.length, 0, "empty backlog must not reserve any budget");
});

test("non-empty backlog → claim is sized to the actual rows (not a coarse maxPerRun)", async () => {
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row({ id: 1 }), row({ id: 2 })],
    runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }),
  });
  await resolveEscalationBacklog({ tenantId: 7, live: true }, deps);
  assert.equal(calls.claims.length, 1, "exactly one claim is taken once work is certain");
  assert.equal(calls.claims[0].tenantId, 7, "claim is scoped to the run's tenant");
  assert.equal(calls.claims[0].estimate, 2, "estimate tracks the real backlog size");
});

test("consolidated owner digest emitted once when something was acted on", async () => {
  const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }) });
  await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].type, "repair.escalation.swept");
});

// ── autonomous-spend governor ─────────────────────────────────────────────────

test("budget cap hit → ran:false, NEVER fetches or juries (no spend)", async () => {
  let fetched = false;
  let juried = false;
  const { deps } = mkDeps({
    fetchStuck: async () => {
      fetched = true;
      return [row()];
    },
    runJury: async () => {
      juried = true;
      return jd({ verdict: "ACCEPT", majority: 2 });
    },
    // The ATOMIC claim is the spend gate — a refused claim short-circuits the run
    // BEFORE any paid jury call. The cheap fetch (a DB read, not a spend) is
    // allowed first so an empty backlog never reserves budget.
    claimBudget: async () => ({ ok: false, spentUsd: 30, capUsd: 25, degraded: false, reason: "daily-cap-exceeded" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.ran, false);
  assert.match(r.skippedReason || "", /budget_cap/);
  assert.equal(juried, false, "budget gate must short-circuit BEFORE any LLM/jury call (no real spend)");
});

test("budget gate applies to dryRun too (a dryRun still juries = real spend)", async () => {
  let juried = false;
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row()],
    runJury: async () => {
      juried = true;
      return jd({ verdict: "ACCEPT", majority: 2 });
    },
    claimBudget: async () => ({ ok: false, spentUsd: 99, capUsd: 25, degraded: false, reason: "daily-cap-exceeded" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, dryRun: true }, deps);
  assert.equal(r.ran, false);
  assert.equal(juried, false, "denied claim must prevent any jury spend even on a dryRun");
  assert.equal(calls.ledger.length, 0, "no spend recorded when the claim is refused");
});

test("budget degraded but module returned ok (fail-open override) → resolver honors it, run proceeds", async () => {
  const { deps, calls } = mkDeps({
    runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }),
    checkBudget: async () => ({ ok: true, spentUsd: 0, capUsd: 25, degraded: true, reason: "ledger-read-failed-fail-open-override" }),
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.ran, true);
  assert.equal(r.closedAccepted, 1);
  assert.equal(calls.ledger.length, 1);
});

test("mid-run cap crossing → stops at the next incident boundary (no overrun across maxPerRun)", async () => {
  // Pre-run gate (the atomic claim) passes, then the cap is crossed after the
  // first incident's spend lands on the ledger → the in-loop re-check stops the
  // run. The top gate is claimBudget (default ok); the mid-run re-check is the
  // ONLY caller of checkBudget here, so its FIRST call (before incident #2) blocks.
  let n = 0;
  const { deps, calls } = mkDeps({
    fetchStuck: async () => [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
    runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }),
    checkBudget: async () => {
      n++;
      // First (and only) mid-run re-check fires before incident #2 → block.
      return { ok: false, spentUsd: 30, capUsd: 25, degraded: false, reason: "daily-cap-exceeded" };
    },
  });
  const r = await resolveEscalationBacklog({ tenantId: 1, live: true }, deps);
  assert.equal(r.ran, true);
  assert.equal(r.closedAccepted, 1, "only the first incident is processed before the cap stops the run");
  assert.equal(calls.ledger.length, 1, "no further incidents touched after the cap is crossed");
  assert.match(r.skippedReason || "", /budget_cap_midrun/);
});

test("SAFE-BY-DEFAULT: a bare run (no live/dryRun) defaults to dryRun — writes nothing", async () => {
  const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }) });
  const r = await resolveEscalationBacklog({ tenantId: 1 }, deps); // no live, no dryRun
  assert.equal(r.dryRun, true, "default must be dryRun (safe-by-default)");
  assert.equal(r.closedAccepted, 1, "still classifies/tallies");
  assert.equal(calls.ledger.length, 0, "but writes nothing without explicit live");
});

test("ESCALATION_RESOLVER_LIVE=true env flips safe-by-default to live", async () => {
  process.env.ESCALATION_RESOLVER_LIVE = "true";
  try {
    const { deps, calls } = mkDeps({ runJury: async () => jd({ verdict: "ACCEPT", majority: 2 }) });
    const r = await resolveEscalationBacklog({ tenantId: 1 }, deps); // no explicit opts
    assert.equal(r.dryRun, false);
    assert.equal(calls.ledger.length, 1);
  } finally {
    delete process.env.ESCALATION_RESOLVER_LIVE;
  }
});

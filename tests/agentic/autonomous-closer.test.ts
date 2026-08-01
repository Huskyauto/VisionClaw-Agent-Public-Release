// Tests for the autonomous closer — the rail that applies jury-approved,
// tsc-verified code_proposals to production without a human gate. We inject all
// deps so nothing touches the DB, the jury, or the filesystem.

import { runAutonomousCodeCloser, type CloserCandidate, type CloserDeps } from "../../server/agentic/autonomous-closer";
import type { JuryDecision } from "../../server/lib/jury-triage";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function jury(verdict: JuryDecision["verdict"], majority: number, shouldEscalate = false): JuryDecision {
  return { verdict, majority, votes: [], concordance: null, shouldEscalate, fixDirectionConcordance: null } as unknown as JuryDecision;
}

function cand(id: number): CloserCandidate {
  return { id, title: `prop ${id}`, description: "d", target_file: "server/tools.ts", rationale: "r", code_diff: "<<<OLD_CODE>>>a<<</OLD_CODE>>><<<NEW_CODE>>>b<<</NEW_CODE>>>" };
}

type Calls = { approved: number[]; applied: number[]; rejected: number[]; reverified: number[]; rolledBack: number[]; notified: string[] };

function freshCalls(): Calls {
  return { approved: [], applied: [], rejected: [], reverified: [], rolledBack: [], notified: [] };
}

function makeDeps(over: Partial<CloserDeps>, calls: Calls): Partial<CloserDeps> {
  return {
    async reverify(id) { calls.reverified.push(id); return { status: "passed" }; },
    async approve(id) { calls.approved.push(id); return true; },
    async apply(id) { calls.applied.push(id); return { success: true, stage: "applied", reverted: false }; },
    async reject(id) { calls.rejected.push(id); },
    async rollback(id) { calls.rolledBack.push(id); },
    async notifyOwner(subject) { calls.notified.push(subject); },
    ...over,
  };
}

async function run() {
  // 1. FIX majority → re-verify, approve, apply.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(1)]; },
      async runJury() { return jury("FIX", 3); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.applied.length === 1 && r.applied[0] === 1, "FIX/3 applies proposal #1");
    assert(calls.reverified.includes(1) && calls.approved.includes(1) && calls.applied.includes(1), "FIX path re-verifies, approves, applies");
    assert(r.rejected.length === 0 && r.escalated.length === 0, "FIX path: nothing rejected/escalated");
  }

  // 2. REJECT majority → reject, never apply.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(2)]; },
      async runJury() { return jury("REJECT", 2); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.rejected.length === 1 && r.rejected[0] === 2, "REJECT/2 rejects proposal #2");
    assert(calls.applied.length === 0 && calls.approved.length === 0, "REJECT path never applies");
  }

  // 3. ESCALATE / shouldEscalate → notify owner, never apply (fail closed).
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(3)]; },
      async runJury() { return jury("FIX", 3, true); }, // FIX but jury flagged escalate
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.escalated.includes(3), "shouldEscalate=true escalates even on FIX majority");
    assert(calls.applied.length === 0, "escalate path never applies");
    assert(calls.notified.length === 1, "escalate path notifies owner");
  }

  // 4. No 2/3 majority (FIX/1) → escalate, never apply.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(4)]; },
      async runJury() { return jury("FIX", 1); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.escalated.includes(4) && calls.applied.length === 0, "FIX/1 (no majority) escalates, no apply");
  }

  // 5. Jury throws → fail closed: escalate + notify, never apply.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(5)]; },
      async runJury() { throw new Error("jury boom"); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.escalated.includes(5) && calls.applied.length === 0, "jury error fails closed (escalate, no apply)");
    assert(calls.notified.length === 1, "jury error notifies owner");
  }

  // 6. dryRun → would-apply recorded but approve/apply NOT called.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(6)]; },
      async runJury() { return jury("FIX", 3); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, dryRun: true, deps });
    assert(r.applied.includes(6), "dryRun records would-apply");
    assert(calls.approved.length === 0 && calls.applied.length === 0, "dryRun never mutates/applies");
  }

  // 7. Cap respected — maxApplies passed to fetchCandidates.
  {
    const calls = freshCalls();
    let askedLimit = -1;
    const deps = makeDeps({
      async fetchCandidates(_t, limit) { askedLimit = limit; return []; },
      async runJury() { return jury("FIX", 3); },
    }, calls);
    await runAutonomousCodeCloser({ tenantId: 1, maxApplies: 3, deps });
    assert(askedLimit === 3, "maxApplies is forwarded as the candidate LIMIT");
  }

  // 8. Re-verify regressed → not applied (stale source guard).
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(8)]; },
      async runJury() { return jury("FIX", 3); },
      async reverify(id) { calls.reverified.push(id); return { status: "failed", details: "stale" }; },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(calls.applied.length === 0 && r.failed.some(f => f.id === 8 && f.stage === "reverify"), "re-verify failure blocks apply");
  }

  // 9. Kill switch → does not run.
  {
    const prev = process.env.AUTONOMOUS_CLOSER_DISABLED;
    process.env.AUTONOMOUS_CLOSER_DISABLED = "true";
    const calls = freshCalls();
    const deps = makeDeps({ async fetchCandidates() { return [cand(9)]; }, async runJury() { return jury("FIX", 3); } }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.ran === false && calls.applied.length === 0, "kill switch halts the run");
    if (prev === undefined) delete process.env.AUTONOMOUS_CLOSER_DISABLED; else process.env.AUTONOMOUS_CLOSER_DISABLED = prev;
  }

  // 10. Prod hard-stop in module → never runs, never applies (independent of heartbeat).
  {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const calls = freshCalls();
    const deps = makeDeps({ async fetchCandidates() { return [cand(10)]; }, async runJury() { return jury("FIX", 3); } }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.ran === false && /prod/i.test(r.skippedReason || ""), "prod hard-stop refuses to run");
    assert(calls.applied.length === 0 && calls.approved.length === 0, "prod hard-stop never applies");
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }

  // 11. Apply fails after approve → rollback called, recorded failed, not applied.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(11)]; },
      async runJury() { return jury("FIX", 3); },
      async apply(id) { calls.applied.push(id); return { success: false, stage: "compile", error: "boom", reverted: true }; },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(calls.rolledBack.includes(11), "apply failure rolls the row back");
    assert(r.applied.length === 0 && r.failed.some(f => f.id === 11 && f.stage === "compile"), "apply failure recorded, not applied");
    assert(calls.notified.length === 1, "apply failure notifies owner");
  }

  // 12. CAS approve no-op (row drifted) → skip, never apply.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(12)]; },
      async runJury() { return jury("FIX", 3); },
      async approve(id) { calls.approved.push(id); return false; },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(calls.applied.length === 0 && r.failed.some(f => f.id === 12 && f.stage === "cas-approve"), "CAS approve no-op skips apply");
  }

  // 13. Apply THROWS (not {success:false}) → rollback + notify, fail-closed.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(13)]; },
      async runJury() { return jury("FIX", 3); },
      async apply() { throw new Error("kaboom"); },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(calls.rolledBack.includes(13), "apply throw rolls the row back");
    assert(r.applied.length === 0 && r.failed.some(f => f.id === 13 && f.stage === "apply-threw"), "apply throw recorded, not applied");
    assert(calls.notified.length === 1, "apply throw notifies owner");
  }

  // 14. Apply returns db-mark failure (file applied on disk, only the status
  //     write failed) → MUST NOT roll back; surfaced as failed + owner-notified.
  {
    const calls = freshCalls();
    const deps = makeDeps({
      async fetchCandidates() { return [cand(14)]; },
      async runJury() { return jury("FIX", 3); },
      async apply(id) { calls.applied.push(id); return { success: false, stage: "db-mark", error: "status write failed", reverted: false }; },
    }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(!calls.rolledBack.includes(14), "db-mark failure does NOT roll the row back (file is applied + valid)");
    assert(r.applied.length === 0 && r.failed.some(f => f.id === 14 && f.stage === "db-mark"), "db-mark recorded as failed for reconciliation");
    assert(calls.notified.length === 1, "db-mark failure notifies owner for manual reconciliation");
  }

  // 15. Prod via REPLIT_DEPLOYMENT="1" (NODE_ENV unset/non-prod) → hard-stop.
  //     Guards must fail CLOSED on the deployment signal, not only NODE_ENV.
  {
    const prevDep = process.env.REPLIT_DEPLOYMENT;
    const prevEnv = process.env.NODE_ENV;
    process.env.REPLIT_DEPLOYMENT = "1";
    process.env.NODE_ENV = "test";
    const calls = freshCalls();
    const deps = makeDeps({ async fetchCandidates() { return [cand(15)]; }, async runJury() { return jury("FIX", 3); } }, calls);
    const r = await runAutonomousCodeCloser({ tenantId: 1, deps });
    assert(r.ran === false && /prod/i.test(r.skippedReason || ""), "REPLIT_DEPLOYMENT=1 hard-stops the closer");
    assert(calls.applied.length === 0 && calls.approved.length === 0, "REPLIT_DEPLOYMENT=1 never applies");
    if (prevDep === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = prevDep;
    if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
  }

  console.log(`\nautonomous-closer.test.ts: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });

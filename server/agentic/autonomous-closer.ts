// Autonomous closer — closes the research → idea → production loop without a
// human gate. It picks up code_proposals that have ALREADY passed tsc
// shadow-verification (status='ready', verification_status='passed'), runs them
// through the jury-decides-and-ships rail (3-frontier-model vote, 2-of-3
// majority), and on a FIX majority sets status='approved' and calls
// safeApplyProposal — which re-applies the diff in-process behind its OWN
// tsc --noEmit gate and auto-reverts on compile/syntax failure.
//
// Design invariants (high blast-radius surface — read before editing):
//  - FAIL CLOSED. Any jury error / split / non-majority / ESCALATE → the
//    proposal is LEFT in place (never applied) and the owner is notified.
//  - GO requires verdict==='FIX' AND majority>=2 AND !shouldEscalate. ACCEPT
//    (jury "defer/inert") and REJECT both mean "do not apply now".
//  - Re-verify freshness (verifyProposalById) immediately before applying so a
//    proposal verified days ago against now-stale source can't slip through.
//    safeApplyProposal also independently refuses unless verification='passed'
//    and the OLD_CODE block still matches exactly once.
//  - Capped per run (AUTONOMOUS_CLOSER_MAX_APPLIES, default 2) so a 2-month
//    backlog can't apply in one burst.
//  - DEV/workspace ONLY. The deployed prod FS is ephemeral + runs a bundle, so
//    applying code there is useless and would mark the shared-DB row 'applied'
//    before the workspace persists it via Auto Git Push. The heartbeat
//    selection guards skip this task type in production; this module also hard
//    refuses when NODE_ENV==='production'.
//  - Kill switch: AUTONOMOUS_CLOSER_DISABLED=true halts all runs.
//  - never-throws: returns a structured CloserResult; all errors are logged.

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { JuryDecision } from "../lib/jury-triage";
import { isProductionRuntime } from "../lib/runtime-env";

export interface CloserCandidate {
  id: number;
  title: string | null;
  description: string | null;
  target_file: string | null;
  rationale: string | null;
  code_diff: string | null;
}

export interface CloserDeps {
  fetchCandidates: (tenantId: number, limit: number) => Promise<CloserCandidate[]>;
  runJury: (issueText: string, context: string, tenantId: number) => Promise<JuryDecision>;
  reverify: (id: number) => Promise<{ status: string; details?: string }>;
  /**
   * Compare-and-swap approve: flips status ready→approved ONLY while the row is
   * still ready+passed. Returns false if the row changed under us (another
   * executor / status drift) so the caller skips the apply rather than acting on
   * a stale candidate. Atomic gate against shared-DB double-execution.
   */
  approve: (id: number, tenantId: number) => Promise<boolean>;
  apply: (id: number, tenantId: number) => Promise<{ success: boolean; stage: string; error?: string; reverted: boolean }>;
  reject: (id: number, reason: string, tenantId: number) => Promise<void>;
  /**
   * Roll an approved-but-not-applied row back to needs_review. Conditional on
   * status='approved' so it never clobbers a 'failed'/'needs_review' status that
   * safeApplyProposal already set during its own revert path.
   */
  rollback: (id: number, tenantId: number) => Promise<void>;
  notifyOwner: (subject: string, body: string) => Promise<void>;
}

export interface CloserResult {
  ran: boolean;
  skippedReason?: string;
  considered: number;
  applied: number[];
  rejected: number[];
  escalated: number[];
  failed: { id: number; stage: string; error?: string }[];
  dryRun: boolean;
}

const MAX_DIFF_CHARS = 6000;

function envMaxApplies(): number {
  const raw = parseInt(process.env.AUTONOMOUS_CLOSER_MAX_APPLIES || "2", 10);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(raw, 10); // hard ceiling — never apply more than 10 in one run
}

function defaultDeps(): CloserDeps {
  return {
    async fetchCandidates(tenantId, limit) {
      const r = await db.execute(sql`
        SELECT id, title, description, target_file, rationale, code_diff
        FROM code_proposals
        WHERE tenant_id = ${tenantId}
          AND status = 'ready'
          AND verification_status = 'passed'
        ORDER BY created_at ASC
        LIMIT ${limit}
      `);
      return ((r as any).rows || r) as CloserCandidate[];
    },
    async runJury(issueText, context, tenantId) {
      const { juryTriage } = await import("../lib/jury-triage");
      return juryTriage({ issueText, context, tenantId, invokedVia: "autonomous-closer" });
    },
    async reverify(id) {
      const { verifyProposalById } = await import("../proposal-verifier");
      const v = await verifyProposalById(id);
      return { status: v.status, details: v.details };
    },
    async approve(id, tenantId) {
      const r = await db.execute(sql`
        UPDATE code_proposals
        SET status = 'approved', reviewed_by = 'autonomous-closer', reviewed_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId}
          AND status = 'ready' AND verification_status = 'passed'
        RETURNING id
      `);
      const rows = (r as any).rows || r;
      return Array.isArray(rows) && rows.length > 0;
    },
    async rollback(id, tenantId) {
      await db.execute(sql`
        UPDATE code_proposals
        SET status = 'needs_review', reviewed_by = 'autonomous-closer', reviewed_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'approved'
      `);
    },
    async apply(id, tenantId) {
      const { safeApplyProposal } = await import("../research-engine");
      return safeApplyProposal(id, tenantId);
    },
    async reject(id, reason, tenantId) {
      // CAS-guarded like approve()/rollback(): only reject a still-'ready' row.
      // If a concurrent path already applied/handled it, this no-ops instead of
      // clobbering a valid terminal state (race-safe, matches the state machine).
      await db.execute(sql`
        UPDATE code_proposals
        SET status = 'rejected', reviewed_by = 'autonomous-closer', reviewed_at = NOW(),
            verification_details = ${reason.slice(0, 500)}
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'ready'
      `);
    },
    async notifyOwner(subject, body) {
      // Loud, dependency-free owner signal. The heartbeat handler also writes a
      // heartbeat_logs row per run, so escalations are visible in the admin UI.
      console.warn(`[autonomous-closer][OWNER] ${subject} :: ${body}`);
    },
  };
}

async function safeNotify(deps: CloserDeps, subject: string, body: string): Promise<void> {
  try {
    await deps.notifyOwner(subject, body);
  } catch (e: any) {
    console.error(`[autonomous-closer] notifyOwner failed: ${e?.message || e}`);
  }
}

export async function runAutonomousCodeCloser(opts: {
  tenantId?: number;
  dryRun?: boolean;
  maxApplies?: number;
  deps?: Partial<CloserDeps>;
} = {}): Promise<CloserResult> {
  const tenantId = opts.tenantId ?? 1;
  const dryRun = opts.dryRun ?? (process.env.AUTONOMOUS_CLOSER_DRYRUN === "true");
  const maxApplies = opts.maxApplies ?? envMaxApplies();
  const deps: CloserDeps = { ...defaultDeps(), ...(opts.deps || {}) };

  const result: CloserResult = {
    ran: true,
    considered: 0,
    applied: [],
    rejected: [],
    escalated: [],
    failed: [],
    dryRun,
  };

  if (process.env.AUTONOMOUS_CLOSER_DISABLED === "true") {
    return { ...result, ran: false, skippedReason: "kill_switch (AUTONOMOUS_CLOSER_DISABLED=true)" };
  }

  // Hard prod refusal — enforced HERE, independent of the heartbeat selection
  // guards, so a future route/script/manual call can never apply code on the
  // ephemeral prod FS (which would mark the shared-DB row 'applied' before the
  // workspace persists it via Auto Git Push). dev/workspace only. Checks BOTH
  // REPLIT_DEPLOYMENT and NODE_ENV so an unset/misset NODE_ENV can't fail OPEN.
  if (isProductionRuntime()) {
    return { ...result, ran: false, skippedReason: "prod_disabled (dev/workspace only)" };
  }

  let candidates: CloserCandidate[];
  try {
    candidates = await deps.fetchCandidates(tenantId, maxApplies);
  } catch (e: any) {
    console.error(`[autonomous-closer] fetchCandidates failed: ${e?.message || e}`);
    return { ...result, ran: false, skippedReason: `fetch_failed: ${e?.message || e}` };
  }

  result.considered = candidates.length;
  if (candidates.length === 0) return result;

  for (const c of candidates) {
    try {
      const issueText =
        `A research-generated code proposal has PASSED tsc shadow-verification and is queued for production. ` +
        `Decide whether to APPLY it.\n\n` +
        `TITLE: ${c.title || "(untitled)"}\n` +
        `TARGET FILE: ${c.target_file}\n` +
        `DESCRIPTION: ${c.description || "(none)"}\n` +
        `RATIONALE: ${c.rationale || "(none)"}\n\n` +
        `DIFF (truncated):\n${(c.code_diff || "").slice(0, MAX_DIFF_CHARS)}`;
      const context =
        `Verdict mapping for the autonomous closer: FIX = apply this change to production now; ` +
        `REJECT = discard it (false improvement / wrong); ACCEPT = defer, do not apply now. ` +
        `The diff already compiles (tsc --noEmit passed in a shadow worktree); judge correctness, ` +
        `risk, and whether shipping it unattended is sound.`;

      let decision: JuryDecision;
      try {
        decision = await deps.runJury(issueText, context, tenantId);
      } catch (e: any) {
        // FAIL CLOSED — jury error never applies.
        console.error(`[autonomous-closer] jury failed for proposal #${c.id}: ${e?.message || e}`);
        result.escalated.push(c.id);
        await safeNotify(deps, `Autonomous closer: jury error on proposal #${c.id}`, `Jury threw: ${e?.message || e}. Left pending for manual review.`);
        continue;
      }

      // Explicit REJECT majority → discard the proposal.
      if (decision.verdict === "REJECT" && decision.majority >= 2) {
        if (!dryRun) await deps.reject(c.id, `Autonomous jury REJECT (${decision.majority}/3)`, tenantId);
        result.rejected.push(c.id);
        console.log(`[autonomous-closer] proposal #${c.id} REJECTED by jury (${decision.majority}/3)`);
        continue;
      }

      const go = decision.verdict === "FIX" && decision.majority >= 2 && !decision.shouldEscalate;
      if (!go) {
        result.escalated.push(c.id);
        await safeNotify(
          deps,
          `Autonomous closer: proposal #${c.id} escalated`,
          `Jury verdict=${decision.verdict} majority=${decision.majority} shouldEscalate=${decision.shouldEscalate}. Left pending for manual review.`,
        );
        console.log(`[autonomous-closer] proposal #${c.id} escalated (verdict=${decision.verdict} maj=${decision.majority} esc=${decision.shouldEscalate})`);
        continue;
      }

      if (dryRun) {
        result.applied.push(c.id); // would-apply
        console.log(`[autonomous-closer] DRY RUN would apply proposal #${c.id} (jury FIX ${decision.majority}/3)`);
        continue;
      }

      // Re-verify against current source immediately before applying.
      let fresh: { status: string; details?: string };
      try {
        fresh = await deps.reverify(c.id);
      } catch (e: any) {
        console.error(`[autonomous-closer] reverify threw for #${c.id}: ${e?.message || e}`);
        result.failed.push({ id: c.id, stage: "reverify", error: e?.message || String(e) });
        continue;
      }
      if (fresh.status !== "passed") {
        console.warn(`[autonomous-closer] proposal #${c.id} re-verify=${fresh.status} (${fresh.details || ""}) — not applying`);
        result.failed.push({ id: c.id, stage: "reverify", error: `re-verify status=${fresh.status}` });
        continue;
      }

      // CAS approve: only flips ready→approved while still ready+passed. A false
      // return means the row drifted (race / already handled) — skip, never apply.
      const approved = await deps.approve(c.id, tenantId);
      if (!approved) {
        console.warn(`[autonomous-closer] CAS approve no-op for #${c.id} (row no longer ready+passed) — skipping`);
        result.failed.push({ id: c.id, stage: "cas-approve", error: "row no longer ready+passed" });
        continue;
      }

      let ap: { success: boolean; stage: string; error?: string; reverted: boolean };
      try {
        ap = await deps.apply(c.id, tenantId);
      } catch (e: any) {
        // apply THREW (vs returning {success:false}) — keep the exception path
        // symmetric & fail-closed: roll the approved row back and notify.
        console.error(`[autonomous-closer] apply threw for #${c.id}: ${e?.message || e}`);
        try { await deps.rollback(c.id, tenantId); } catch (re: any) { console.error(`[autonomous-closer] rollback failed for #${c.id}: ${re?.message || re}`); }
        result.failed.push({ id: c.id, stage: "apply-threw", error: e?.message || String(e) });
        await safeNotify(deps, `Autonomous closer: apply threw on proposal #${c.id}`, `${e?.message || e}`);
        continue;
      }
      if (ap.success) {
        result.applied.push(c.id);
        console.log(`[autonomous-closer] ✅ APPLIED proposal #${c.id} → ${c.target_file} (jury FIX ${decision.majority}/3)`);
      } else if (ap.stage === "db-mark") {
        // Post-apply BOOKKEEPING failure: the change is already on disk and PASSED
        // compile+syntax (reverted=false). Do NOT roll the row back — that would
        // restore status to needs_review while a valid change stays applied, the
        // exact drift safeApplyProposal's non-throw path is meant to avoid. Leave
        // the row as-is and escalate for manual DB reconciliation instead.
        result.failed.push({ id: c.id, stage: ap.stage, error: ap.error });
        console.error(`[autonomous-closer] ⚠️ proposal #${c.id} APPLIED ON DISK (${c.target_file}, compile+syntax PASS) but the 'applied' status write FAILED — row NOT rolled back; manual DB reconciliation needed: ${ap.error}`);
        await safeNotify(deps, `Autonomous closer: proposal #${c.id} applied on disk but status write failed — reconcile DB`, `The code change is live on disk and valid; the DB row was left un-rolled-back to avoid clobbering a good apply. Mark it 'applied' manually. error=${ap.error}`);
      } else {
        // Roll an approved-but-not-applied row back to needs_review. Conditional
        // (status='approved') so it won't clobber the 'failed'/'needs_review'
        // that safeApplyProposal sets on its own revert paths. Safe here because
        // every non-db-mark failure either never wrote the file or reverted it.
        try {
          await deps.rollback(c.id, tenantId);
        } catch (e: any) {
          console.error(`[autonomous-closer] rollback failed for #${c.id}: ${e?.message || e}`);
        }
        result.failed.push({ id: c.id, stage: ap.stage, error: ap.error });
        console.warn(`[autonomous-closer] apply FAILED #${c.id} at ${ap.stage}: ${ap.error}${ap.reverted ? " (reverted)" : ""}`);
        await safeNotify(deps, `Autonomous closer: apply failed on proposal #${c.id}`, `stage=${ap.stage} error=${ap.error} reverted=${ap.reverted}`);
      }
    } catch (e: any) {
      console.error(`[autonomous-closer] unexpected error on proposal #${c.id}: ${e?.message || e}`);
      result.failed.push({ id: c.id, stage: "unexpected", error: e?.message || String(e) });
    }
  }

  console.log(
    `[autonomous-closer] run complete: considered=${result.considered} applied=${result.applied.length} rejected=${result.rejected.length} escalated=${result.escalated.length} failed=${result.failed.length} dryRun=${dryRun}`,
  );
  return result;
}

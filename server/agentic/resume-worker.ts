import { db } from "../db";
import { agentRuns, agentApprovals } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { appendStep, failRun, completeRun } from "./runs";

import { logSilentCatch } from "../lib/silent-catch";
type Continuation = (decision: {
  approved: boolean;
  note?: string | null;
  decidedBy?: string | null;
  approvalId: number;
}) => Promise<void> | void;

interface RegisteredContinuation {
  fn: Continuation;
  registeredAt: number;
  maxAgeMs: number;
}

const continuations = new Map<number, RegisteredContinuation>();
let lastSweepLog = 0;
const DEFAULT_CONTINUATION_TTL_MS = 24 * 60 * 60 * 1000;

export function registerContinuation(runId: number, fn: Continuation, opts: { maxAgeMs?: number } = {}): void {
  continuations.set(runId, {
    fn,
    registeredAt: Date.now(),
    maxAgeMs: opts.maxAgeMs ?? DEFAULT_CONTINUATION_TTL_MS,
  });
}

export function unregisterContinuation(runId: number): void {
  continuations.delete(runId);
}

export function getContinuationCount(): number {
  return continuations.size;
}

function evictExpiredContinuations(): number {
  const now = Date.now();
  let evicted = 0;
  for (const [runId, entry] of continuations) {
    if (now - entry.registeredAt > entry.maxAgeMs) {
      continuations.delete(runId);
      evicted++;
    }
  }
  return evicted;
}

interface SweepResult {
  scanned: number;
  resumed: number;
  rejected: number;
  expired: number;
  orphaned: number;
  errors: number;
}

export async function resumePendingApprovalRuns(): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, resumed: 0, rejected: 0, expired: 0, orphaned: 0, errors: 0 };

  let candidates: any[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT
        r.id          AS run_id,
        r.tenant_id   AS tenant_id,
        r.status      AS run_status,
        r.state       AS run_state,
        a.id          AS approval_id,
        a.status      AS approval_status,
        a.decision    AS approval_decision,
        a.decided_by  AS decided_by,
        a.decided_at  AS decided_at
      FROM agent_runs r
      JOIN agent_approvals a
        ON a.id = NULLIF(r.state->>'pendingApprovalId', '')::int
       AND a.tenant_id = r.tenant_id
      WHERE r.state ? 'pendingApprovalId'
        AND r.state->>'pendingApprovalId' ~ '^[0-9]+$'
        AND a.status IN ('approved','rejected','expired')
      LIMIT 50
    `);
    candidates = (rows as any).rows || rows || [];
  } catch (err: any) {
    console.error("[resume-worker] candidate query failed:", err.message);
    return result;
  }

  result.scanned = candidates.length;
  const evicted = evictExpiredContinuations();
  if (candidates.length === 0) {
    if (evicted > 0) console.log(`[resume-worker] evicted ${evicted} stale continuation(s)`);
    return result;
  }

  for (const row of candidates) {
    const runId: number = row.run_id;
    const tenantId: number = row.tenant_id;
    const approvalId: number = row.approval_id;
    const approvalStatus: string = row.approval_status;
    const decision = row.approval_decision || {};
    const decidedBy: string | null = row.decided_by ?? null;
    const note: string | null = decision?.note ?? null;

    try {
      // CLAIM the row atomically: only proceed if pendingApprovalId still matches.
      // This prevents overlapping sweeps from firing the same continuation twice.
      const claim = await db.execute(sql`
        UPDATE agent_runs
        SET state = (COALESCE(state, '{}'::jsonb) - 'pendingApprovalId') ||
                    ${JSON.stringify({ resumedAt: new Date().toISOString(), lastApprovalId: approvalId, lastApprovalDecision: approvalStatus })}::jsonb,
            ${approvalStatus === "approved" ? sql`updated_at = NOW()` : sql`status = 'failed', error = ${approvalStatus === "rejected" ? `Approval ${approvalId} rejected by ${decidedBy ?? "owner"}${note ? `: ${note}` : ""}` : `Approval ${approvalId} expired before decision`}, completed_at = NOW(), updated_at = NOW()`}
        WHERE id = ${runId}
          AND tenant_id = ${tenantId}
          AND state ? 'pendingApprovalId'
          AND (state->>'pendingApprovalId')::int = ${approvalId}
        RETURNING id
      `);
      const claimed = ((claim as any).rows || claim || []).length > 0;
      if (!claimed) {
        // Another sweep already handled this row. Skip silently.
        continue;
      }

      if (approvalStatus === "approved") {
        await appendStep(runId, {
          at: new Date().toISOString(),
          step: `resume:approval_granted:${approvalId}`,
          status: "completed",
          detail: { approvalId, decidedBy, note },
        });

        const entry = continuations.get(runId);
        if (entry) {
          continuations.delete(runId);
          Promise.resolve()
            .then(() => entry.fn({ approved: true, note, decidedBy, approvalId }))
            .catch(async (err: any) => {
              console.error(`[resume-worker] continuation for run ${runId} threw:`, err.message);
              try {
                await failRun(runId, `Resume continuation failed: ${err.message?.slice(0, 400) || "unknown"}`);
              } catch (_silentErr) { logSilentCatch("server/agentic/resume-worker.ts", _silentErr); }
            });
          result.resumed++;
        } else {
          // Approved but no in-process continuation (process restart or supervisor died).
          // approvals.ts already flipped the run back to 'running' on approve — that's a lie now,
          // because nobody is executing it. Mark it failed with a recoverable signal so the owner
          // (or a future re-trigger) can act, instead of leaving it permanently 'running'.
          await appendStep(runId, {
            at: new Date().toISOString(),
            step: `resume:no_continuation`,
            status: "failed",
            detail: { approvalId, reason: "Process restarted between pause and approval; no in-memory continuation. Run marked failed-recoverable; owner may re-trigger from the run history." },
          });
          try {
            await failRun(runId, `Resume orphaned: approval ${approvalId} was approved but the original process is gone. Re-trigger from the caller.`);
          } catch (e: any) {
            console.error(`[resume-worker] failed to mark orphan run ${runId} failed:`, e.message);
          }
          result.orphaned++;
        }
      } else if (approvalStatus === "rejected") {
        await appendStep(runId, {
          at: new Date().toISOString(),
          step: `resume:approval_rejected:${approvalId}`,
          status: "failed",
          detail: { approvalId, decidedBy, note },
        });

        const entry = continuations.get(runId);
        if (entry) {
          continuations.delete(runId);
          Promise.resolve()
            .then(() => entry.fn({ approved: false, note, decidedBy, approvalId }))
            .catch((err: any) => console.error(`[resume-worker] reject continuation for run ${runId} threw:`, err.message));
        }
        result.rejected++;
      } else if (approvalStatus === "expired") {
        await appendStep(runId, {
          at: new Date().toISOString(),
          step: `resume:approval_expired:${approvalId}`,
          status: "failed",
          detail: { approvalId },
        });

        const entry = continuations.get(runId);
        if (entry) {
          continuations.delete(runId);
          Promise.resolve()
            .then(() => entry.fn({ approved: false, note: "expired", decidedBy: null, approvalId }))
            .catch(() => {});
        }
        result.expired++;
      }
    } catch (err: any) {
      console.error(`[resume-worker] failed handling run ${runId}/approval ${approvalId}:`, err.message);
      result.errors++;
    }
  }

  if (result.resumed + result.rejected + result.expired + result.orphaned > 0 || evicted > 0 || Date.now() - lastSweepLog > 10 * 60 * 1000) {
    console.log(`[resume-worker] sweep: scanned=${result.scanned} resumed=${result.resumed} rejected=${result.rejected} expired=${result.expired} orphaned=${result.orphaned} evicted=${evicted} errors=${result.errors} pending_continuations=${continuations.size}`);
    lastSweepLog = Date.now();
  }

  return result;
}

/**
 * Helper for runSupervisor specialists: pause the run for approval and await the
 * decision in-process. Returns the decision when the heartbeat sweep picks up
 * the approval.
 *
 * Usage inside a specialist handler:
 *   const { createApproval } = await import("./approvals");
 *   const approval = await createApproval({ tenantId, runId, question, context });
 *   const decision = await awaitApprovalDecision(runId, { timeoutMs: 60 * 60 * 1000 });
 *   if (!decision.approved) throw new Error("Owner rejected");
 *   // ... continue
 */
export function awaitApprovalDecision(
  runId: number,
  opts: { timeoutMs?: number } = {},
): Promise<{ approved: boolean; note?: string | null; decidedBy?: string | null; approvalId: number }> {
  const timeoutMs = opts.timeoutMs ?? 4 * 60 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      continuations.delete(runId);
      reject(new Error(`awaitApprovalDecision timed out after ${Math.round(timeoutMs / 1000)}s for run ${runId}`));
    }, timeoutMs);
    registerContinuation(runId, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });
  });
}

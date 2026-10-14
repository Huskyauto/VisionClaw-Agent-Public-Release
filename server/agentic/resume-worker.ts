import { db } from "../db";
import { agentRuns, agentApprovals } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { failRun } from "./runs";
import { randomUUID } from "node:crypto";
import { classifyResumeClaim, RESUME_LEASE_MS } from "../lib/resume-claim-recovery";
const RESUME_OWNER_ID = randomUUID();

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

async function recordResumeUncertainty(
  database: Pick<typeof db, "execute">,
  runId: number, tenantId: number, claimAt: string, leaseUntil: string | null,
): Promise<boolean> {
  const at = new Date().toISOString();
  const step = { at, step: "resume:claim_review_required", status: "started",
    detail: { reason: "Continuation liveness is uncertain; no action was replayed or stopped." } };
  const rows: any = await database.execute(sql`
    UPDATE agent_runs
    SET state = COALESCE(state, '{}'::jsonb) ||
          ${JSON.stringify({ restartRecovery: { requiresOwnerReview: true, executionUncertain: true, interruptedClaimAt: claimAt, observedAt: at, replayed: false } })}::jsonb,
        steps = COALESCE(steps, '[]'::jsonb) || ${JSON.stringify([step])}::jsonb,
        updated_at = NOW()
    WHERE id = ${runId} AND tenant_id = ${tenantId} AND status = 'running'
      AND state->>'resumeClaimedAt' = ${claimAt}
      AND state->>'resumeLeaseUntil' IS NOT DISTINCT FROM ${leaseUntil}
      AND state->'restartRecovery'->>'interruptedClaimAt' IS DISTINCT FROM ${claimAt}
    RETURNING id
  `);
  return ((rows.rows || rows || []) as any[]).length > 0;
}

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
  reviewRequired: number;
}

export async function resumePendingApprovalRuns(database: Pick<typeof db, "execute"> = db): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, resumed: 0, rejected: 0, expired: 0, orphaned: 0, errors: 0, reviewRequired: 0 };

  let candidates: any[] = [];
  const evicted = evictExpiredContinuations();
  const localContinuationIds = [...continuations.keys()];
  try {
    const rows = await database.execute(sql`
      SELECT
        r.id          AS run_id,
        r.tenant_id   AS tenant_id,
        r.status      AS run_status,
        r.state       AS run_state,
        r.state->>'resumeClaimedAt' AS resume_claimed_at,
        r.state->>'resumeLeaseUntil' AS resume_lease_until,
        r.state->>'resumeOwnerId' AS resume_owner_id,
        a.id          AS approval_id,
        a.status      AS approval_status,
        a.decision    AS approval_decision,
        a.decided_by  AS decided_by,
        a.decided_at  AS decided_at
      FROM agent_runs r
      LEFT JOIN agent_approvals a
        ON a.id = NULLIF(r.state->>'pendingApprovalId', '')::int
       AND a.tenant_id = r.tenant_id
       WHERE r.status IN ('running', 'paused') AND ((
        r.state ? 'pendingApprovalId'
        AND r.state->>'pendingApprovalId' ~ '^[0-9]+$'
        AND a.status IN ('approved','rejected','expired')
      ) OR (
        r.status = 'running'
        AND r.state ? 'resumeClaimedAt'
        AND (
          r.state->'restartRecovery'->>'interruptedClaimAt' IS DISTINCT FROM r.state->>'resumeClaimedAt'
          ${localContinuationIds.length ? sql`OR (
            r.state->>'resumeOwnerId' = ${RESUME_OWNER_ID}
            AND r.id IN (${sql.join(localContinuationIds.map(id => sql`${id}`), sql`, `)})
          )` : sql``}
        )
       ))
       ORDER BY CASE WHEN r.state ? 'pendingApprovalId' THEN 0 ELSE 1 END,
         COALESCE(r.state->>'resumeLeaseUntil', r.state->>'resumeClaimedAt', '') ASC
      LIMIT 50
    `);
    candidates = (rows as any).rows || rows || [];
  } catch (err: any) {
    console.error("[resume-worker] candidate query failed:", err.message);
    return result;
  }

  result.scanned = candidates.length;
  if (candidates.length === 0) {
    if (evicted > 0) console.log(`[resume-worker] evicted ${evicted} stale continuation(s)`);
    return result;
  }

  for (const row of candidates) {
    const runId: number = row.run_id;
    const tenantId: number = row.tenant_id;
    const resumeClaimedAt: string | null = row.resume_claimed_at ?? null;
    if (resumeClaimedAt) {
      // A live process retains the continuation until it settles. A process
      // restart loses that map entry. A stale lease is review evidence only:
      // another process may still be executing despite delayed heartbeats.
      const recovery = classifyResumeClaim({
        status: row.run_status,
        hasContinuation: continuations.has(runId),
        leaseUntil: row.resume_lease_until,
        claimedAt: resumeClaimedAt,
      });
      if (recovery === "skip" || recovery === "wait") continue;
      if (recovery === "live") {
        // Extend only this process's exact claim; no other worker can claim
        // liveness on its behalf. Five-minute idle heartbeats fit the lease.
        if (row.resume_owner_id === RESUME_OWNER_ID) {
          try {
            await database.execute(sql`
              UPDATE agent_runs
              SET state = state || ${JSON.stringify({ resumeLeaseUntil: new Date(Date.now() + RESUME_LEASE_MS).toISOString() })}::jsonb
              WHERE id = ${runId} AND tenant_id = ${tenantId} AND status = 'running'
                AND state->>'resumeClaimedAt' = ${resumeClaimedAt}
                AND state->>'resumeOwnerId' = ${RESUME_OWNER_ID}
            `);
          } catch (err) {
            console.error(`[resume-worker] lease refresh failed for run ${runId}`);
            result.errors++;
          }
        }
        continue;
      }
      try {
        if (await recordResumeUncertainty(database, runId, tenantId, resumeClaimedAt, row.resume_lease_until ?? null)) result.reviewRequired++;
      } catch (err: any) {
        console.error(`[resume-worker] failed recovering claimed run ${runId}:`, err.message);
        result.errors++;
      }
      continue;
    }
    const approvalId: number = row.approval_id;
    const approvalStatus: string = row.approval_status;
    if (approvalStatus === "approved" && !continuations.has(runId)) {
      // Do not steal an approval from its live in-process waiter. Once the
      // decision is old enough, preserve it for review without dispatching.
      const decidedAt = row.decided_at ? new Date(row.decided_at).getTime() : NaN;
      if (Number.isFinite(decidedAt) && Date.now() - decidedAt < RESUME_LEASE_MS) continue;
      try {
        const recovered: any = await database.execute(sql`
          UPDATE agent_runs
          SET status = 'paused',
              error = 'Approval received after worker interruption. Original request retained; review before re-triggering.',
              state = (COALESCE(state, '{}'::jsonb) - 'pendingApprovalId') ||
                ${JSON.stringify({ lastApprovalId: row.approval_id, lastApprovalDecision: "approved",
                  restartRecovery: { requiresOwnerReview: true, replayed: false, recoveredAt: new Date().toISOString() } })}::jsonb,
              steps = COALESCE(steps, '[]'::jsonb) || ${JSON.stringify([{
                at: new Date().toISOString(), step: "resume:approval_preserved", status: "failed",
                detail: { approvalId: row.approval_id, replayed: false },
              }])}::jsonb,
              completed_at = NULL, updated_at = NOW()
          WHERE id = ${runId} AND tenant_id = ${tenantId}
            AND status IN ('running', 'paused')
            AND state->>'pendingApprovalId' = ${String(row.approval_id)}
            AND EXISTS (
              SELECT 1 FROM agent_approvals a
              WHERE a.id = ${row.approval_id} AND a.tenant_id = ${tenantId} AND a.status = 'approved'
            )
          RETURNING id
        `);
        if (((recovered.rows || recovered || []) as any[]).length > 0) result.orphaned++;
      } catch (err) {
        console.error(`[resume-worker] interrupted approval preservation failed for run ${runId}`);
        result.errors++;
      }
      continue;
    }
    const decision = row.approval_decision || {};
    const decidedBy: string | null = row.decided_by ?? null;
    const note: string | null = decision?.note ?? null;
    const resumeStep = approvalStatus === "approved"
      ? {
        at: new Date().toISOString(),
        step: `resume:approval_granted:${approvalId}`,
        status: "completed",
        detail: { approvalId, decidedBy, note },
      }
      : approvalStatus === "rejected"
        ? {
          at: new Date().toISOString(),
          step: `resume:approval_rejected:${approvalId}`,
          status: "failed",
          detail: { approvalId, decidedBy, note },
        }
        : {
          at: new Date().toISOString(),
          step: `resume:approval_expired:${approvalId}`,
          status: "failed",
          detail: { approvalId },
        };

    try {
      const claimedAt = new Date().toISOString();
      const leaseUntil = new Date(Date.now() + RESUME_LEASE_MS).toISOString();
      // CLAIM the row atomically: only proceed if pendingApprovalId still matches.
      // This prevents overlapping sweeps from firing the same continuation twice.
      const claim = await database.execute(sql`
        UPDATE agent_runs
        SET state = (COALESCE(state, '{}'::jsonb) - 'pendingApprovalId') ||
                    ${JSON.stringify(
                      approvalStatus === "approved"
                         ? { resumedAt: claimedAt, resumeClaimedAt: claimedAt, resumeOwnerId: RESUME_OWNER_ID, resumeLeaseUntil: leaseUntil, lastApprovalId: approvalId, lastApprovalDecision: approvalStatus }
                        : { resumedAt: claimedAt, lastApprovalId: approvalId, lastApprovalDecision: approvalStatus },
                    )}::jsonb,
            steps = COALESCE(steps, '[]'::jsonb) || ${JSON.stringify([resumeStep])}::jsonb,
            ${approvalStatus === "approved" ? sql`updated_at = NOW()` : sql`status = 'failed', error = ${approvalStatus === "rejected" ? `Approval ${approvalId} rejected by ${decidedBy ?? "owner"}${note ? `: ${note}` : ""}` : `Approval ${approvalId} expired before decision`}, completed_at = NOW(), updated_at = NOW()`}
        WHERE id = ${runId}
          AND tenant_id = ${tenantId}
          AND status IN ('running', 'paused')
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
        const entry = continuations.get(runId);
        if (entry) {
          void (async () => {
            try {
              await entry.fn({ approved: true, note, decidedBy, approvalId });
              // The resolver only hands the decision back to the supervisor;
              // its resumed work happens after this promise resolves. Keep the
              // durable marker and in-process continuation until completeRun
              // or failRun clears the marker. A process restart loses the map,
              // making the marker eligible for nonterminal review evidence;
              // lease expiry cannot prove a remote executor stopped.
              result.resumed++;
            } catch (err: any) {
              console.error(`[resume-worker] continuation for run ${runId} threw:`, err.message);
              try {
                await failRun(runId, tenantId, `Resume continuation failed: ${err.message?.slice(0, 400) || "unknown"}`);
              } catch (failErr: any) {
                console.error(`[resume-worker] failed to persist continuation failure for run ${runId}:`, failErr.message);
                result.errors++;
              }
              continuations.delete(runId);
            }
          })();
        } else {
          // The local continuation disappeared while this exact claim was
          // being persisted. Record uncertainty, not a terminal verdict/replay.
          try {
            if (await recordResumeUncertainty(database, runId, tenantId, claimedAt, leaseUntil)) result.reviewRequired++;
          } catch (e: any) {
            console.error(`[resume-worker] failed to record uncertainty for run ${runId}:`, e.message);
            result.errors++;
          }
        }
      } else if (approvalStatus === "rejected") {
        const entry = continuations.get(runId);
        if (entry) {
          continuations.delete(runId);
          Promise.resolve()
            .then(() => entry.fn({ approved: false, note, decidedBy, approvalId }))
            .catch((err: any) => console.error(`[resume-worker] reject continuation for run ${runId} threw:`, err.message));
        }
        result.rejected++;
      } else if (approvalStatus === "expired") {
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

  if (result.resumed + result.rejected + result.expired + result.orphaned + result.reviewRequired > 0 || evicted > 0 || Date.now() - lastSweepLog > 10 * 60 * 1000) {
    console.log(`[resume-worker] sweep: scanned=${result.scanned} resumed=${result.resumed} rejected=${result.rejected} expired=${result.expired} orphaned=${result.orphaned} reviewRequired=${result.reviewRequired} evicted=${evicted} errors=${result.errors} pending_continuations=${continuations.size}`);
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

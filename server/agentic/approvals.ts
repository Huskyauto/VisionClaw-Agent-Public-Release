import { db } from "../db";
import { agentApprovals, agentRuns } from "@shared/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { renderFailureContract } from "./failure-contract";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface CreateApprovalParams {
  tenantId: number;
  runId?: number | null;
  requestedBy?: string | null;
  question: string;
  context?: any;
  ttlHours?: number;
}

export async function createApproval(params: CreateApprovalParams) {
  const ttlHours = params.ttlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  let validRunId: number | null = null;
  if (params.runId) {
    const [run] = await db.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.id, params.runId), eq(agentRuns.tenantId, params.tenantId)))
      .limit(1);
    if (!run) {
      throw new Error(`Run ${params.runId} not found for tenant ${params.tenantId} — cannot create approval`);
    }
    validRunId = run.id;
  }

  const [row] = await db.insert(agentApprovals).values({
    tenantId: params.tenantId,
    runId: validRunId,
    requestedBy: params.requestedBy ?? null,
    question: params.question,
    context: params.context ?? {},
    status: "pending",
    expiresAt,
  }).returning();

  if (validRunId) {
    await db.update(agentRuns).set({
      status: "paused",
      state: sql`COALESCE(${agentRuns.state}, '{}'::jsonb) || ${JSON.stringify({ pendingApprovalId: row.id, pausedAt: new Date().toISOString() })}::jsonb`,
      updatedAt: new Date(),
    }).where(and(eq(agentRuns.id, validRunId), eq(agentRuns.tenantId, params.tenantId)));
  }
  return row;
}

export async function decideApproval(params: {
  approvalId: number;
  tenantId: number;
  approved: boolean;
  decidedBy?: string;
  note?: string;
}) {
  const [row] = await db.update(agentApprovals).set({
    status: params.approved ? "approved" : "rejected",
    decision: { approved: params.approved, note: params.note ?? null },
    decidedBy: params.decidedBy ?? null,
    decidedAt: new Date(),
  }).where(and(
    eq(agentApprovals.id, params.approvalId),
    eq(agentApprovals.tenantId, params.tenantId),
    eq(agentApprovals.status, "pending"),
  )).returning();

  if (row?.runId) {
    if (params.approved) {
      await db.update(agentRuns).set({
        status: "running",
        error: null,
        updatedAt: new Date(),
      }).where(and(eq(agentRuns.id, row.runId), eq(agentRuns.tenantId, params.tenantId)));
    } else {
      // Rejection is a terminal failure. Instead of a bare operator error string,
      // emit a structured failure contract so the user gets a clean last-mile
      // answer (what completed / what failed / what exists / next step) rather
      // than a dead-end "Rejected by user" line. NOTE: we do NOT auto-route around
      // the rejected gate — that would weaken the approval control. We only make
      // the already-decided rejection legible.
      const contract = renderFailureContract({
        reason: "approval_rejected",
        failed: {
          what: `the action that needed your approval${row.question ? ` ("${row.question}")` : ""}`,
          why: `you declined it${params.note ? ` — ${params.note}` : ""}`,
        },
        nextStep:
          "Re-run the request with adjusted instructions if you want a different approach, or approve the action if you change your mind.",
        nextStepOwner: "user",
      });
      await db.update(agentRuns).set({
        status: "failed",
        error: contract.text,
        result: sql`COALESCE(${agentRuns.result}, '{}'::jsonb) || ${JSON.stringify({ failureContract: contract.meta })}::jsonb`,
        updatedAt: new Date(),
      }).where(and(eq(agentRuns.id, row.runId), eq(agentRuns.tenantId, params.tenantId)));
    }
  }
  return row;
}

export async function listPendingApprovals(tenantId: number, limit = 50) {
  return db.select().from(agentApprovals)
    .where(and(
      eq(agentApprovals.tenantId, tenantId),
      eq(agentApprovals.status, "pending"),
    ))
    .orderBy(desc(agentApprovals.requestedAt))
    .limit(limit);
}

export async function getApproval(approvalId: number, tenantId: number) {
  const [row] = await db.select().from(agentApprovals)
    .where(and(eq(agentApprovals.id, approvalId), eq(agentApprovals.tenantId, tenantId)))
    .limit(1);
  return row;
}

export async function expireStaleApprovals(): Promise<number> {
  const result = await db.update(agentApprovals).set({
    status: "expired",
    decidedAt: new Date(),
  }).where(and(
    eq(agentApprovals.status, "pending"),
    lt(agentApprovals.expiresAt, new Date()),
  )).returning({ id: agentApprovals.id, runId: agentApprovals.runId, tenantId: agentApprovals.tenantId });

  // Per-row try/catch: the bulk expiry above already committed, so one failed
  // run-status update must NOT abort the sweep and leave the remaining runs
  // un-failed (silent state divergence — approvals expired but runs left
  // "running"). Log loudly so a partial failure is visible within 5 min.
  // Render the terminal failure contract ONCE — the expiry text is identical
  // across rows (the per-row question isn't selected here), so the structured
  // block is reused for every linked run.
  const expiredContract = renderFailureContract({
    reason: "approval_expired",
    failed: {
      what: "an action that needed your approval",
      why: "the approval request expired before a decision was made",
    },
    nextStep: "Re-run the request to get a fresh approval prompt if you still want it done.",
    nextStepOwner: "user",
  });

  let runsAttempted = 0;
  let runsFailedToUpdate = 0;
  for (const r of result) {
    if (!r.runId) continue;
    runsAttempted++;
    try {
      await db.update(agentRuns).set({
        status: "failed",
        error: expiredContract.text,
        result: sql`COALESCE(${agentRuns.result}, '{}'::jsonb) || ${JSON.stringify({ failureContract: expiredContract.meta })}::jsonb`,
        updatedAt: new Date(),
      }).where(and(eq(agentRuns.id, r.runId), eq(agentRuns.tenantId, r.tenantId)));
    } catch (err) {
      runsFailedToUpdate++;
      console.error(`[approvals] expireStaleApprovals: failed to mark run ${r.runId} (tenant ${r.tenantId}) failed after approval expiry:`, err);
    }
  }
  if (runsFailedToUpdate > 0) {
    console.error(`[approvals] expireStaleApprovals: ${runsFailedToUpdate}/${result.length} linked run update(s) failed — those runs may be stuck "running" while their approval is expired; reconcile manually.`);
  }
  // Systemic breakage (e.g. DB unavailable): every attempted run update failed.
  // Surface to the cron caller (heartbeat) instead of returning apparent
  // success — its try/catch logs the sweep failure. The bulk expiry above
  // already committed, so the count is preserved in logs above; throwing here
  // distinguishes "DB down" from a transient single-row failure.
  if (runsAttempted > 0 && runsFailedToUpdate === runsAttempted) {
    throw new Error(`expireStaleApprovals: all ${runsAttempted} linked run update(s) failed — systemic failure suspected; ${result.length} approval(s) expired but their runs are left un-failed`);
  }
  return result.length;
}

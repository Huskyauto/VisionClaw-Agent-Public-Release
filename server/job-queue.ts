// R60 — Durable agent job queue.
//
// Single table (`agent_jobs`), atomic lease-based claim, exponential backoff,
// dead-letter after maxAttempts. Every async agentic action in the system
// should eventually flow through this queue so that:
//   - Process restart mid-flight recovers via expired-lease reclaim, not loss.
//   - Retries are first-class (no bespoke .catch(log) per subsystem).
//   - The operator inbox has one place to see "what is the system doing".
//
// Call sites use `enqueueJob(kind, payload, opts)` to schedule work.
// Handlers are registered via `registerJobHandler(kind, fn)` in job-worker.ts.
//
// No new drizzle types — raw SQL per the standing "don't touch shared/schema.ts
// without approval" rule. Type shapes live in this file.
import { db } from "./db";
import { sql } from "drizzle-orm";

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "failed_terminal"
  | "cancelled";

export interface AgentJob {
  id: number;
  kind: string;
  payload: Record<string, any>;
  tenantId: number | null;
  personaId: number | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  leaseUntil: Date | null;
  nextRunAt: Date;
  parentJobId: number | null;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface EnqueueOpts {
  tenantId?: number | null;
  personaId?: number | null;
  maxAttempts?: number;
  /** Defer first run by N ms (default: now). */
  delayMs?: number;
  /** Link this job to its originator for lineage/chaining. */
  parentJobId?: number | null;
}

/**
 * Enqueue a new job. Returns the new job id.
 *
 * Jobs are durable: once enqueued, they survive process restarts. Handlers
 * for `kind` must be registered in job-worker.ts before the job runs.
 */
export async function enqueueJob(
  kind: string,
  payload: Record<string, any>,
  opts: EnqueueOpts = {},
): Promise<number> {
  const {
    tenantId = null,
    personaId = null,
    maxAttempts = 3,
    delayMs = 0,
    parentJobId = null,
  } = opts;
  const nextRunAt = new Date(Date.now() + delayMs);
  const [row] = await db.execute<{ id: number }>(sql`
    INSERT INTO agent_jobs (kind, payload, tenant_id, persona_id, max_attempts, next_run_at, parent_job_id)
    VALUES (${kind}, ${JSON.stringify(payload)}::jsonb, ${tenantId}, ${personaId}, ${maxAttempts}, ${nextRunAt}, ${parentJobId})
    RETURNING id
  `).then((r: any) => r.rows || r);
  return (row as any).id;
}

/**
 * Atomically claim up to `limit` due jobs. Sets status='running' and takes
 * a lease_until `leaseMs` in the future. Workers must complete or fail each
 * claimed job before its lease expires, or reclaim() will re-queue it.
 *
 * The atomic UPDATE ... SELECT FOR UPDATE SKIP LOCKED pattern ensures two
 * workers can never claim the same row.
 */
export async function claimDueJobs(
  limit: number,
  leaseMs: number,
): Promise<AgentJob[]> {
  const leaseUntil = new Date(Date.now() + leaseMs);
  const result: any = await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'running',
        attempts = attempts + 1,
        started_at = COALESCE(started_at, NOW()),
        lease_until = ${leaseUntil}
    WHERE id IN (
      SELECT id FROM agent_jobs
      WHERE status = 'pending'
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, tenant_id, persona_id, status, attempts, max_attempts,
              lease_until, next_run_at, parent_job_id, result, error,
              created_at, started_at, completed_at
  `);
  const rows = (result.rows || result) as any[];
  return rows.map(rowToJob);
}

/**
 * Reclaim jobs whose lease has expired (worker crashed mid-flight, OR a
 * handler running longer than the lease). Two-pass:
 *   1. Any expired-lease row that has ALREADY hit max_attempts goes directly
 *      to failed_terminal (no more retries earned).
 *   2. Remaining expired rows go back to pending with a 30s cooldown (not
 *      immediate) to prevent thrash: if a handler is legitimately slow, the
 *      worker shouldn't hot-spin re-claiming the same row on every tick.
 *
 * Returns the total number of rows touched.
 */
export async function reclaimExpiredLeases(): Promise<number> {
  const cooldown = new Date(Date.now() + 30_000);
  // Step 1: terminal for out-of-budget jobs.
  const terminal: any = await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'failed_terminal',
        error = COALESCE(error, '') || ' [reclaimed after exceeding max_attempts]',
        completed_at = NOW(),
        lease_until = NULL
    WHERE status = 'running'
      AND lease_until IS NOT NULL
      AND lease_until < NOW()
      AND attempts >= max_attempts
    RETURNING id
  `);
  // Step 2: remaining expired rows back to pending with 30s backoff.
  const requeued: any = await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'pending',
        lease_until = NULL,
        next_run_at = ${cooldown}
    WHERE status = 'running'
      AND lease_until IS NOT NULL
      AND lease_until < NOW()
    RETURNING id
  `);
  const terminalRows = (terminal.rows || terminal) as any[];
  const requeuedRows = (requeued.rows || requeued) as any[];
  return terminalRows.length + requeuedRows.length;
}

/**
 * Mark a job as successfully completed. Persists the result for operator
 * inspection and audit trails.
 *
 * LEASE FENCING: the `attempts` guard ensures that if a slow worker's lease
 * expired and the job was reclaimed on a new attempt, the slow worker's
 * belated completeJob call is a no-op (its `attempts` value is stale).
 * This prevents the stale-writer-overwrites-fresh-attempt race.
 */
export async function completeJob(
  id: number,
  attempts: number,
  result: Record<string, any> | null = null,
): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'succeeded',
        result = ${result ? JSON.stringify(result) : null}::jsonb,
        completed_at = NOW(),
        lease_until = NULL
    WHERE id = ${id}
      AND status = 'running'
      AND attempts = ${attempts}
  `);
}

/**
 * Mark a job as failed. If attempts < maxAttempts, reschedules with
 * exponential backoff (base 30s, cap 1h). Otherwise marks failed_terminal
 * for the dead-letter queue.
 *
 * LEASE FENCING: same guard as completeJob — only the worker holding the
 * current attempt can write failure state.
 */
export async function failJob(
  id: number,
  attempts: number,
  errorMsg: string,
): Promise<void> {
  // Look up max_attempts to decide retry vs terminal. The `attempts` we
  // check/write against is the caller-supplied one (from claim time), not
  // a re-read, to keep the fencing invariant tight.
  const [row]: any = await db.execute(sql`
    SELECT max_attempts FROM agent_jobs WHERE id = ${id}
  `).then((r: any) => r.rows || r);
  const maxAttempts = (row as any)?.max_attempts ?? 3;

  if (attempts >= maxAttempts) {
    await db.execute(sql`
      UPDATE agent_jobs
      SET status = 'failed_terminal',
          error = ${errorMsg},
          completed_at = NOW(),
          lease_until = NULL
      WHERE id = ${id}
        AND status = 'running'
        AND attempts = ${attempts}
    `);
    return;
  }

  // Exponential backoff: 30s, 2m, 8m, 32m, capped at 1h.
  const backoffMs = Math.min(30_000 * Math.pow(4, attempts - 1), 60 * 60 * 1000);
  const nextRunAt = new Date(Date.now() + backoffMs);
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'pending',
        error = ${errorMsg},
        next_run_at = ${nextRunAt},
        lease_until = NULL
    WHERE id = ${id}
      AND status = 'running'
      AND attempts = ${attempts}
  `);
}

/** Operator: cancel a pending or running job. Running jobs' handlers will
 *  still complete — cancellation only prevents future retries. */
export async function cancelJob(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'cancelled', completed_at = NOW()
    WHERE id = ${id} AND status IN ('pending','running','failed')
  `);
}

/** Operator: manually retry a terminal/failed job (resets attempts). */
export async function retryJob(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'pending',
        attempts = 0,
        next_run_at = NOW(),
        error = NULL,
        lease_until = NULL,
        completed_at = NULL
    WHERE id = ${id} AND status IN ('failed','failed_terminal','cancelled','succeeded')
  `);
}

export interface ListJobsFilter {
  status?: JobStatus | JobStatus[];
  kind?: string;
  tenantId?: number;
  limit?: number;
  offset?: number;
}

/** Operator: list jobs filtered by status/kind/tenant. */
export async function listJobs(filter: ListJobsFilter = {}): Promise<AgentJob[]> {
  const { status, kind, tenantId, limit = 100, offset = 0 } = filter;
  const statuses = Array.isArray(status) ? status : status ? [status] : null;

  // Build WHERE conditions using drizzle sql template joining.
  const conditions: any[] = [];
  if (statuses && statuses.length) conditions.push(sql`status = ANY(${statuses})`);
  if (kind) conditions.push(sql`kind = ${kind}`);
  if (tenantId) conditions.push(sql`tenant_id = ${tenantId}`);

  const whereClause = conditions.length
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const result: any = await db.execute(sql`
    SELECT id, kind, payload, tenant_id, persona_id, status, attempts, max_attempts,
           lease_until, next_run_at, parent_job_id, result, error,
           created_at, started_at, completed_at
    FROM agent_jobs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const rows = (result.rows || result) as any[];
  return rows.map(rowToJob);
}

/**
 * R113.3 — Paperclip nugget #3: budget cascade auto-cancel.
 *
 * When a tenant breaches a hard budget (daily_spend critical), the supervisor
 * circuit breaker (server/agentic/executor.ts) aborts active runs at the next
 * turn — but PENDING rows in agent_jobs keep waiting in queue. They'll fail
 * one-by-one when each tries to start, but that wastes lease churn and
 * obscures the audit trail.
 *
 * This helper does a bulk transition pending → cancelled, tenant-scoped, with
 * a reason string written to the `error` column. Idempotent and safe to call
 * repeatedly. Returns the row count cancelled. Does NOT touch `running` rows
 * (let the supervisor's own circuit breaker handle those — it has the spend
 * context). Does NOT touch `failed_terminal` / `succeeded` / `cancelled`.
 *
 * `excludeKinds` lets the caller protect critical infrastructure jobs
 * (e.g. process_governance heartbeats, security scans) from being swept.
 */
export async function cancelPendingJobsForTenant(
  tenantId: number,
  reason: string,
  opts: { excludeKinds?: string[] } = {},
): Promise<{ cancelled: number }> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("cancelPendingJobsForTenant: tenantId must be a positive integer");
  }
  const safeReason = String(reason || "cancelled by governor")
    .replace(/\u0000/g, "")
    .slice(0, 400);
  const exclude = (opts.excludeKinds || [])
    .map(k => String(k).replace(/\u0000/g, "").slice(0, 100))
    .filter(s => s.length > 0);

  // Build exclusion clause as a parameterized array (NEVER sql.raw with user input).
  const excludeLiteral = exclude.length > 0
    ? `{${exclude.map(k => `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
    : null;

  const result: any = await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'cancelled',
        completed_at = NOW(),
        error = ${safeReason}
    WHERE tenant_id = ${tenantId}
      AND status = 'pending'
      AND (${excludeLiteral}::text[] IS NULL OR kind <> ALL(${excludeLiteral}::text[]))
  `);
  return { cancelled: Number(result.rowCount ?? 0) };
}

/** Operator: aggregate counts for the dashboard header. */
export async function getJobStats(): Promise<Record<JobStatus, number> & { total: number }> {
  const result: any = await db.execute(sql`
    SELECT status, COUNT(*)::int AS count
    FROM agent_jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY status
  `);
  const rows = (result.rows || result) as any[];
  const stats: any = {
    pending: 0, running: 0, succeeded: 0, failed: 0,
    failed_terminal: 0, cancelled: 0, total: 0,
  };
  for (const r of rows) {
    stats[r.status as JobStatus] = Number(r.count);
    stats.total += Number(r.count);
  }
  return stats;
}

function rowToJob(r: any): AgentJob {
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    tenantId: r.tenant_id ?? null,
    personaId: r.persona_id ?? null,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    leaseUntil: r.lease_until ? new Date(r.lease_until) : null,
    nextRunAt: new Date(r.next_run_at),
    parentJobId: r.parent_job_id ?? null,
    result: r.result ?? null,
    error: r.error ?? null,
    createdAt: new Date(r.created_at),
    startedAt: r.started_at ? new Date(r.started_at) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
  };
}

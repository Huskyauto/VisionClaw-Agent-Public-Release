/**
 * R106 Nugget #2 — Parallel Findings Bulletin Board (LuaN1aoAgent, Apache-2.0).
 *
 * Sibling parallel subtasks (chunk-and-parallel jobs spawned via
 * scripts/lib/parallel-build.ts and startAsyncSubagent) share high-confidence
 * findings mid-flight via this append-only bulletin board, instead of waiting
 * until stitch time. A subtask publishes once it discovers something useful
 * (a working fix, a confirmed format, a brand asset that loaded clean) and
 * other in-flight chunks see it on their next read.
 *
 * Tenant-isolated. No FK on job_id (jobs are ephemeral, no jobs table).
 * Append-only (no UPDATE/DELETE in the API surface).
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface FindingRow {
  id: number;
  jobId: string;
  subtaskId: string;
  finding: any;
  confidence: number;
  slotKey?: string | null;
  createdAt: Date;
}

export async function publishFinding(opts: {
  tenantId: number;
  jobId: string;
  subtaskId: string;
  finding: any;
  confidence?: number;
  /** When set, this is a KEYED blackboard slot (latest-wins reads) rather than
   * an append-only discovery. Siblings read it via readSlot/readBoard. */
  slotKey?: string;
}): Promise<FindingRow> {
  const conf = typeof opts.confidence === "number" ? Math.max(0, Math.min(1, opts.confidence)) : 0.7;
  const slotKey = opts.slotKey ? String(opts.slotKey).slice(0, 200) : null;
  const r = await db.execute(sql`
    INSERT INTO parallel_job_findings (tenant_id, job_id, subtask_id, finding, confidence, slot_key)
    VALUES (${opts.tenantId}, ${opts.jobId}, ${opts.subtaskId},
            ${JSON.stringify(opts.finding)}::jsonb, ${conf}, ${slotKey})
    RETURNING id, created_at
  `);
  const row = ((r as any).rows ?? r)[0];
  return {
    id: Number(row.id),
    jobId: opts.jobId,
    subtaskId: opts.subtaskId,
    finding: opts.finding,
    confidence: conf,
    slotKey,
    createdAt: row.created_at,
  };
}

/* ──────── R125+15 — Blackboard slot semantics (TigrimOSR-inspired) ────────
 * The findings bus is an append-only DISCOVERY log ("I found X, broadcast it").
 * A blackboard adds KEYED SHARED STATE: named slots with latest-wins reads
 * ("what is the current `outline`?") plus atomic CLAIMs for division-of-labor
 * ("I'm taking section 3 — no sibling should duplicate it"). Both ride the same
 * tenant-isolated parallel_job_findings table; slots are rows with slot_key set.
 */

export interface SlotRow {
  slotKey: string;
  value: any;
  postedBy: string;
  updatedAt: Date;
}

/** Read the latest value for every distinct slot on a job (the whole board). */
export async function readBoard(opts: {
  tenantId: number;
  jobId: string;
}): Promise<SlotRow[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT ON (slot_key) slot_key, finding, subtask_id, created_at
    FROM parallel_job_findings
    WHERE tenant_id = ${opts.tenantId}
      AND job_id = ${opts.jobId}
      AND slot_key IS NOT NULL
      AND claim = false
    ORDER BY slot_key, id DESC
  `);
  return ((r as any).rows ?? r).map((row: any) => ({
    slotKey: row.slot_key,
    value: row.finding,
    postedBy: row.subtask_id,
    updatedAt: row.created_at,
  }));
}

/** Read the latest value for a single slot, or null if unset. */
export async function readSlot(opts: {
  tenantId: number;
  jobId: string;
  slotKey: string;
}): Promise<SlotRow | null> {
  const r = await db.execute(sql`
    SELECT slot_key, finding, subtask_id, created_at
    FROM parallel_job_findings
    WHERE tenant_id = ${opts.tenantId}
      AND job_id = ${opts.jobId}
      AND slot_key = ${String(opts.slotKey).slice(0, 200)}
      AND claim = false
    ORDER BY id DESC LIMIT 1
  `);
  const row = ((r as any).rows ?? r)[0];
  if (!row) return null;
  return { slotKey: row.slot_key, value: row.finding, postedBy: row.subtask_id, updatedAt: row.created_at };
}

/** Atomically claim a slot for division-of-labor. Returns {won:true} for the
 * first caller, {won:false, owner} for everyone after. Backed by the partial
 * unique index idx_pjf_claim (one claim row per tenant+job+slot). */
export async function claimSlot(opts: {
  tenantId: number;
  jobId: string;
  subtaskId: string;
  slotKey: string;
}): Promise<{ won: boolean; owner: string }> {
  const slotKey = String(opts.slotKey).slice(0, 200);
  const r = await db.execute(sql`
    INSERT INTO parallel_job_findings (tenant_id, job_id, subtask_id, finding, confidence, slot_key, claim)
    VALUES (${opts.tenantId}, ${opts.jobId}, ${opts.subtaskId},
            ${JSON.stringify({ claimedBy: opts.subtaskId })}::jsonb, 1, ${slotKey}, true)
    ON CONFLICT (tenant_id, job_id, slot_key) WHERE claim = true DO NOTHING
    RETURNING id
  `);
  const won = (((r as any).rows ?? r).length ?? 0) > 0;
  if (won) return { won: true, owner: opts.subtaskId };
  const cur = await db.execute(sql`
    SELECT subtask_id FROM parallel_job_findings
    WHERE tenant_id = ${opts.tenantId} AND job_id = ${opts.jobId}
      AND slot_key = ${slotKey} AND claim = true
    LIMIT 1
  `);
  const owner = ((cur as any).rows ?? cur)[0]?.subtask_id ?? "unknown";
  return { won: false, owner };
}

/**
 * Read findings posted to a job by SIBLING subtasks (excluding the caller's
 * own postings). Cursor semantics: if `sinceId` is provided, only returns
 * findings with id > sinceId. Default min confidence 0.6 — low-confidence
 * scratch should not pollute siblings' decision contexts.
 */
export async function readFindings(opts: {
  tenantId: number;
  jobId: string;
  callerSubtaskId?: string;
  sinceId?: number;
  minConfidence?: number;
  limit?: number;
}): Promise<FindingRow[]> {
  const minConf = opts.minConfidence ?? 0.6;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const sinceId = opts.sinceId ?? 0;
  const callerExclusion = opts.callerSubtaskId
    ? sql`AND subtask_id <> ${opts.callerSubtaskId}`
    : sql``;
  const r = await db.execute(sql`
    SELECT id, job_id, subtask_id, finding, confidence, slot_key, created_at
    FROM parallel_job_findings
    WHERE tenant_id = ${opts.tenantId}
      AND job_id = ${opts.jobId}
      AND id > ${sinceId}
      AND confidence >= ${minConf}
      AND claim = false
      ${callerExclusion}
    ORDER BY id ASC LIMIT ${limit}
  `);
  return ((r as any).rows ?? r).map((row: any) => ({
    id: Number(row.id),
    jobId: row.job_id,
    subtaskId: row.subtask_id,
    finding: row.finding,
    confidence: Number(row.confidence),
    slotKey: row.slot_key,
    createdAt: row.created_at,
  }));
}

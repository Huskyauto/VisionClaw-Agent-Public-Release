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
  createdAt: Date;
}

export async function publishFinding(opts: {
  tenantId: number;
  jobId: string;
  subtaskId: string;
  finding: any;
  confidence?: number;
}): Promise<FindingRow> {
  const conf = typeof opts.confidence === "number" ? Math.max(0, Math.min(1, opts.confidence)) : 0.7;
  const r = await db.execute(sql`
    INSERT INTO parallel_job_findings (tenant_id, job_id, subtask_id, finding, confidence)
    VALUES (${opts.tenantId}, ${opts.jobId}, ${opts.subtaskId},
            ${JSON.stringify(opts.finding)}::jsonb, ${conf})
    RETURNING id, created_at
  `);
  const row = ((r as any).rows ?? r)[0];
  return {
    id: Number(row.id),
    jobId: opts.jobId,
    subtaskId: opts.subtaskId,
    finding: opts.finding,
    confidence: conf,
    createdAt: row.created_at,
  };
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
    SELECT id, job_id, subtask_id, finding, confidence, created_at
    FROM parallel_job_findings
    WHERE tenant_id = ${opts.tenantId}
      AND job_id = ${opts.jobId}
      AND id > ${sinceId}
      AND confidence >= ${minConf}
      ${callerExclusion}
    ORDER BY id ASC LIMIT ${limit}
  `);
  return ((r as any).rows ?? r).map((row: any) => ({
    id: Number(row.id),
    jobId: row.job_id,
    subtaskId: row.subtask_id,
    finding: row.finding,
    confidence: Number(row.confidence),
    createdAt: row.created_at,
  }));
}

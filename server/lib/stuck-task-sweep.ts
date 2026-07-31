// R113.3 — Stuck-task sweeper (Paperclip nugget #2).
//
// Paperclip's `doc/execution-semantics.md` formalizes a useful invariant:
// "for agent-owned issues, `in_progress` should not be allowed to become a
// silent dead state." VisionClaw already has lease reclaim on agent_jobs (R60),
// the 30-min commitments scanner (R104), and restart-time orphan detection on
// video_jobs — but agent_runs (status='running') and mind_tickets
// (status='in_progress') have no aggregate sweeper. A run that crashed
// mid-flight or a ticket whose worker died can sit indefinitely.
//
// This module is a READ-ONLY audit. It surfaces stuck rows so weekly-
// maintenance Pass 9 can flag them. Auto-remediation is deliberately not
// included — the right action (force-fail vs blocked vs retry) is row-specific
// and we'd rather a human or a downstream skill decide.

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface StuckRow {
  table: string;
  id: number | string;
  tenantId: number | null;
  status: string;
  stuckHours: number;
  detail?: string;
}

export interface StuckSweepResult {
  ranAt: string;
  thresholdHours: number;
  totals: { agent_runs: number; mind_tickets: number };
  rows: StuckRow[];
  errors: Array<{ table: string; error: string }>;
}

/**
 * Audit agent_runs and mind_tickets for rows in active states that have not
 * advanced in `thresholdHours`. Read-only. Returns up to `maxRowsPerTable`
 * findings per table to keep the report bounded.
 *
 * Resilient to missing tables (mind_tickets lives in schema-orphans and may
 * not exist in every environment) — a missing table is logged in `errors`
 * rather than thrown.
 */
export async function sweepStuckTasks(
  opts: { thresholdHours?: number; maxRowsPerTable?: number } = {},
): Promise<StuckSweepResult> {
  const thresholdHours = opts.thresholdHours ?? 24;
  const maxRowsPerTable = Math.max(1, Math.min(50, opts.maxRowsPerTable ?? 10));
  const rows: StuckRow[] = [];
  const errors: Array<{ table: string; error: string }> = [];
  const totals = { agent_runs: 0, mind_tickets: 0 };

  // agent_runs: status='running' with no updatedAt advance in N hours.
  try {
    const r: any = await db.execute(sql`
      SELECT id, tenant_id, status, run_type,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600.0 AS stuck_hours
      FROM agent_runs
      WHERE status = 'running'
        AND updated_at < NOW() - (${thresholdHours} || ' hours')::interval
      ORDER BY updated_at ASC
      LIMIT ${maxRowsPerTable + 1}
    `);
    const list = (r.rows || r) as any[];
    totals.agent_runs = list.length;
    for (const row of list.slice(0, maxRowsPerTable)) {
      rows.push({
        table: "agent_runs",
        id: Number(row.id),
        tenantId: row.tenant_id != null ? Number(row.tenant_id) : null,
        status: String(row.status),
        stuckHours: Math.round(Number(row.stuck_hours) * 10) / 10,
        detail: row.run_type ? `run_type=${row.run_type}` : undefined,
      });
    }
  } catch (e: any) {
    errors.push({ table: "agent_runs", error: (e?.message ?? String(e)).slice(0, 200) });
  }

  // mind_tickets: status='in_progress' with no updatedAt advance in N hours.
  // Table is in schema-orphans — may not exist everywhere. Catch + log.
  try {
    const r: any = await db.execute(sql`
      SELECT id, tenant_id, status, assigned_agent_id,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600.0 AS stuck_hours
      FROM mind_tickets
      WHERE status = 'in_progress'
        AND updated_at < NOW() - (${thresholdHours} || ' hours')::interval
      ORDER BY updated_at ASC
      LIMIT ${maxRowsPerTable + 1}
    `);
    const list = (r.rows || r) as any[];
    totals.mind_tickets = list.length;
    for (const row of list.slice(0, maxRowsPerTable)) {
      rows.push({
        table: "mind_tickets",
        id: Number(row.id),
        tenantId: row.tenant_id != null ? Number(row.tenant_id) : null,
        status: String(row.status),
        stuckHours: Math.round(Number(row.stuck_hours) * 10) / 10,
        detail: row.assigned_agent_id ? `agent=${row.assigned_agent_id}` : undefined,
      });
    }
  } catch (e: any) {
    const msg = (e?.message ?? String(e)).slice(0, 200);
    // Missing-table is informational, not an error
    if (/relation .* does not exist|does not exist/i.test(msg)) {
      errors.push({ table: "mind_tickets", error: "table not present in this environment (informational)" });
    } else {
      errors.push({ table: "mind_tickets", error: msg });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    thresholdHours,
    totals,
    rows,
    errors,
  };
}

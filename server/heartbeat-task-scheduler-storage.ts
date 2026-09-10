import { sql } from "drizzle-orm";
import type { HeartbeatTask } from "@shared/schema";
import { db } from "./db";

/**
 * Scheduler-only cross-tenant persistence boundary. These operations are not
 * members of general storage, so request routes cannot obtain an unscoped task
 * reader by reaching for the shared storage object.
 */
export async function getDueHeartbeatTasksAcrossTenants(): Promise<HeartbeatTask[]> {
  const result = await db.execute(sql`
    SELECT * FROM heartbeat_tasks
    WHERE enabled = true AND next_run_at <= NOW()
      AND approval_status = 'approved'
    ORDER BY next_run_at ASC
  `);
  const rows = ((result as any).rows || []) as any[];
  return rows.map((r) => ({
    ...r,
    cronExpression: r.cron_expression ?? r.cronExpression,
    promptContent: r.prompt_content ?? r.promptContent,
    lastRunAt: r.last_run_at ?? r.lastRunAt,
    nextRunAt: r.next_run_at ?? r.nextRunAt,
    personaId: r.persona_id ?? r.personaId,
    createdBy: r.created_by ?? r.createdBy,
    parentTaskId: r.parent_task_id ?? r.parentTaskId,
    runOnce: r.run_once ?? r.runOnce,
    tenantId: r.tenant_id ?? r.tenantId,
    approvalStatus: r.approval_status ?? r.approvalStatus,
    createdAt: r.created_at ?? r.createdAt,
  })) as HeartbeatTask[];
}

export async function claimDueHeartbeatTasksAcrossTenants(
  taskIds: number[],
  nextRunAtMap: Map<number, Date>,
): Promise<number[]> {
  if (taskIds.length === 0) return [];
  const now = new Date();
  const claimed: number[] = [];
  for (const id of taskIds) {
    const nextRun = nextRunAtMap.get(id) || new Date(now.getTime() + 10 * 60 * 1000);
    const result = await db.execute(sql`
      UPDATE heartbeat_tasks
      SET last_run_at = ${now}, next_run_at = ${nextRun}
      WHERE id = ${id}
        AND enabled = true
        AND next_run_at <= NOW()
        AND approval_status = 'approved'
      RETURNING id
    `);
    if (((result as any).rows || []).length > 0) {
      claimed.push(id);
    }
  }
  return claimed;
}
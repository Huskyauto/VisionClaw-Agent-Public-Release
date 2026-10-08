import { sql } from "drizzle-orm";
import { db, withTenantTx } from "../db";
import { getNextStrictCronRun } from "../cron-utils";
import { validateHeartbeatRepairAction, HeartbeatRepairAction } from "./heartbeat-repair-contract";

type State = { enabled: boolean; cronExpression: string };

function state(row: any): State {
  return { enabled: Boolean(row.enabled), cronExpression: String(row.cron_expression) };
}

export async function executeHeartbeatRepair(
  tenantId: number,
  rawAction: unknown,
): Promise<{ verified: true; before: State; after: State }> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("heartbeat repair requires a positive tenantId");
  const action: HeartbeatRepairAction = validateHeartbeatRepairAction(rawAction);
  return withTenantTx(tenantId, async (tx: any) => {
    const result: any = await tx.execute(sql`
      SELECT id, tenant_id, enabled, cron_expression
      FROM heartbeat_tasks
      WHERE id = ${action.taskId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const row = (result.rows ?? result)[0];
    if (!row) throw new Error("heartbeat task not found for tenant");
    const before = state(row);
    const alreadyDesired = Object.keys(action.desiredAfter).every((key) => before[key as keyof State] === action.desiredAfter[key as keyof State]);
    // A committed prior attempt may have lost its execution-log write. The
    // desired state is the only safe idempotency receipt; never reapply it.
    if (alreadyDesired) return { verified: true, before, after: before };
    for (const key of Object.keys(action.expectedBefore) as (keyof State)[]) {
      if (before[key] !== action.expectedBefore[key]) throw new Error(`heartbeat repair expected-before drift: ${key}`);
    }
    const desired = { ...before, ...action.desiredAfter } as State;
    if (!alreadyDesired) {
      const nextRun = getNextStrictCronRun(desired.cronExpression);
      await tx.execute(sql`
        UPDATE heartbeat_tasks
        SET enabled = ${desired.enabled},
            cron_expression = ${desired.cronExpression},
            next_run_at = ${nextRun}
        WHERE id = ${action.taskId} AND tenant_id = ${tenantId}
      `);
    }
    const checked: any = await tx.execute(sql`
      SELECT enabled, cron_expression FROM heartbeat_tasks
      WHERE id = ${action.taskId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const after = state((checked.rows ?? checked)[0]);
    for (const key of Object.keys(action.desiredAfter) as (keyof State)[]) {
      if (after[key] !== action.desiredAfter[key]) throw new Error(`heartbeat repair verification mismatch: ${key}`);
    }
    return { verified: true, before, after };
  });
}

export { db };
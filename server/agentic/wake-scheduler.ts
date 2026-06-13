/**
 * Durable sleep/wake sequences (R125+14 — Manus agentic gap #4).
 *
 * A persona can schedule a future resume — e.g. "I sent the proposal email, wake
 * me in 3 days to check for a reply and follow up." The heartbeat scans for due
 * schedules and fires an `agent.wake` event that the event-bus routes to the
 * owning persona's channel / autonomous loop. This is the long-horizon complement
 * to the in-loop maxWallClockMs circuit breaker: real corporate sequences span
 * days, not the 10-minute execution budget of a single turn.
 *
 * No external durable-execution engine (Temporal) is introduced — wake state is a
 * row, the heartbeat is the scheduler, and the event-bus is the activation seam.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { emitEvent } from "../event-bus";
import { logSilentCatch } from "../lib/silent-catch";

export interface ScheduleWakeParams {
  tenantId: number;
  goal: string;
  wakeAt: Date;
  personaId?: number | null;
  conversationId?: number | null;
  projectId?: number | null;
  kind?: string;
  context?: Record<string, any> | null;
  maxAttempts?: number;
  createdBy?: string;
}

const MAX_HORIZON_DAYS = 365;

export async function scheduleWake(p: ScheduleWakeParams): Promise<{ id: number; wakeAt: string }> {
  if (!p.goal?.trim()) throw new Error("scheduleWake requires a non-empty goal");
  const now = Date.now();
  const wakeMs = p.wakeAt.getTime();
  if (Number.isNaN(wakeMs)) throw new Error("scheduleWake requires a valid wakeAt date");
  if (wakeMs > now + MAX_HORIZON_DAYS * 86400_000) {
    throw new Error(`wakeAt exceeds max horizon of ${MAX_HORIZON_DAYS} days`);
  }
  const r: any = await db.execute(sql`
    INSERT INTO agent_wake_schedules
      (tenant_id, persona_id, conversation_id, project_id, kind, goal, context, wake_at, max_attempts, created_by)
    VALUES
      (${p.tenantId}, ${p.personaId ?? null}, ${p.conversationId ?? null}, ${p.projectId ?? null},
       ${p.kind ?? "follow_up"}, ${p.goal}, ${p.context ? JSON.stringify(p.context) : null}::jsonb,
       ${p.wakeAt}, ${p.maxAttempts ?? 1}, ${p.createdBy ?? "agent"})
    RETURNING id, wake_at
  `);
  const row = (r.rows ?? r)[0];
  return { id: row.id, wakeAt: new Date(row.wake_at).toISOString() };
}

export async function cancelWake(tenantId: number, id: number): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE agent_wake_schedules SET status = 'cancelled', updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'
    RETURNING id
  `);
  return (r.rows ?? r).length > 0;
}

export async function listWakes(tenantId: number, status?: string): Promise<any[]> {
  const r: any = status
    ? await db.execute(sql`SELECT * FROM agent_wake_schedules WHERE tenant_id = ${tenantId} AND status = ${status} ORDER BY wake_at ASC LIMIT 100`)
    : await db.execute(sql`SELECT * FROM agent_wake_schedules WHERE tenant_id = ${tenantId} ORDER BY wake_at ASC LIMIT 100`);
  return (r.rows ?? r) as any[];
}

/**
 * Heartbeat-callable. Claims due pending schedules (row-locked so concurrent
 * ticks can't double-fire), emits agent.wake, and marks them fired. On error,
 * re-queues unless attempts are exhausted.
 */
export async function runDueWakes(limit = 10): Promise<{ fired: number; errors: number; failed: boolean }> {
  let fired = 0, errors = 0, failed = false;
  try {
    const r: any = await db.execute(sql`
      UPDATE agent_wake_schedules
      SET status = 'firing', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM agent_wake_schedules
        WHERE status = 'pending' AND wake_at <= now()
        ORDER BY wake_at ASC LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = (r.rows ?? r) as any[];
    for (const w of rows) {
      try {
        await emitEvent({
          type: "agent.wake",
          source: "wake-scheduler",
          tenantId: w.tenant_id,
          data: {
            wakeId: w.id, goal: w.goal, kind: w.kind, personaId: w.persona_id,
            conversationId: w.conversation_id, projectId: w.project_id,
            context: w.context, attempts: w.attempts,
          },
        });
        await db.execute(sql`
          UPDATE agent_wake_schedules
          SET status = 'fired', updated_at = now(),
              result = ${JSON.stringify({ firedAt: new Date().toISOString() })}::jsonb
          WHERE id = ${w.id} AND tenant_id = ${w.tenant_id} AND status = 'firing'
        `);
        fired++;
      } catch (e: any) {
        errors++;
        const exhausted = (w.attempts ?? 1) >= (w.max_attempts ?? 1);
        await db.execute(sql`
          UPDATE agent_wake_schedules SET status = ${exhausted ? "failed" : "pending"}, updated_at = now()
          WHERE id = ${w.id} AND tenant_id = ${w.tenant_id}
        `).catch(err => {
          // The recovery UPDATE itself failing means the DB/claim path is down
          // (not a per-wake logic error) — flag the whole sweep as failed so the
          // heartbeat logs LOUD instead of reporting a false all-clear.
          failed = true;
          logSilentCatch("server/agentic/wake-scheduler.ts", err);
        });
      }
    }
  } catch (e) { failed = true; logSilentCatch("server/agentic/wake-scheduler.ts", e); }
  return { fired, errors, failed };
}

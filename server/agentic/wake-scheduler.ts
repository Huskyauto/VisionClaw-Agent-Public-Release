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
  /**
   * Condition-based wake (Kimi K3 #1): event-bus event type that fires this wake
   * early (exact name like "email.replied" or category wildcard "email.*").
   * `wakeAt` remains the backstop deadline — the wake fires at wakeAt even if
   * the event never arrives.
   */
  triggerEvent?: string | null;
  /** Optional jsonb containment predicate on the event's data payload. */
  triggerFilter?: Record<string, any> | null;
}

const MAX_HORIZON_DAYS = 365;

/** "email.replied" or category wildcard "email.*" — matches event-bus type shapes. */
const TRIGGER_EVENT_SHAPE = /^[a-z][a-z0-9_]*\.(\*|[a-z][a-z0-9_.]*)$/;

export async function scheduleWake(p: ScheduleWakeParams): Promise<{ id: number; wakeAt: string; triggerEvent?: string | null }> {
  // Fail closed on tenant identity — this library must be safe even if a
  // future caller bypasses the tool-handler validation (72h review R125+137.64+sec follow-up).
  if (!Number.isInteger(p.tenantId) || p.tenantId <= 0) {
    throw new Error(`scheduleWake requires a valid positive integer tenantId (got ${String(p.tenantId)})`);
  }
  if (!p.goal?.trim()) throw new Error("scheduleWake requires a non-empty goal");
  const now = Date.now();
  const wakeMs = p.wakeAt.getTime();
  if (Number.isNaN(wakeMs)) throw new Error("scheduleWake requires a valid wakeAt date");
  if (wakeMs > now + MAX_HORIZON_DAYS * 86400_000) {
    throw new Error(`wakeAt exceeds max horizon of ${MAX_HORIZON_DAYS} days`);
  }
  const triggerEvent = p.triggerEvent?.trim() || null;
  if (triggerEvent && !TRIGGER_EVENT_SHAPE.test(triggerEvent)) {
    throw new Error(`triggerEvent must look like "category.name" or "category.*" (got "${triggerEvent}")`);
  }
  if (p.triggerFilter && !triggerEvent) {
    throw new Error("triggerFilter requires triggerEvent");
  }
  const r: any = await db.execute(sql`
    INSERT INTO agent_wake_schedules
      (tenant_id, persona_id, conversation_id, project_id, kind, goal, context, wake_at, max_attempts, created_by, trigger_event, trigger_filter)
    VALUES
      (${p.tenantId}, ${p.personaId ?? null}, ${p.conversationId ?? null}, ${p.projectId ?? null},
       ${p.kind ?? "follow_up"}, ${p.goal}, ${p.context ? JSON.stringify(p.context) : null}::jsonb,
       ${p.wakeAt}, ${p.maxAttempts ?? 1}, ${p.createdBy ?? "agent"},
       ${triggerEvent}, ${p.triggerFilter ? JSON.stringify(p.triggerFilter) : null}::jsonb)
    RETURNING id, wake_at, trigger_event
  `);
  const row = (r.rows ?? r)[0];
  return { id: row.id, wakeAt: new Date(row.wake_at).toISOString(), triggerEvent: row.trigger_event ?? null };
}

/**
 * Condition-based wake matcher (Kimi K3 #1). Called by the event bus (dynamic
 * import, fire-and-forget) after every emitEvent. Pulls the wake_at of any
 * pending wake whose trigger_event matches the emitted type (exact name or
 * "category.*" wildcard) — and whose optional trigger_filter is contained in
 * the event's data payload — up to now(). The regular runDueWakes heartbeat
 * then fires it through the normal claim/emit/attempt machinery, so condition
 * wakes get row-locking, retries, and audit for free.
 *
 * Tenant-scoped: only wakes belonging to the emitting event's tenant match.
 * Fail-open: an error here never blocks the event publisher (caller catches).
 */
export async function matchConditionWakes(
  tenantId: number,
  eventType: string,
  data?: any,
): Promise<{ matched: number }> {
  const category = eventType.split(".")[0];
  const wildcard = `${category}.*`;
  const dataJson = JSON.stringify(data ?? {});
  const r: any = await db.execute(sql`
    UPDATE agent_wake_schedules
    SET wake_at = now(), updated_at = now(),
        context = COALESCE(context, '{}'::jsonb) || jsonb_build_object(
          'triggeredByEvent', ${eventType}::text,
          'triggeredAt', now()::text
        )
    WHERE tenant_id = ${tenantId}
      AND status = 'pending'
      AND trigger_event IS NOT NULL
      AND (trigger_event = ${eventType} OR trigger_event = ${wildcard})
      AND (trigger_filter IS NULL OR ${dataJson}::jsonb @> trigger_filter)
      AND wake_at > now()
    RETURNING id
  `);
  return { matched: ((r.rows ?? r) as any[]).length };
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

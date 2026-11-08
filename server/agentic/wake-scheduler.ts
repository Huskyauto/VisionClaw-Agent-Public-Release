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
import { dispatchPersistedEvent } from "../event-bus";
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
  if (p.projectId != null) {
    const project = await db.execute<{ id: number }>(sql`
      SELECT id FROM projects WHERE id = ${p.projectId} AND tenant_id = ${p.tenantId} LIMIT 1
    `);
    if (project.rows.length === 0) throw new Error("Project not found in this tenant");
  }
  if (p.conversationId != null) {
    const conversation = await db.execute<{ id: number }>(sql`
      SELECT id FROM conversations WHERE id = ${p.conversationId} AND tenant_id = ${p.tenantId} LIMIT 1
    `);
    if (conversation.rows.length === 0) throw new Error("Conversation not found in this tenant");
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
 * Heartbeat-callable. Atomically queues each event and completes its wake.
 * A crash before commit leaves it pending; a crash after commit leaves one
 * durable event for the existing heartbeat event-log worker. `fired` means
 * queued, not subscriber completion or exactly-once downstream side effects.
 */
export async function runDueWakes(limit = 10): Promise<{ fired: number; errors: number; failed: boolean }> {
  let fired = 0, errors = 0, failed = false;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { fired, errors, failed: true };
  }
  try {
    // Old releases committed `firing` separately from emission. Their outcome
    // is unknowable after a crash; make stale claims visible, never replay them
    // blindly. New handoffs below have no committed `firing` window.
    const recovered = await db.execute(sql`
      WITH stale AS (
        SELECT id, tenant_id FROM agent_wake_schedules
        WHERE status = 'firing' AND updated_at < now() - interval '10 minutes'
        ORDER BY updated_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE agent_wake_schedules w
      SET status = 'failed', updated_at = now(),
          result = jsonb_build_object(
            'reason', 'legacy_firing_outcome_unknown',
            'requiresReview', true,
            'automaticReplay', false
          )
      FROM stale
      WHERE w.id = stale.id AND w.tenant_id = stale.tenant_id
      RETURNING w.id
    `);
    errors += recovered.rows.length;
    if (errors > 0) {
      failed = true;
      console.error(`[wake-scheduler] ${errors} legacy firing claim(s) need outcome review; no automatic replay`);
    }
    const r: any = await db.execute(sql`
      WITH due AS (
        SELECT * FROM agent_wake_schedules
        WHERE status = 'pending' AND wake_at <= now()
        ORDER BY wake_at ASC LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ), events AS (
        INSERT INTO event_log (tenant_id, event_type, source, data, status)
        SELECT tenant_id, 'agent.wake', 'wake-scheduler',
          jsonb_build_object(
            'wakeId', id, 'goal', goal, 'kind', kind, 'personaId', persona_id,
            'conversationId', conversation_id, 'projectId', project_id,
            'context', context, 'attempts', attempts + 1
          ), 'pending'
        FROM due
        RETURNING id, tenant_id, data
      )
      UPDATE agent_wake_schedules w
      SET status = 'fired', attempts = w.attempts + 1, updated_at = now(),
          result = jsonb_build_object('eventId', e.id, 'queuedAt', now())
      FROM events e
      WHERE w.id = (e.data->>'wakeId')::integer AND w.tenant_id = e.tenant_id
      RETURNING w.id, w.tenant_id, e.id AS event_id, e.data AS event_data
    `);
    const rows = (r.rows ?? r) as any[];
    for (const w of rows) {
      fired++;
      try {
        await dispatchPersistedEvent(w.event_id, {
          type: "agent.wake", source: "wake-scheduler",
          tenantId: w.tenant_id, data: w.event_data,
        });
      } catch (e: any) {
        // The durable event remains pending for the existing event-log worker.
        // Never reset the wake and create a second event after routing starts.
        errors++;
        failed = true;
        logSilentCatch("server/agentic/wake-scheduler.ts", e);
      }
    }
  } catch (e) { failed = true; logSilentCatch("server/agentic/wake-scheduler.ts", e); }
  return { fired, errors, failed };
}

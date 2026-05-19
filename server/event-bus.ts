import { db } from "./db";
import { sql } from "drizzle-orm";
import { postMessage } from "./agent-channels";
import { scoreEvent, SALIENCE_WAKE_THRESHOLD } from "./attention-scorer";
import { notifyOwnerOfHighSalienceEvent } from "./attention-handlers/owner-notify";

const EVENT_TYPES = [
  { name: "payment.succeeded", category: "payment", description: "Payment successfully processed" },
  { name: "payment.failed", category: "payment", description: "Payment processing failed" },
  { name: "payment.subscription.created", category: "payment", description: "New subscription created" },
  { name: "payment.subscription.canceled", category: "payment", description: "Subscription canceled" },
  { name: "payment.subscription.downgraded", category: "payment", description: "Plan downgraded" },
  { name: "email.received", category: "email", description: "New email received" },
  { name: "email.bounced", category: "email", description: "Email delivery bounced" },
  { name: "email.replied", category: "email", description: "Reply received to sent email" },
  { name: "content.published", category: "content", description: "Content published to platform" },
  { name: "content.reviewed", category: "content", description: "Content review completed" },
  { name: "content.engagement", category: "content", description: "Engagement metrics received" },
  { name: "lead.new", category: "crm", description: "New lead identified" },
  { name: "lead.qualified", category: "crm", description: "Lead qualified by scoring" },
  { name: "lead.stale", category: "crm", description: "Lead inactive for threshold period" },
  { name: "deal.stage_changed", category: "crm", description: "Deal moved to new pipeline stage" },
  { name: "deal.won", category: "crm", description: "Deal closed won" },
  { name: "deal.lost", category: "crm", description: "Deal closed lost" },
  { name: "agent.task.completed", category: "agent", description: "Agent completed a task" },
  { name: "agent.task.failed", category: "agent", description: "Agent task failed" },
  { name: "agent.escalation", category: "agent", description: "Agent escalated to human or another agent" },
  { name: "agent.budget.warning", category: "agent", description: "Agent approaching budget limit" },
  { name: "agent.budget.exceeded", category: "agent", description: "Agent exceeded budget limit" },
  { name: "system.health.degraded", category: "system", description: "System health check failed" },
  { name: "system.health.recovered", category: "system", description: "System health restored" },
  { name: "system.backup.completed", category: "system", description: "Backup completed" },
  { name: "system.usage.warning", category: "system", description: "Usage approaching plan limits" },
  { name: "monitor.alert", category: "monitor", description: "Watchlist monitor triggered alert" },
  { name: "monitor.competitor", category: "monitor", description: "Competitor activity detected" },
  // Attention Bus v0 — delivery & research publishers
  { name: "delivery.completed", category: "delivery", description: "Customer delivery completed successfully" },
  { name: "delivery.failed", category: "delivery", description: "Customer delivery failed after retries" },
  { name: "delivery.stuck", category: "delivery", description: "Customer delivery exceeded expected time" },
  { name: "research.experiment.failed", category: "research", description: "Research experiment failed verification" },
  { name: "research.cost.regression", category: "research", description: "Cost-eval suite regressed beyond threshold" },
  { name: "research.program.seeded", category: "research", description: "New research program seeded" },
  // Round 24 — Minerva planner / Felix decision loop
  { name: "plan.proposed", category: "planning", description: "Minerva proposed a plan awaiting Felix decision" },
  { name: "plan.approved", category: "planning", description: "Felix approved a plan; execution may begin" },
  { name: "plan.rejected", category: "planning", description: "Felix rejected a plan with a reason" },
  { name: "plan.revised", category: "planning", description: "Minerva revised a plan after Felix feedback" },
];

export function getEventTypes(): typeof EVENT_TYPES {
  return EVENT_TYPES;
}

export async function emitEvent(params: {
  type: string;
  source: string;
  tenantId: number;
  data?: any;
}): Promise<number> {
  // Attention Bus v0: score salience inline (rules-only, ~5ms, no LLM cost).
  let salience: { score: number; meta: any } | null = null;
  try {
    salience = await scoreEvent({
      eventType: params.type,
      source: params.source,
      data: params.data,
      tenantId: params.tenantId,
    });
  } catch (err: any) {
    console.warn(`[event-bus] scoreEvent failed for ${params.type}: ${err.message}`);
  }

  const result = await db.execute(sql`
    INSERT INTO event_log (tenant_id, event_type, source, data, status, salience_score, salience_meta)
    VALUES (
      ${params.tenantId},
      ${params.type},
      ${params.source},
      ${params.data ? JSON.stringify(params.data) : null}::jsonb,
      'pending',
      ${salience?.score ?? null},
      ${salience?.meta ? JSON.stringify(salience.meta) : null}::jsonb
    )
    RETURNING id
  `);
  const rows = (result as any).rows || result;
  const eventId = rows[0]?.id;

  if (eventId) {
    // High-salience events wake the owner immediately. Fire-and-forget so the
    // publisher's hot path is never blocked on email I/O.
    if (salience && salience.score >= SALIENCE_WAKE_THRESHOLD) {
      notifyOwnerOfHighSalienceEvent({
        eventId,
        eventType: params.type,
        source: params.source,
        salienceScore: salience.score,
        data: params.data,
        meta: salience.meta,
      }).catch((err) => {
        console.error(`[event-bus] owner-notify dispatch failed for #${eventId}: ${err?.message || err}`);
      });
    }
    try {
      await routeEventToSubscribers(eventId, params.tenantId, params.type, params.data);
    } catch (err: any) {
      console.error(`[event-bus] Error routing event ${eventId}:`, err.message);
    }
  }

  return eventId;
}

export async function routeEventToSubscribers(eventId: number, tenantId: number, eventType?: string, data?: any): Promise<void> {
  if (!eventType || !data) {
    const evResult = await db.execute(sql`SELECT event_type, data FROM event_log WHERE id = ${eventId} AND tenant_id = ${tenantId}`);
    const evRow = ((evResult as any).rows || evResult)[0];
    if (!evRow) return;
    eventType = evRow.event_type;
    data = typeof evRow.data === "string" ? JSON.parse(evRow.data) : evRow.data;
  }
  const exactResult = await db.execute(sql`
    SELECT es.*, p.name as persona_name FROM event_subscriptions es
    JOIN personas p ON p.id = es.persona_id
    WHERE es.tenant_id = ${tenantId}
      AND es.enabled = TRUE
      AND es.event_type = ${eventType}
    ORDER BY es.priority DESC
  `);
  let subscribers = ((exactResult as any).rows || exactResult) as any[];

  if (subscribers.length === 0) {
    const parts = eventType!.split(".");
    if (parts.length >= 2) {
      const wildcardType = parts[0] + ".*";
      const wildcardResult = await db.execute(sql`
        SELECT es.*, p.name as persona_name FROM event_subscriptions es
        JOIN personas p ON p.id = es.persona_id
        WHERE es.tenant_id = ${tenantId}
          AND es.enabled = TRUE
          AND es.event_type = ${wildcardType}
        ORDER BY es.priority DESC
      `);
      subscribers = ((wildcardResult as any).rows || wildcardResult) as any[];
    }
  }

  if (subscribers.length === 0) {
    await db.execute(sql`
      UPDATE event_log SET status = 'no_subscribers', processed_at = NOW()
      WHERE id = ${eventId}
    `);
    return;
  }

  const categoryMap: Record<string, string> = {
    payment: "#revenue-alerts",
    lead: "#revenue-alerts",
    deal: "#revenue-alerts",
    email: "#intelligence",
    content: "#content-pipeline",
    crm: "#revenue-alerts",
    agent: "#general",
    system: "#system-alerts",
    monitor: "#intelligence",
  };

  const category = eventType!.split(".")[0];
  const channelName = categoryMap[category] || "#general";

  const summary = `📡 **Event: ${eventType}** (from: ${data?.source || "system"})\n${JSON.stringify(data || {}).substring(0, 300)}`;
  await postMessage({
    tenantId,
    channelName,
    content: summary,
    messageType: "alert",
    metadata: { eventType, eventId },
    eventRef: eventId,
  });

  const subscriberNames = subscribers.map((s: any) => s.persona_name).join(", ");

  await db.execute(sql`
    UPDATE event_log SET
      status = 'routed',
      processing_result = ${JSON.stringify({ subscriberCount: subscribers.length, subscribers: subscriberNames, channelPosted: channelName })}::jsonb,
      processed_at = NOW()
    WHERE id = ${eventId}
  `);
}

export async function getEventLog(tenantId: number, filters?: {
  eventType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  if (filters?.eventType && filters?.status) {
    const result = await db.execute(sql`
      SELECT * FROM event_log
      WHERE tenant_id = ${tenantId} AND event_type = ${filters.eventType} AND status = ${filters.status}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `);
    return (result as any).rows || result;
  }

  if (filters?.eventType) {
    const result = await db.execute(sql`
      SELECT * FROM event_log
      WHERE tenant_id = ${tenantId} AND event_type = ${filters.eventType}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `);
    return (result as any).rows || result;
  }

  if (filters?.status) {
    const result = await db.execute(sql`
      SELECT * FROM event_log
      WHERE tenant_id = ${tenantId} AND status = ${filters.status}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `);
    return (result as any).rows || result;
  }

  const result = await db.execute(sql`
    SELECT * FROM event_log
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `);
  return (result as any).rows || result;
}

export async function getEventDetail(tenantId: number, eventId: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT * FROM event_log WHERE tenant_id = ${tenantId} AND id = ${eventId}
  `);
  const rows = (result as any).rows || result;
  return rows.length > 0 ? rows[0] : null;
}

export async function getEventSubscriptions(tenantId: number): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT es.*, p.name as persona_name FROM event_subscriptions es
    JOIN personas p ON p.id = es.persona_id
    WHERE es.tenant_id = ${tenantId}
    ORDER BY es.priority DESC
  `);
  return (result as any).rows || result;
}

export async function createEventSubscription(tenantId: number, params: {
  eventType: string;
  personaId: number;
  action?: string;
  priority?: number;
  actionConfig?: any;
}): Promise<any> {
  const result = await db.execute(sql`
    INSERT INTO event_subscriptions (tenant_id, event_type, persona_id, action, priority, action_config)
    VALUES (${tenantId}, ${params.eventType}, ${params.personaId}, ${params.action || "process"}, ${params.priority || 5}, ${params.actionConfig ? JSON.stringify(params.actionConfig) : null}::jsonb)
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

export async function updateEventSubscription(tenantId: number, id: number, updates: {
  action?: string;
  priority?: number;
  actionConfig?: any;
  enabled?: boolean;
}): Promise<any> {
  const current = await db.execute(sql`SELECT * FROM event_subscriptions WHERE id = ${id} AND tenant_id = ${tenantId}`);
  const existing = ((current as any).rows || current)[0];
  if (!existing) return null;

  const newAction = updates.action !== undefined ? updates.action : existing.action;
  const newPriority = updates.priority !== undefined ? updates.priority : existing.priority;
  const newEnabled = updates.enabled !== undefined ? updates.enabled : existing.enabled;
  const newConfig = updates.actionConfig !== undefined ? JSON.stringify(updates.actionConfig) : (existing.action_config ? JSON.stringify(existing.action_config) : null);

  const result = await db.execute(sql`
    UPDATE event_subscriptions SET
      action = ${newAction},
      priority = ${newPriority},
      enabled = ${newEnabled},
      action_config = ${newConfig}::jsonb
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  return ((result as any).rows || result)[0];
}

export async function deleteEventSubscription(tenantId: number, id: number): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM event_subscriptions WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
  return true;
}

export async function getEventStats(tenantId: number): Promise<any> {
  const totalResult = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'routed') as routed,
      COUNT(*) FILTER (WHERE status = 'processed') as processed,
      COUNT(*) FILTER (WHERE status = 'no_subscribers') as no_subscribers,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'error') as failed
    FROM event_log WHERE tenant_id = ${tenantId}
  `);

  const topTypes = await db.execute(sql`
    SELECT event_type, COUNT(*) as count
    FROM event_log WHERE tenant_id = ${tenantId}
    GROUP BY event_type
    ORDER BY count DESC
    LIMIT 10
  `);

  const row = ((totalResult as any).rows || totalResult)[0] || {};
  return {
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    processed: Number(row.processed) || 0,
    routed: Number(row.routed) || 0,
    failed: Number(row.failed) || 0,
    noSubscribers: Number(row.no_subscribers) || 0,
    topEventTypes: ((topTypes as any).rows || topTypes).map((r: any) => ({
      event_type: r.event_type,
      count: Number(r.count) || 0,
    })),
  };
}

import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { processMessage } from "./chat-engine";
import { ADMIN_TENANT_ID } from "./tenant-constants";
import crypto from "crypto";

export interface WebhookTrigger {
  id: number;
  name: string;
  description: string;
  webhookKey: string;
  personaId: number | null;
  personaName: string | null;
  enabled: boolean;
  lastTriggered: string | null;
  triggerCount: number;
  createdAt: string;
}

export interface WebhookEvent {
  id: number;
  triggerId: number;
  payload: any;
  responsePreview: string;
  status: string;
  createdAt: string;
}

const triggerConversations = new Map<string, number>();

export async function ensureTriggerTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webhook_triggers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      webhook_key TEXT NOT NULL UNIQUE,
      persona_id INTEGER,
      enabled BOOLEAN DEFAULT true,
      last_triggered TIMESTAMPTZ,
      trigger_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webhook_trigger_events (
      id SERIAL PRIMARY KEY,
      trigger_id INTEGER NOT NULL,
      payload JSONB DEFAULT '{}',
      response_preview TEXT DEFAULT '',
      status TEXT DEFAULT 'success',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function listTriggers(): Promise<WebhookTrigger[]> {
  await ensureTriggerTables();
  const result = await db.execute(sql`
    SELECT w.*, p.name as persona_name
    FROM webhook_triggers w
    LEFT JOIN personas p ON p.id = w.persona_id
    ORDER BY w.created_at DESC
  `);
  const rows = (result as any).rows || result;
  return (rows || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    webhookKey: r.webhook_key,
    personaId: r.persona_id,
    personaName: r.persona_name || null,
    enabled: r.enabled,
    lastTriggered: r.last_triggered,
    triggerCount: r.trigger_count || 0,
    createdAt: r.created_at,
  }));
}

export async function createTrigger(config: {
  name: string;
  description?: string;
  personaId?: number | null;
}): Promise<WebhookTrigger> {
  await ensureTriggerTables();
  const webhookKey = crypto.randomBytes(16).toString("hex");

  const result = await db.execute(sql`
    INSERT INTO webhook_triggers (name, description, webhook_key, persona_id)
    VALUES (${config.name}, ${config.description || ""}, ${webhookKey}, ${config.personaId || null})
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    webhookKey: r.webhook_key,
    personaId: r.persona_id,
    personaName: null,
    enabled: r.enabled,
    lastTriggered: r.last_triggered,
    triggerCount: r.trigger_count || 0,
    createdAt: r.created_at,
  };
}

export async function deleteTrigger(id: number): Promise<void> {
  await db.execute(sql`DELETE FROM webhook_trigger_events WHERE trigger_id = ${id}`);
  await db.execute(sql`DELETE FROM webhook_triggers WHERE id = ${id}`);
}

export async function toggleTrigger(id: number, enabled: boolean): Promise<void> {
  await db.execute(sql`UPDATE webhook_triggers SET enabled = ${enabled} WHERE id = ${id}`);
}

export async function processTriggerEvent(webhookKey: string, payload: any): Promise<{ success: boolean; response?: string; error?: string }> {
  await ensureTriggerTables();

  const result = await db.execute(sql`
    SELECT w.*, p.name as persona_name
    FROM webhook_triggers w
    LEFT JOIN personas p ON p.id = w.persona_id
    WHERE w.webhook_key = ${webhookKey} AND w.enabled = true
  `);
  const rows = (result as any).rows || result;
  const trigger = rows?.[0];

  if (!trigger) {
    return { success: false, error: "Webhook trigger not found or disabled" };
  }

  try {
    const convKey = `trigger-${trigger.id}`;
    const conversationId = await getOrCreateTriggerConversation(convKey, trigger);

    const eventSummary = typeof payload === "string"
      ? payload
      : `Webhook event received: ${trigger.name}\n\nPayload:\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 2000)}\n\`\`\`\n\nPlease analyze this event and take appropriate action.`;

    const msgResult = await processMessage(conversationId, eventSummary, { source: "webhook" });

    await db.execute(sql`
      UPDATE webhook_triggers
      SET last_triggered = NOW(), trigger_count = trigger_count + 1
      WHERE id = ${trigger.id}
    `);

    const responsePreview = msgResult.response.slice(0, 500);
    await db.execute(sql`
      INSERT INTO webhook_trigger_events (trigger_id, payload, response_preview, status)
      VALUES (${trigger.id}, ${JSON.stringify(payload)}::jsonb, ${responsePreview}, 'success')
    `);

    return { success: true, response: msgResult.response };
  } catch (err: any) {
    await db.execute(sql`
      INSERT INTO webhook_trigger_events (trigger_id, payload, response_preview, status)
      VALUES (${trigger.id}, ${JSON.stringify(payload)}::jsonb, ${err.message}, 'error')
    `).catch(() => {});
    return { success: false, error: err.message };
  }
}

async function getOrCreateTriggerConversation(convKey: string, trigger: any): Promise<number> {
  const triggerTenantId = trigger.tenant_id ?? trigger.tenantId ?? ADMIN_TENANT_ID;
  if (triggerConversations.has(convKey)) {
    const convId = triggerConversations.get(convKey)!;
    const conv = await storage.getConversation(convId, triggerTenantId);
    if (conv) return convId;
    triggerConversations.delete(convKey);
  }

  const settings = await storage.getSettings();
  let personaId = trigger.persona_id;

  if (!personaId) {
    const activePersona = await storage.getActivePersona();
    personaId = activePersona?.id ?? null;
  }

  // R74.12 — Single-tenant platform: webhook triggers run in admin context.
  // SaaS migration would resolve tenant from trigger.tenantId or signed payload.
  const conv = await storage.createConversation({
    tenantId: ADMIN_TENANT_ID,
    title: `Webhook: ${trigger.name}`,
    model: settings?.defaultModel || "gemini-2.5-flash",
    thinking: settings?.thinkingEnabled ?? false,
    personaId,
  });

  triggerConversations.set(convKey, conv.id);
  return conv.id;
}

export async function getTriggerEvents(triggerId: number, limit: number = 20): Promise<WebhookEvent[]> {
  const result = await db.execute(sql`
    SELECT * FROM webhook_trigger_events
    WHERE trigger_id = ${triggerId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  const rows = (result as any).rows || result;
  return (rows || []).map((r: any) => ({
    id: r.id,
    triggerId: r.trigger_id,
    payload: r.payload,
    responsePreview: r.response_preview,
    status: r.status,
    createdAt: r.created_at,
  }));
}

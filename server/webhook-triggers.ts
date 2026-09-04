import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { processMessage } from "./chat-engine";
import { ADMIN_TENANT_ID } from "./tenant-constants";
import { assertValidTenantId } from "./storage-helpers/tenant-scope";
import crypto from "crypto";

export interface WebhookTrigger {
  id: number;
  tenantId: number;
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
  await db.transaction(async (tx) => {
    // Serialize this idempotent runtime migration across app instances. Keeping
    // every DDL/data-repair step in one transaction prevents a failed constraint
    // addition from leaving a partially hardened schema.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('webhook_trigger_tenant_schema_v2'))`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_triggers (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        webhook_key TEXT NOT NULL UNIQUE,
        persona_id INTEGER,
        enabled BOOLEAN DEFAULT true,
        last_triggered TIMESTAMPTZ,
        trigger_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_webhook_triggers_tenant_id_id UNIQUE (tenant_id, id)
      )
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_trigger_events (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        trigger_id INTEGER NOT NULL,
        payload JSONB DEFAULT '{}',
        response_preview TEXT DEFAULT '',
        status TEXT DEFAULT 'success',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await tx.execute(sql`ALTER TABLE webhook_triggers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    await tx.execute(sql`ALTER TABLE webhook_trigger_events ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);

    // Legacy trigger administration was platform-admin-only, so ADMIN is the
    // proven historical owner. Events are telemetry: orphaned rows have no safe
    // owner and are deleted rather than guessed into a tenant.
    await tx.execute(sql`UPDATE webhook_triggers SET tenant_id = ${ADMIN_TENANT_ID} WHERE tenant_id IS NULL`);
    await tx.execute(sql`
      DELETE FROM webhook_trigger_events e
      WHERE NOT EXISTS (
        SELECT 1 FROM webhook_triggers w WHERE w.id = e.trigger_id
      )
    `);
    await tx.execute(sql`
      UPDATE webhook_trigger_events e
      SET tenant_id = w.tenant_id
      FROM webhook_triggers w
      WHERE e.trigger_id = w.id AND e.tenant_id IS NULL
    `);
    await tx.execute(sql`
      DELETE FROM webhook_trigger_events e
      USING webhook_triggers w
      WHERE e.trigger_id = w.id AND e.tenant_id <> w.tenant_id
    `);

    await tx.execute(sql`ALTER TABLE webhook_triggers ALTER COLUMN tenant_id SET NOT NULL`);
    await tx.execute(sql`ALTER TABLE webhook_trigger_events ALTER COLUMN tenant_id SET NOT NULL`);
    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_webhook_triggers_tenant_id_id'
            AND conrelid = 'webhook_triggers'::regclass
        ) THEN
          IF EXISTS (
            SELECT 1
            FROM pg_class i
            JOIN pg_index ix ON ix.indexrelid = i.oid
            WHERE i.relname = 'uq_webhook_triggers_tenant_id_id'
              AND ix.indrelid = 'webhook_triggers'::regclass
              AND ix.indisunique
          ) THEN
            ALTER TABLE webhook_triggers
            ADD CONSTRAINT uq_webhook_triggers_tenant_id_id
            UNIQUE USING INDEX uq_webhook_triggers_tenant_id_id;
          ELSE
            ALTER TABLE webhook_triggers
            ADD CONSTRAINT uq_webhook_triggers_tenant_id_id
            UNIQUE (tenant_id, id);
          END IF;
        END IF;
      END
      $$
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_webhook_triggers_tenant_created
      ON webhook_triggers (tenant_id, created_at DESC)
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_webhook_trigger_events_tenant_trigger_created
      ON webhook_trigger_events (tenant_id, trigger_id, created_at DESC)
    `);
    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_webhook_trigger_events_tenant_trigger'
            AND conrelid = 'webhook_trigger_events'::regclass
        ) THEN
          ALTER TABLE webhook_trigger_events
          ADD CONSTRAINT fk_webhook_trigger_events_tenant_trigger
          FOREIGN KEY (tenant_id, trigger_id)
          REFERENCES webhook_triggers (tenant_id, id)
          ON DELETE CASCADE;
        END IF;
      END
      $$
    `);
  });
}

export async function listTriggers(tenantId: number): Promise<WebhookTrigger[]> {
  assertValidTenantId(tenantId);
  await ensureTriggerTables();
  const result = await db.execute(sql`
    SELECT w.*, p.name as persona_name
    FROM webhook_triggers w
    LEFT JOIN personas p ON p.id = w.persona_id
    WHERE w.tenant_id = ${tenantId}
    ORDER BY w.created_at DESC
  `);
  const rows = (result as any).rows || result;
  return (rows || []).map((r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
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
  tenantId: number;
  name: string;
  description?: string;
  personaId?: number | null;
}): Promise<WebhookTrigger> {
  assertValidTenantId(config.tenantId);
  await ensureTriggerTables();
  const webhookKey = crypto.randomBytes(16).toString("hex");

  const result = await db.execute(sql`
    INSERT INTO webhook_triggers (tenant_id, name, description, webhook_key, persona_id)
    VALUES (${config.tenantId}, ${config.name}, ${config.description || ""}, ${webhookKey}, ${config.personaId || null})
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  const r = rows[0];
  return {
    id: r.id,
    tenantId: r.tenant_id,
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

export async function deleteTrigger(id: number, tenantId: number): Promise<void> {
  assertValidTenantId(tenantId);
  await db.execute(sql`DELETE FROM webhook_trigger_events WHERE trigger_id = ${id} AND tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM webhook_triggers WHERE id = ${id} AND tenant_id = ${tenantId}`);
}

export async function toggleTrigger(id: number, enabled: boolean, tenantId: number): Promise<void> {
  assertValidTenantId(tenantId);
  await db.execute(sql`UPDATE webhook_triggers SET enabled = ${enabled} WHERE id = ${id} AND tenant_id = ${tenantId}`);
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
  const triggerTenantId = Number(trigger.tenant_id);
  assertValidTenantId(triggerTenantId);

  try {
    const convKey = `trigger-${trigger.id}`;
    const conversationId = await getOrCreateTriggerConversation(convKey, trigger);

    const eventSummary = typeof payload === "string"
      ? payload
      : `Webhook event received: ${trigger.name}\n\nPayload:\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 2000)}\n\`\`\`\n\nPlease analyze this event and take appropriate action.`;

    const msgResult = await processMessage(conversationId, eventSummary, { tenantId: triggerTenantId, source: "webhook" });

    await db.execute(sql`
      UPDATE webhook_triggers
      SET last_triggered = NOW(), trigger_count = trigger_count + 1
      WHERE id = ${trigger.id} AND tenant_id = ${triggerTenantId}
    `);

    const responsePreview = msgResult.response.slice(0, 500);
    await db.execute(sql`
      INSERT INTO webhook_trigger_events (tenant_id, trigger_id, payload, response_preview, status)
      VALUES (${triggerTenantId}, ${trigger.id}, ${JSON.stringify(payload)}::jsonb, ${responsePreview}, 'success')
    `);

    return { success: true, response: msgResult.response };
  } catch (err: any) {
    await db.execute(sql`
      INSERT INTO webhook_trigger_events (tenant_id, trigger_id, payload, response_preview, status)
      VALUES (${triggerTenantId}, ${trigger.id}, ${JSON.stringify(payload)}::jsonb, ${err.message}, 'error')
    `).catch(() => {});
    return { success: false, error: err.message };
  }
}

async function getOrCreateTriggerConversation(convKey: string, trigger: any): Promise<number> {
  const triggerTenantId = Number(trigger.tenant_id ?? trigger.tenantId);
  assertValidTenantId(triggerTenantId);
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

  const conv = await storage.createConversation({
    tenantId: triggerTenantId,
    title: `Webhook: ${trigger.name}`,
    model: settings?.defaultModel || "gemini-2.5-flash",
    thinking: settings?.thinkingEnabled ?? false,
    personaId,
  });

  triggerConversations.set(convKey, conv.id);
  return conv.id;
}

export async function getTriggerEvents(triggerId: number, tenantId: number, limit: number = 20): Promise<WebhookEvent[]> {
  assertValidTenantId(tenantId);
  const result = await db.execute(sql`
    SELECT * FROM webhook_trigger_events
    WHERE trigger_id = ${triggerId} AND tenant_id = ${tenantId}
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

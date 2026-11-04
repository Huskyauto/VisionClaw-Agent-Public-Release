import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { conversations } from "../shared/schema";
import { DEFAULT_CHAT_MODEL_ID } from "./chat-model-default";
import { webhookThreadIdentity, resolveBoundWebhookConversation } from "./webhook-thread-routing";

interface ResolvedTrigger {
  id: number;
  tenant_id: number;
  persona_id: number | null;
  name: string;
  description: string | null;
}

/** Database lock protects allocation, not the later (potentially slow) model turn. */
export async function getThreadedWebhookConversation(
  trigger: ResolvedTrigger, payload: unknown,
  database: Pick<typeof db, "transaction"> = db,
): Promise<number> {
  const personaId = trigger.persona_id ?? (await storage.getActivePersona())?.id ?? null;
  const scope = {
    tenantId: Number(trigger.tenant_id), triggerId: trigger.id, personaId,
    configuration: JSON.stringify([trigger.name, trigger.description]),
  };
  const identity = webhookThreadIdentity(scope, payload);
  const id = await database.transaction(async (tx) => {
    const result: any = await tx.execute(sql`
      SELECT enabled, persona_id, name, description, thread_conversations
      FROM webhook_triggers
      WHERE id = ${scope.triggerId} AND tenant_id = ${scope.tenantId}
      FOR UPDATE
    `);
    const current = (result.rows ?? result)[0];
    if (!current || current.enabled !== true || current.persona_id !== trigger.persona_id
      || current.name !== trigger.name || current.description !== trigger.description) {
      throw new Error("Webhook trigger configuration changed or disabled; retry after review");
    }
    return resolveBoundWebhookConversation(scope, identity.key, current.thread_conversations, {
      read: async (conversationId) => {
        const rows: any = await tx.execute(sql`
          SELECT tenant_id, persona_id, deleted_at FROM conversations
          WHERE id = ${conversationId} AND tenant_id = ${scope.tenantId}
        `);
        const row = (rows.rows ?? rows)[0];
        return row ? { tenantId: row.tenant_id, personaId: row.persona_id, deletedAt: row.deleted_at } : undefined;
      },
      create: async () => {
        const settings = await storage.getSettings();
        const [conversation] = await tx.insert(conversations).values({
          tenantId: scope.tenantId,
          title: `Webhook: ${trigger.name}`,
          model: settings?.defaultModel || DEFAULT_CHAT_MODEL_ID,
          thinking: settings?.thinkingEnabled ?? false,
          personaId,
        }).returning({ id: conversations.id });
        return conversation.id;
      },
      save: async (bindings) => {
        await tx.execute(sql`
          UPDATE webhook_triggers SET thread_conversations = ${JSON.stringify(bindings)}::jsonb
          WHERE id = ${scope.triggerId} AND tenant_id = ${scope.tenantId}
        `);
      },
    });
  });
  console.log(`[webhook-routing] mode=${identity.mode}`);
  return id;
}

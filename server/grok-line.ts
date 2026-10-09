/** Isolated, durable Felix-to-Grok outbox. No inbound dispatch lives here. */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { grokOutbox, personas } from "@shared/schema";
import { validateSparkMessage } from "./spark-line";

export class GrokLineRateLimitError extends Error {
  constructor() { super("Grok line limit reached (20 messages/hour)"); }
}

export class GrokLineDisabledError extends Error {
  constructor() { super("Grok line is disabled"); }
}

function assertGrokLineEnabled() {
  if (process.env.GROK_LINE_ENABLED === "0") throw new GrokLineDisabledError();
}

export async function sendGrokMessage(
  tenantId: number, personaId: number, message: string, conversationId?: number,
): Promise<{ outboxId: number; queuedAt: Date }> {
  assertGrokLineEnabled();
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || personaId !== 2) {
    throw new Error("Only Felix may send messages to Grok");
  }
  const { ownerTenantId } = await import("./agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) throw new Error("Only the owner tenant may send messages to Grok");
  const text = validateSparkMessage(message);
  return db.transaction(async (tx) => {
    if (conversationId !== undefined) {
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        throw new Error("Invalid Grok line conversation");
      }
      const conv: any = await tx.execute(sql`
        SELECT id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}
          AND deleted_at IS NULL LIMIT 1
      `);
      if (!(conv.rows || conv).length) throw new Error("Grok line conversation is not owned by this tenant");
    }

    // Use a distinct lock namespace from Spark while serializing Grok's quota and dedup checks.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(711093, ${tenantId})`);
    const prior: any = await tx.execute(sql`
      SELECT id, created_at FROM grok_outbox
      WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
        AND message = ${text} AND conversation_id IS NOT DISTINCT FROM ${conversationId ?? null}
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC LIMIT 1
    `);
    const priorRow = (prior.rows || prior)[0];
    if (priorRow) return { outboxId: priorRow.id as number, queuedAt: priorRow.created_at as Date };

    const countResult: any = await tx.execute(sql`
      SELECT count(*)::int AS total FROM grok_outbox
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '1 hour'
    `);
    if (Number((countResult.rows || countResult)[0]?.total) >= 20) throw new GrokLineRateLimitError();
    const [row] = await tx.insert(grokOutbox).values({
      tenantId, personaId, message: text, conversationId,
    }).returning({ id: grokOutbox.id, createdAt: grokOutbox.createdAt });
    return { outboxId: row.id, queuedAt: row.createdAt };
  });
}

export async function listGrokMessages(tenantId: number, since: number) {
  assertGrokLineEnabled();
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(since) || since < 0) throw new Error("Invalid Grok line cursor");
  const rows = await db.select({
    id: grokOutbox.id, personaId: grokOutbox.personaId,
    agentName: personas.name, message: grokOutbox.message,
    conversationId: grokOutbox.conversationId, createdAt: grokOutbox.createdAt,
  }).from(grokOutbox).innerJoin(personas, eq(grokOutbox.personaId, personas.id))
    .where(and(eq(grokOutbox.tenantId, tenantId), gt(grokOutbox.id, since)))
    .orderBy(grokOutbox.id).limit(50);
  return { messages: rows, latestId: rows.at(-1)?.id ?? since };
}
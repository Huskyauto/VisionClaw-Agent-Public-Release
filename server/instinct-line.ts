/** Isolated, durable Felix-to-Instinct outbox. Inbound work stays on API v1 dispatch/follow-up. */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { instinctOutbox, personas } from "@shared/schema";
import { validateSparkMessage } from "./spark-line";

export class InstinctLineRateLimitError extends Error {
  constructor() { super("Instinct line limit reached (20 messages/hour)"); }
}

export class InstinctLineDisabledError extends Error {
  constructor() { super("Instinct line is disabled"); }
}

function assertInstinctLineEnabled() {
  if (process.env.INSTINCT_LINE_ENABLED === "0") throw new InstinctLineDisabledError();
}

async function assertOwnerTenant(tenantId: number) {
  const { ownerTenantId } = await import("./agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) throw new Error("Only the owner tenant may use Instinct Line");
}

export async function sendInstinctMessage(
  tenantId: number, personaId: number, message: string, conversationId?: number,
): Promise<{ outboxId: number; queuedAt: Date }> {
  assertInstinctLineEnabled();
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || personaId !== 2) {
    throw new Error("Only Felix may send messages to Instinct");
  }
  await assertOwnerTenant(tenantId);
  if (conversationId !== undefined && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
    throw new Error("Invalid Instinct line conversation");
  }
  const text = validateSparkMessage(message);
  return db.transaction(async (tx) => {
    if (conversationId !== undefined) {
      const conv: any = await tx.execute(sql`
        SELECT id FROM conversations
        WHERE id = ${conversationId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        LIMIT 1
      `);
      if (!(conv.rows || conv).length) {
        throw new Error("Instinct line conversation is not owned by this tenant");
      }
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(711094, ${tenantId})`);
    const prior: any = await tx.execute(sql`
      SELECT id, created_at FROM instinct_outbox
      WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
        AND message = ${text} AND conversation_id IS NOT DISTINCT FROM ${conversationId ?? null}
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC LIMIT 1
    `);
    const priorRow = (prior.rows || prior)[0];
    if (priorRow) return { outboxId: priorRow.id as number, queuedAt: priorRow.created_at as Date };

    const countResult: any = await tx.execute(sql`
      SELECT count(*)::int AS total FROM instinct_outbox
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '1 hour'
    `);
    if (Number((countResult.rows || countResult)[0]?.total) >= 20) throw new InstinctLineRateLimitError();
    const [row] = await tx.insert(instinctOutbox).values({
      tenantId, personaId, message: text, conversationId: conversationId ?? null,
    }).returning({ id: instinctOutbox.id, createdAt: instinctOutbox.createdAt });
    return { outboxId: row.id, queuedAt: row.createdAt };
  });
}

/** Poll all of the authenticated owner's Instinct messages; cursors are monotonic per outbox. */
export async function listInstinctMessages(tenantId: number, since: number) {
  assertInstinctLineEnabled();
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(since) || since < 0) {
    throw new Error("Invalid Instinct line cursor");
  }
  await assertOwnerTenant(tenantId);
  const rows = await db.select({
    id: instinctOutbox.id, personaId: instinctOutbox.personaId,
    agentName: personas.name, message: instinctOutbox.message,
    conversationId: instinctOutbox.conversationId, createdAt: instinctOutbox.createdAt,
  }).from(instinctOutbox).innerJoin(personas, eq(instinctOutbox.personaId, personas.id))
    .where(and(
      eq(instinctOutbox.tenantId, tenantId),
      gt(instinctOutbox.id, since),
    ))
    .orderBy(instinctOutbox.id).limit(50);
  return { messages: rows, latestId: rows.at(-1)?.id ?? since };
}
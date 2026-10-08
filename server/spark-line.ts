/** Durable, tenant-scoped Felix/Spark handoff and API thread ownership. */
import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { apiV1ConversationRuns, personas, sparkOutbox } from "@shared/schema";
import { sanitizeAgentOutput } from "./safety-layer";
import type { FelixExpertFailureReason } from "./felix-expert-route";

export class SparkLineRateLimitError extends Error {
  constructor() { super("Spark line limit reached (20 messages/hour)"); }
}

export class SparkLineContentError extends Error {
  constructor() {
    super("Spark Line message contains disallowed sensitive data or exceeds 4000 characters");
    this.name = "SparkLineContentError";
  }
}

/** A deterministic backstop for obvious secrets/identifiers, NOT a guarantee that all private data is detectable. */
export function validateSparkMessage(message: unknown): string {
  if (typeof message !== "string") throw new SparkLineContentError();
  const text = message.trim();
  if (text.length < 1 || text.length > 4000) throw new SparkLineContentError();
  if (/(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:\b(?:bearer|api[_ -]?key|password|secret|private[_ -]?key|customer(?:\s+record)?|client(?:\s+record)?)\b)|\bvc_[a-z0-9_-]{8,})/i.test(text))
    throw new SparkLineContentError();
  // Egress scanner catches credential formats beyond the obvious patterns above.
  // Reject instead of silently replacing text so Spark receives the exact sent bytes.
  if (sanitizeAgentOutput(text).redacted) throw new SparkLineContentError();
  return text;
}

export async function sendSparkMessage(tenantId: number, personaId: number, message: string, conversationId?: number):
  Promise<{ outboxId: number; queuedAt: Date }> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || personaId !== 2) {
    throw new SparkLineContentError();
  }
  const { ownerTenantId } = await import("./agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) throw new SparkLineContentError();
  const text = validateSparkMessage(message);
  return db.transaction(async (tx) => {
    if (conversationId !== undefined) {
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new SparkLineContentError();
      const conv: any = await tx.execute(sql`
        SELECT id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}
          AND deleted_at IS NULL LIMIT 1
      `);
      if (!(conv.rows || conv).length) throw new SparkLineContentError();
    }
    // Serialize the per-tenant rate-limit check and write across app instances.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(711092, ${tenantId})`);
    // Retried identical coordination signals for the same thread return the
    // existing event rather than delivering a second copy within ten minutes.
    const prior: any = await tx.execute(sql`
      SELECT id, created_at FROM spark_outbox
      WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
        AND message = ${text} AND conversation_id IS NOT DISTINCT FROM ${conversationId ?? null}
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC LIMIT 1
    `);
    const priorRow = (prior.rows || prior)[0];
    if (priorRow) return { outboxId: priorRow.id as number, queuedAt: priorRow.created_at as Date };
    const countResult: any = await tx.execute(sql`
      SELECT count(*)::int AS total FROM spark_outbox
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '1 hour'
    `);
    if (Number((countResult.rows || countResult)[0]?.total) >= 20) throw new SparkLineRateLimitError();
    const [row] = await tx.insert(sparkOutbox).values({ tenantId, personaId, message: text, conversationId }).returning({
      id: sparkOutbox.id, createdAt: sparkOutbox.createdAt,
    });
    return { outboxId: row.id, queuedAt: row.createdAt };
  });
}

export async function listSparkMessages(tenantId: number, since: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(since) || since < 0) throw new Error("Invalid Spark line cursor");
  const rows = await db.select({
    id: sparkOutbox.id, personaId: sparkOutbox.personaId,
    agentName: personas.name, message: sparkOutbox.message,
    conversationId: sparkOutbox.conversationId, createdAt: sparkOutbox.createdAt,
  }).from(sparkOutbox).innerJoin(personas, eq(sparkOutbox.personaId, personas.id))
    .where(and(eq(sparkOutbox.tenantId, tenantId), gt(sparkOutbox.id, since)))
    .orderBy(sparkOutbox.id).limit(50);
  return { messages: rows, latestId: rows.at(-1)?.id ?? since };
}

export async function registerApiV1Conversation(tenantId: number, conversationId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(conversationId) || conversationId <= 0)
    throw new Error("Invalid API conversation");
  // A forged conversation id cannot be registered for a different tenant.
  const result: any = await db.execute(sql`
    INSERT INTO api_v1_conversation_runs (tenant_id, conversation_id, status)
    SELECT ${tenantId}, id, 'idle' FROM conversations
    WHERE id = ${conversationId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id
  `);
  if ((result.rows || result).length !== 1) throw new Error("API conversation registration failed");
}

export async function isApiV1Conversation(tenantId: number, conversationId: number) {
  const rows = await db.select({ conversationId: apiV1ConversationRuns.conversationId })
    .from(apiV1ConversationRuns).where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
      eq(apiV1ConversationRuns.conversationId, conversationId),
      sql`${apiV1ConversationRuns.status} IN ('idle', 'running', 'complete', 'failed')`)).limit(1);
  return rows.length === 1;
}

/** A2A has durable task state but is never eligible for Spark API follow-ups. */
export async function registerA2ATask(tenantId: number, conversationId: number) {
  const result: any = await db.execute(sql`
    INSERT INTO api_v1_conversation_runs (tenant_id, conversation_id, status)
    SELECT ${tenantId}, id, 'a2a_running' FROM conversations
    WHERE id = ${conversationId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id
  `);
  if ((result.rows || result).length !== 1) throw new Error("A2A task registration failed");
}

export async function finishA2ATask(
  tenantId: number, conversationId: number, status: "a2a_complete" | "a2a_failed",
  failureReason: FelixExpertFailureReason | "processing_error" = "processing_error",
) {
  await db.update(apiV1ConversationRuns).set({
    status, failureReason: status === "a2a_failed" ? failureReason : null,
    failedAt: status === "a2a_failed" ? new Date() : null, updatedAt: new Date(),
  }).where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
    eq(apiV1ConversationRuns.conversationId, conversationId),
    eq(apiV1ConversationRuns.status, "a2a_running")));
}

export async function getA2ATaskStatus(tenantId: number, conversationId: number) {
  const rows = await db.select({
    status: apiV1ConversationRuns.status, reason: apiV1ConversationRuns.failureReason,
  }).from(apiV1ConversationRuns).where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
    eq(apiV1ConversationRuns.conversationId, conversationId),
    sql`${apiV1ConversationRuns.status} LIKE 'a2a_%'`)).limit(1);
  return rows[0] ?? null;
}

export async function getApiV1TurnStatus(tenantId: number, conversationId: number) {
  const rows = await db.select({
    status: apiV1ConversationRuns.status,
    reason: apiV1ConversationRuns.failureReason,
    failedAt: apiV1ConversationRuns.failedAt,
    completedReply: apiV1ConversationRuns.completedReply,
  })
    .from(apiV1ConversationRuns).where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
      eq(apiV1ConversationRuns.conversationId, conversationId))).limit(1);
  return rows[0] ?? null;
}

export async function sweepStaleApiV1Turns() {
  await db.execute(sql`
    UPDATE api_v1_conversation_runs
    SET status = CASE WHEN status = 'a2a_running' THEN 'a2a_failed' ELSE 'failed' END,
        failure_reason = 'timeout', failed_at = NOW(), updated_at = NOW()
    WHERE status IN ('running', 'a2a_running') AND updated_at <= NOW() - INTERVAL '15 minutes'
  `);
}

export function startSparkLineMaintenance() {
  const sweep = async () => {
    try { await sweepStaleApiV1Turns(); }
    catch (err) { console.error("[spark-line] timeout sweep failed", err); }
  };
  const purge = async () => {
    try {
      await db.execute(sql`DELETE FROM spark_outbox WHERE created_at < NOW() - INTERVAL '30 days'`);
      await db.execute(sql`DELETE FROM grok_outbox WHERE created_at < NOW() - INTERVAL '30 days'`);
      await db.execute(sql`DELETE FROM instinct_outbox WHERE created_at < NOW() - INTERVAL '30 days'`);
      // Browser form identities must remain durable for the lifetime of the
      // tenant: a saved form can be replayed long after the 30-day outbox
      // window, and deleting its receipt would start a second Felix turn.
      await db.execute(sql`DELETE FROM api_v1_followup_keys WHERE created_at < NOW() - INTERVAL '30 days'`);
    } catch (err) { console.error("[spark-line] retention sweep failed", err); }
  };
  void sweep();
  void purge();
  setInterval(() => { void sweep(); }, 30_000).unref();
  setInterval(() => { void purge(); }, 60 * 60_000).unref();
}

export async function claimApiV1Turn(tenantId: number, conversationId: number) {
  const rows = await db.update(apiV1ConversationRuns)
    .set({ status: "running", failureReason: null, failedAt: null, completedReply: null, updatedAt: new Date() })
    .where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
      eq(apiV1ConversationRuns.conversationId, conversationId),
      sql`${apiV1ConversationRuns.status} <> 'running'`,
      sql`${apiV1ConversationRuns.failureReason} IS DISTINCT FROM 'timeout'`))
    .returning({ conversationId: apiV1ConversationRuns.conversationId });
  return rows.length === 1;
}

/** Lock the run row before looking up the receipt, so concurrent retries cannot start twice. */
export async function claimApiV1FollowUp(tenantId: number, conversationId: number, clientKey: string,
    message: string, requestId: string, requirePreviousComplete = false,
    database: Pick<typeof db, "transaction"> = db): Promise<{ outcome: "claimed" | "duplicate" | "busy" | "mismatch"; requestId: string }> {
  const messageHash = createHash("sha256").update(message).digest("hex");
  return database.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`
      SELECT status, failure_reason FROM api_v1_conversation_runs
      WHERE tenant_id = ${tenantId} AND conversation_id = ${conversationId} FOR UPDATE
    `);
    const run = (locked.rows || locked)[0];
    if (!run) return { outcome: "busy", requestId };
    const found: any = await tx.execute(sql`
      SELECT message_hash, request_id FROM api_v1_followup_keys
      WHERE tenant_id = ${tenantId} AND conversation_id = ${conversationId} AND client_key = ${clientKey}
      LIMIT 1
    `);
    const receipt = (found.rows || found)[0];
    if (receipt) return {
      outcome: receipt.message_hash === messageHash ? "duplicate" : "mismatch",
      requestId: receipt.request_id,
    };
    // A retained timeout reason is historical once the independently reviewed,
    // atomically audited owner acknowledgement has changed this run to idle.
    // Failed/unacknowledged timeouts stay fenced; old request keys above still
    // resolve as duplicates rather than launching the failed work again.
    if (run.status === "running" || (run.failure_reason === "timeout" && run.status !== "idle"))
      return { outcome: "busy", requestId };
    // Private browser submissions are stricter than the public API contract:
    // an uncertain/failed prior turn is never implicitly retried there.
    if (requirePreviousComplete && !["idle", "complete"].includes(run.status))
      return { outcome: "busy", requestId };
    await tx.execute(sql`
      UPDATE api_v1_conversation_runs
      SET status = 'running', failure_reason = NULL, failed_at = NULL,
          completed_reply = NULL, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND conversation_id = ${conversationId}
    `);
    await tx.execute(sql`
      INSERT INTO api_v1_followup_keys (tenant_id, conversation_id, client_key, message_hash, request_id)
      VALUES (${tenantId}, ${conversationId}, ${clientKey}, ${messageHash}, ${requestId})
    `);
    return { outcome: "claimed", requestId };
  });
}

export async function finishApiV1Turn(
  tenantId: number, conversationId: number, status: "complete" | "failed",
  failureReason?: FelixExpertFailureReason,
) {
  let reason: string | null = status === "failed" ? (failureReason ?? "processing_error") : null;
  let reply: string | null = null;
  if (status === "complete") {
    const result: any = await db.execute(sql`
      SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND c.tenant_id = ${tenantId}
        AND m.tenant_id = ${tenantId} AND m.role = 'assistant'
        AND m.id > COALESCE((
          SELECT MAX(u.id) FROM messages u WHERE u.conversation_id = ${conversationId}
            AND u.tenant_id = ${tenantId} AND u.role = 'user'
        ), 0)
      ORDER BY m.id DESC LIMIT 1
    `);
    reply = (result.rows || result)[0]?.content ?? null;
    if (!reply?.trim()) {
      status = "failed";
      reason = "missing_reply";
    }
  }
  const rows = await db.update(apiV1ConversationRuns).set({
    status, failureReason: reason, failedAt: status === "failed" ? new Date() : null,
    completedReply: status === "complete" ? reply : null, updatedAt: new Date(),
  })
    .where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
      eq(apiV1ConversationRuns.conversationId, conversationId),
      eq(apiV1ConversationRuns.status, "running")))
    .returning({ status: apiV1ConversationRuns.status });
  return rows[0]?.status === "complete";
}
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { DEFAULT_CHAT_MODEL_ID } from "../chat-model-default";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { launchApiV1FollowUp } from "../api-v1-dispatch";
import { withTenantContext } from "../lib/tenant-context";
import { sanitizeAgentOutput } from "../safety-layer";
import { validateConnectorSend, wrapFelixText } from "./policy";

export class ConnectorError extends Error {}
type Binding = { tenantId: number; clientId: string; conversationId: number; allowWork?: boolean };
const safeContent = (row: any) => row ? ({
  id: row.id, role: row.role, createdAt: new Date(row.created_at).toISOString(),
  content: row.role === "assistant" ? wrapFelixText(row.content) : sanitizeAgentOutput(row.content).content,
}) : null;

/** Called only after owner OAuth consent, never by an arbitrary model/tool. */
export async function ensureClientThread(clientId: string, tenantId: number, transaction?:Pick<typeof db,"execute">): Promise<Binding> {
  if (tenantId !== ownerTenantId()) throw new ConnectorError("owner_required");
  if(!transaction) return db.transaction(tx=>ensureClientThread(clientId,tenantId,tx));
  const tx=transaction;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(711099, ${tenantId})`);
    const existing: any = await tx.execute(sql`SELECT conversation_id,allow_work FROM felix_line_clients WHERE tenant_id=${tenantId} AND client_id=${clientId}`);
    if (existing.rows[0]) return {tenantId, clientId, conversationId: existing.rows[0].conversation_id,allowWork:existing.rows[0].allow_work===true};
    const conv: any = await tx.execute(sql`INSERT INTO conversations (tenant_id,persona_id,title,model,thinking,thinking_level)
      VALUES (${tenantId},2,'Felix line: Claude',${DEFAULT_CHAT_MODEL_ID},true,'auto') RETURNING id`);
    const conversationId = conv.rows[0].id as number;
    await tx.execute(sql`INSERT INTO api_v1_conversation_runs (tenant_id,conversation_id,status) VALUES (${tenantId},${conversationId},'idle')`);
    await tx.execute(sql`INSERT INTO felix_line_clients (tenant_id,client_id,conversation_id) VALUES (${tenantId},${clientId},${conversationId})`);
    return {tenantId, clientId, conversationId,allowWork:false};
}
export async function clientBinding(clientId: string, tenantId: number): Promise<Binding> {
  if (tenantId !== ownerTenantId()) throw new ConnectorError("owner_required");
  const r: any = await db.execute(sql`
    SELECT l.conversation_id,l.allow_work FROM felix_line_clients l JOIN conversations c ON c.id=l.conversation_id
    WHERE l.tenant_id=${tenantId} AND l.client_id=${clientId} AND c.tenant_id=${tenantId} AND c.persona_id=2 AND c.deleted_at IS NULL`);
  if (!r.rows[0]) throw new ConnectorError("client_thread_unavailable");
  return {tenantId, clientId, conversationId: r.rows[0].conversation_id,allowWork:r.rows[0].allow_work===true};
}
/** Owner browser control plane only. Persist the change and its audit together. */
export async function setClientWorkPermission(b: Binding, allowWork: boolean, transaction?:Pick<typeof db,"execute">):Promise<{ok:true;allowWork:boolean}> {
  if (b.tenantId !== ownerTenantId()) throw new ConnectorError("owner_required");
  if (typeof allowWork !== "boolean") throw new ConnectorError("invalid_permission");
  if(!transaction) return db.transaction(tx=>setClientWorkPermission(b,allowWork,tx));
  const tx=transaction;
    const r:any = await tx.execute(sql`UPDATE felix_line_clients SET allow_work=${allowWork}
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND conversation_id=${b.conversationId}
      RETURNING client_id`);
    if (!r.rows[0]) throw new ConnectorError("client_thread_unavailable");
    await tx.execute(sql`INSERT INTO felix_line_audit (tenant_id,client_id,tool,ok,error)
      VALUES (${b.tenantId},${b.clientId},'owner_work_permission',true,${allowWork?'work_enabled':'work_disabled'})`);
    return {ok:true as const,allowWork};
}
async function threadState(b: Binding, database: Pick<typeof db, "execute"> = db) {
  const r: any = await database.execute(sql`SELECT r.*, c.model AS saved_model
    FROM api_v1_conversation_runs r JOIN conversations c ON c.id=r.conversation_id
    WHERE r.tenant_id=${b.tenantId} AND r.conversation_id=${b.conversationId} AND c.tenant_id=${b.tenantId} AND c.deleted_at IS NULL`);
  if (!r.rows[0]) throw new ConnectorError("thread_unavailable");
  return r.rows[0];
}
async function messageRows(b: Binding, limit: number, before?: number, database: Pick<typeof db, "execute"> = db) {
  const r: any = await database.execute(sql`SELECT m.id,m.role,m.content,m.created_at FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    WHERE m.tenant_id=${b.tenantId} AND c.tenant_id=${b.tenantId} AND m.conversation_id=${b.conversationId}
      AND c.deleted_at IS NULL ${before ? sql`AND m.id < ${before}` : sql``}
    ORDER BY m.id DESC LIMIT ${limit}`);
  return r.rows as any[];
}
function metadata(run: any) {
  // Only a completed inference carries served-model evidence.
  const complete = run.status === "complete";
  const observedModel = complete ? run.observed_model ?? null : null;
  const resolvedModel = complete ? run.resolved_model ?? null : null;
  return {model: observedModel || resolvedModel || run.saved_model || null, observedModel, resolvedModel,
    modelEvidence: observedModel ? "provider_reported" : resolvedModel ? "route_resolved" : "saved_preference_only"};
}
export async function getThread(b: Binding) {
  const run = await threadState(b);
  const rows = await messageRows(b, 50);
  const count: any = await db.execute(sql`SELECT count(*)::int AS n FROM messages WHERE tenant_id=${b.tenantId} AND conversation_id=${b.conversationId}`);
  return {conversationId: b.conversationId, status: run.status === "idle" ? "pending" : run.status,
    permissions:{messages:true,work:b.allowWork===true},
    lastUserMessage: safeContent(rows.find(r => r.role === "user")),
    lastAssistantMessage: safeContent(rows.find(r => r.role === "assistant")),
    messageCount: count.rows[0].n, ...metadata(run),
    ...(run.status === "failed" ? {reason: run.failure_reason || "processing_error", failedAt: run.failed_at} : {})};
}
export async function listMessages(b: Binding, limit = 10, before?: number) {
  return {messages: (await messageRows(b, limit, before)).map(safeContent)};
}
export async function checkOutbox(b: Binding) {
  return db.transaction(async tx => {
    const c: any = await tx.execute(sql`SELECT outbox_cursor,delivered_id FROM felix_line_clients
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} FOR UPDATE`);
    if (!c.rows[0]) throw new ConnectorError("client_thread_unavailable");
    const cursor = c.rows[0].outbox_cursor as number;
    const r: any = await tx.execute(sql`SELECT id,message,created_at,conversation_id FROM spark_outbox
      WHERE tenant_id=${b.tenantId} AND recipient='claude' AND conversation_id=${b.conversationId} AND id > ${cursor}
      ORDER BY id LIMIT 20`);
    const latestId = r.rows.at(-1)?.id ?? cursor;
    await tx.execute(sql`UPDATE felix_line_clients SET delivered_id=GREATEST(delivered_id,${latestId})
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId}`);
    return {messages: r.rows.map((r: any) => ({id: r.id, conversationId: r.conversation_id,
      createdAt: new Date(r.created_at).toISOString(), message: wrapFelixText(r.message)})), latestId};
  });
}
export async function ackOutbox(b: Binding, upTo: number) {
  const r: any = await db.execute(sql`UPDATE felix_line_clients SET outbox_cursor=${upTo}
    WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND outbox_cursor <= ${upTo} AND delivered_id >= ${upTo}
      AND (${upTo}=outbox_cursor OR EXISTS (SELECT 1 FROM spark_outbox o
        WHERE o.tenant_id=${b.tenantId} AND o.recipient='claude' AND o.conversation_id=${b.conversationId} AND o.id=${upTo}))
    RETURNING outbox_cursor`);
  if (!r.rows[0]) throw new ConnectorError("cursor_not_delivered_or_regressed");
  return {outboxCursor: r.rows[0].outbox_cursor};
}
/** Snapshot the previous receipt under the client lock before a new turn can
 * overwrite API run state. The same lock is used by the completion callback. */
async function reconcile(b: Binding, tx: any) {
  const run = await threadState(b, tx);
  if (run.status === "running" || run.status === "idle") return;
  const rows = await messageRows(b, 1, undefined, tx);
  const terminal = {status: run.status, conversationId: b.conversationId,
    ...(run.status === "complete" ? {assistantMessageId: rows.find(r => r.role === "assistant")?.id ?? null,
      reply: wrapFelixText(run.completed_reply ?? rows.find(r => r.role === "assistant")?.content ?? ""),
      ...metadata(run)} : {reason: run.failure_reason || "processing_error"})};
  await tx.execute(sql`UPDATE felix_line_turns SET result=${JSON.stringify(terminal)}::jsonb
    WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND result IS NULL`);
}
export async function getTurn(b: Binding, requestId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT client_id FROM felix_line_clients WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} FOR UPDATE`);
    await reconcile(b, tx);
    const r: any = await tx.execute(sql`SELECT result FROM felix_line_turns
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND request_id=${requestId} AND conversation_id=${b.conversationId}`);
    if (!r.rows[0]) throw new ConnectorError("turn_not_found");
    const result = r.rows[0].result || {status: "running", conversationId: b.conversationId};
    // Retained receipts may predate output filtering. Clean their projection,
    // not the stored evidence, so reconnects/retries cannot re-expose reasoning.
    return {requestId, ...result,
      ...(result.status === "complete" && typeof result.reply?.content === "string"
        ? {reply: wrapFelixText(result.reply.content)} : {})};
  });
}
export async function sendMessage(b: Binding, input: unknown, launch = launchApiV1FollowUp) {
  const args = validateConnectorSend(input);
  const hash = createHash("sha256").update(args.message).digest("hex");
  const claim = await db.transaction(async tx => {
    const locked: any = await tx.execute(sql`SELECT l.client_id,l.allow_work FROM felix_line_clients l JOIN conversations c ON c.id=l.conversation_id
      WHERE l.tenant_id=${b.tenantId} AND l.client_id=${b.clientId} AND l.conversation_id=${b.conversationId}
        AND c.tenant_id=${b.tenantId} AND c.deleted_at IS NULL FOR UPDATE OF l`);
    if (!locked.rows[0]) throw new ConnectorError("client_thread_unavailable");
    const prior: any = await tx.execute(sql`SELECT request_id,message_hash FROM felix_line_turns
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND idempotency_key=${args.idempotency_key}`);
    if (prior.rows[0]) {
      if (prior.rows[0].message_hash !== hash) throw new ConnectorError("idempotency_key_text_mismatch");
      return {requestId: prior.rows[0].request_id as string, launched: false};
    }
    const run: any = await tx.execute(sql`SELECT status,failure_reason FROM api_v1_conversation_runs
      WHERE tenant_id=${b.tenantId} AND conversation_id=${b.conversationId} FOR UPDATE`);
    if (!run.rows[0]) throw new ConnectorError("thread_unavailable");
    if (run.rows[0].failure_reason === "timeout") throw new ConnectorError("blocked: thread timed out and needs reconciling");
    if (run.rows[0].status === "running") throw new ConnectorError("busy: a turn is already running, do not resend");
    await reconcile(b, tx);
    const recent: any = await tx.execute(sql`SELECT count(*)::int AS n FROM felix_line_turns
      WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND created_at > NOW()-INTERVAL '1 hour'`);
    if (recent.rows[0].n >= 10) throw new ConnectorError("rate_limit: ten sends per hour");
    const requestId = randomUUID();
    await tx.execute(sql`INSERT INTO felix_line_turns (request_id,tenant_id,client_id,conversation_id,idempotency_key,message_hash)
      VALUES (${requestId},${b.tenantId},${b.clientId},${b.conversationId},${args.idempotency_key},${hash})`);
    await tx.execute(sql`INSERT INTO felix_line_audit (tenant_id,client_id,tool,request_id,ok,error)
      VALUES (${b.tenantId},${b.clientId},'connector_send_authority',${requestId},true,${locked.rows[0].allow_work===true?'work_enabled':'messages_only'})`);
    await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='running',failure_reason=NULL,failed_at=NULL,
      completed_reply=NULL,observed_model=NULL,resolved_model=NULL,updated_at=NOW()
      WHERE tenant_id=${b.tenantId} AND conversation_id=${b.conversationId}`);
    return {requestId, launched: true,allowWork:locked.rows[0].allow_work===true};
  });
  if (claim.launched) {
    withTenantContext({tenantId: b.tenantId, source: "explicit"}, () =>
      launch(b.tenantId, b.conversationId, `[Claude] ${args.message}`, {
        ...(claim.allowWork ? {delegatedWork:true as const} : {messagingOnly:true as const}),
        onSettled: async () => { await getTurn(b, claim.requestId); },
      }));
  }
  return {conversationId: b.conversationId, status: "running" as const, requestId: claim.requestId};
}
export async function auditCall(b: Binding, tool: string, ok: boolean, error?: string, requestId?: string) {
  const r: any = await db.execute(sql`INSERT INTO felix_line_audit (tenant_id,client_id,tool,request_id,ok,error)
    VALUES (${b.tenantId},${b.clientId},${tool},${requestId ?? null},${ok},${error ?? null}) RETURNING id`);
  return r.rows[0].id as number;
}
export async function finishAudit(b: Binding, id: number, ok: boolean, error?: string, requestId?: string) {
  await db.execute(sql`UPDATE felix_line_audit SET ok=${ok},error=${error ?? null},request_id=${requestId ?? null}
    WHERE tenant_id=${b.tenantId} AND client_id=${b.clientId} AND id=${id}`);
}

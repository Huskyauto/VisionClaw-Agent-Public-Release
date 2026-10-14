import { randomUUID } from "node:crypto";

/** Public topic vocabulary only. Never forward task text, files, or model output. */
const TOPICS = [
  "model routing", "security", "tenant isolation", "testing", "architecture",
  "website", "pricing", "video", "delivery", "research", "memory", "workflow",
  "jury", "deployment", "persona", "API", "performance",
] as const;

export type MuseContextState = {
  status: "not_requested" | "pending" | "unavailable" | "unconfirmed";
  requestId?: string;
  outboxId?: number;
  transport: "spark_outbox";
  subscriptionUsageVerified: false;
};

export function buildMuseContextPacket(content: string, requestId = randomUUID()) {
  const lower = content.toLowerCase();
  return {
    protocol: "muse-context-v1",
    requestId,
    topics: TOPICS.filter(topic => lower.includes(topic.toLowerCase())),
    contextScope: "public_topic_labels_only",
    request: "Provide relevant considerations, evidence, risks and questions for these topics. Topic labels are not the full task; do not guess missing facts.",
    replyShape: { requestId, context: [], evidence: [], risks: [], questions: [] },
    authority: "advisory_only",
    delivery: "Reply through the existing authenticated Spark Line. Queued is not received.",
  };
}

export async function requestMuseContext(
  context: { tenantId: number; ownerTenantId: number; conversationId: number; content: string; source?: string; enabled?: boolean },
  send: (message: string) => Promise<{ outboxId: number }>,
): Promise<MuseContextState> {
  const base = { transport: "spark_outbox" as const, subscriptionUsageVerified: false as const };
  // Inbound Muse/agent replies and internal substeps must not start echo loops.
  if (!(context.enabled ?? process.env.MUSE_CONTEXT_ENABLED !== "0") ||
      !Number.isSafeInteger(context.ownerTenantId) || context.ownerTenantId <= 0 ||
      context.tenantId !== context.ownerTenantId ||
      !Number.isSafeInteger(context.conversationId) || context.conversationId <= 0 ||
      context.source === "api-v1" || context.source === "a2a" ||
      context.source?.startsWith("subagent:")) return { ...base, status: "not_requested" };
  const packet = buildMuseContextPacket(context.content);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = Promise.resolve().then(() => send(JSON.stringify(packet)));
    pending.catch(() => {}); // A deadline does not cancel a possible late write.
    const queued = await Promise.race([
      pending,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1_500); }),
    ]);
    if (!queued) return { ...base, status: "unconfirmed", requestId: packet.requestId };
    if (!Number.isSafeInteger(queued.outboxId) || queued.outboxId <= 0) throw new Error("Invalid queue receipt");
    return { ...base, status: "pending", requestId: packet.requestId, outboxId: queued.outboxId };
  } catch {
    // Existing transactional queue limits remain authoritative; never retry or
    // substitute a metered Muse API call when the subscription chat is absent.
    return { ...base, status: "unavailable", requestId: packet.requestId };
  } finally {
    clearTimeout(timer);
  }
}

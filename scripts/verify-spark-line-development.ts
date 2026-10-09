/** Development-only DB seam smoke; no model calls, no API keys, no production mutation. */
import { and, eq } from "drizzle-orm";
import { ownerTenantId } from "../server/agentic/autonomous-budget";
import { db } from "../server/db";
import { storage } from "../server/storage";
import "../server/tools/domains/spark-line";
import { getMigratedHandler } from "../server/tools/registry";
import {
  apiV1ConversationRuns, conversations, sparkOutbox,
} from "../shared/schema";
import {
  claimApiV1FollowUp, getApiV1TurnStatus, finishApiV1Turn, listSparkMessages,
  registerApiV1Conversation, sweepStaleApiV1Turns,
} from "../server/spark-line";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("This check is development-only");
  }
  const tenantId = ownerTenantId();
  const conv = await storage.createConversation({
    title: "Spark Line development seam check",
    model: "gpt-5.4", thinking: false, thinkingLevel: "off", personaId: 2, tenantId,
  });
  try {
    await registerApiV1Conversation(tenantId, conv.id);
    const text = "The draft is ready at /docs/q3-review.md — please check section 3 and tell me if the numbers match.";
    const handler = getMigratedHandler("spark_send_message");
    if (!handler) throw new Error("Felix Spark Line tool is not registered");
    const sent = await handler({ message: text }, { tenantId, personaId: 2, conversationId: conv.id });
    if (!("outboxId" in sent) || typeof sent.outboxId !== "number") throw new Error("Felix tool did not queue the message");
    const listed = await listSparkMessages(tenantId, sent.outboxId - 1);
    const outboxRow = listed.messages.find((m) => m.id === sent.outboxId);
    if (outboxRow?.message !== text || outboxRow.conversationId !== conv.id || outboxRow.personaId !== 2)
      throw new Error("Outbox text or conversation identity mismatch");
    const key = `dev-seam-${conv.id}`;
    const [one, two] = await Promise.all([
      claimApiV1FollowUp(tenantId, conv.id, key, "Review section 3", "request-first"),
      claimApiV1FollowUp(tenantId, conv.id, key, "Review section 3", "request-retry"),
    ]);
    const [first, retry] = one.outcome === "claimed" ? [one, two] : [two, one];
    const mismatch = await claimApiV1FollowUp(tenantId, conv.id, key, "Different body", "request-other");
    if (first.outcome !== "claimed" || retry.outcome !== "duplicate" ||
        retry.requestId !== first.requestId || mismatch.outcome !== "mismatch")
      throw new Error("Idempotency receipt mismatch");
    await storage.createMessage({ conversationId: conv.id, tenantId, role: "user", content: "Review section 3" });
    const reply = "Full reply: " + "answer ".repeat(10_000);
    await storage.createMessage({ conversationId: conv.id, tenantId, role: "assistant", content: reply });
    if (!(await finishApiV1Turn(tenantId, conv.id, "complete"))) throw new Error("Completion failed");
    const completed = await getApiV1TurnStatus(tenantId, conv.id);
    if (completed?.status !== "complete" || completed.completedReply !== reply)
      throw new Error("Persisted complete reply was lost or truncated");
    const next = await claimApiV1FollowUp(tenantId, conv.id, `${key}-next`, "Second turn", "request-next");
    if (next.outcome !== "claimed") throw new Error("Subsequent turn was not claimable");
    await db.update(apiV1ConversationRuns).set({
      updatedAt: new Date(Date.now() - 16 * 60_000),
    }).where(and(eq(apiV1ConversationRuns.tenantId, tenantId), eq(apiV1ConversationRuns.conversationId, conv.id)));
    await sweepStaleApiV1Turns();
    const timedOut = await getApiV1TurnStatus(tenantId, conv.id);
    if (timedOut?.status !== "failed" || timedOut.reason !== "timeout" || !timedOut.failedAt)
      throw new Error("Watchdog did not persist timeout");
    if (await finishApiV1Turn(tenantId, conv.id, "complete"))
      throw new Error("Late worker overwrote timeout");
    const blocked = await claimApiV1FollowUp(tenantId, conv.id, `${key}-third`, "Third turn", "request-third");
    if (blocked.outcome !== "busy") throw new Error("Timed-out worker lock was released");
    console.log("Spark Line development seam: outbox, exact text, concurrent retry, complete reply, timeout lock PASS");
  } finally {
    await db.delete(sparkOutbox).where(and(eq(sparkOutbox.tenantId, tenantId), eq(sparkOutbox.conversationId, conv.id)));
    await db.delete(conversations).where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, tenantId)));
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Spark Line development seam FAILED:", err);
  process.exit(1);
});
/** API-origin run outcome exposed to Spark. This function never truncates replies. */
export function formatSparkLinePollOutcome(
  status: "pending" | "running" | "complete" | "failed",
  run: { completedReply: string | null; reason: string | null; failedAt: Date | null },
  lastAssistant: { id: number; content: string; created_at: Date } | null,
  markedApiConversation: boolean,
) {
  if (status === "complete") {
    if (markedApiConversation && !run.completedReply) throw new Error("Conversation reply unavailable");
    return {
      lastAssistantMessage: {
        id: lastAssistant?.id ?? null,
        content: markedApiConversation ? run.completedReply : lastAssistant?.content ?? null,
        createdAt: lastAssistant?.created_at ?? null,
      },
    };
  }
  return {
    lastAssistantMessage: lastAssistant
      ? { id: lastAssistant.id, content: lastAssistant.content, createdAt: lastAssistant.created_at }
      : null,
    ...(status === "failed" ? { reason: run.reason || "processing_error", failedAt: run.failedAt } : {}),
  };
}
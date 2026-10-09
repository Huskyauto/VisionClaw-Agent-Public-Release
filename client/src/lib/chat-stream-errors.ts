type ChatStreamEvent = {
  type?: string;
  error?: unknown;
  content?: unknown;
  done?: unknown;
};

/** Recoverable tool failures are shown in the tool trace, not as chat-fatal alerts. */
export function isUnrecoverableChatStreamError(event: ChatStreamEvent): boolean {
  // "fatal_error" has its own handler; other named events are progress/telemetry,
  // even when they carry an error field for the agent to recover from.
  if (event.type !== undefined && event.type !== "error") return false;
  return Boolean(event.error && !event.content && !event.done);
}
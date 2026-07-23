/**
 * AG-UI event builders — pure, dependency-free encoders for the AG-UI
 * agent-to-UI wire protocol (https://docs.ag-ui.com), the format adopted by
 * LangChain, Mastra, PydanticAI, AWS, and Microsoft as the standard way an
 * agent backend streams to a third-party frontend.
 *
 * VisionClaw owns both ends of its own UI, so this exists ONLY for the
 * external embedding surface (/api/v1/agui/run): a customer embedding a
 * VisionClaw persona in their own app speaks AG-UI instead of our internal
 * SSE shape. Coarse-grained emission (post-completion replay of the turn)
 * is protocol-compliant — streaming granularity is optional in AG-UI.
 *
 * Pure functions only: no I/O, no imports from server internals, so the
 * test suite can pin the wire contract without touching the DB.
 */

export interface AguiToolUse {
  name: string;
  input: any;
  output: any;
}

export type AguiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; messageId: string; toolCallId: string; content: string; role: "tool" };

/** Serialize one AG-UI event as an SSE frame. */
export function encodeAguiSse(event: AguiEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Max chars of a tool result forwarded on the public wire. */
export const AGUI_TOOL_RESULT_CAP = 4000;
/** Chunk size for TEXT_MESSAGE_CONTENT deltas. */
export const AGUI_TEXT_CHUNK = 800;

function capString(value: unknown, cap: number): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (s == null) s = "";
  return s.length > cap ? `${s.slice(0, cap)}… [truncated ${s.length - cap} chars]` : s;
}

/**
 * Build the full ordered AG-UI event sequence for one completed VisionClaw
 * turn: RUN_STARTED → tool-call triples (start/args/end/result) → assistant
 * text message (start, content chunks, end) → RUN_FINISHED.
 */
export function buildTurnEvents(params: {
  threadId: string;
  runId: string;
  messageId: string;
  response: string;
  toolsUsed?: AguiToolUse[] | null;
}): AguiEvent[] {
  const { threadId, runId, messageId, response } = params;
  const events: AguiEvent[] = [{ type: "RUN_STARTED", threadId, runId }];

  const tools = Array.isArray(params.toolsUsed) ? params.toolsUsed : [];
  tools.forEach((t, i) => {
    const toolCallId = `${runId}-tool-${i}`;
    events.push({ type: "TOOL_CALL_START", toolCallId, toolCallName: String(t?.name || "unknown"), parentMessageId: messageId });
    events.push({ type: "TOOL_CALL_ARGS", toolCallId, delta: capString(t?.input ?? {}, AGUI_TOOL_RESULT_CAP) });
    events.push({ type: "TOOL_CALL_END", toolCallId });
    events.push({
      type: "TOOL_CALL_RESULT",
      messageId: `${messageId}-toolresult-${i}`,
      toolCallId,
      content: capString(t?.output ?? "", AGUI_TOOL_RESULT_CAP),
      role: "tool",
    });
  });

  events.push({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
  const text = typeof response === "string" ? response : String(response ?? "");
  if (text.length === 0) {
    events.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: "" });
  } else {
    for (let i = 0; i < text.length; i += AGUI_TEXT_CHUNK) {
      events.push({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text.slice(i, i + AGUI_TEXT_CHUNK) });
    }
  }
  events.push({ type: "TEXT_MESSAGE_END", messageId });
  events.push({ type: "RUN_FINISHED", threadId, runId });
  return events;
}

/**
 * Parse an AG-UI thread id back to a VisionClaw conversation id.
 * Only the exact `vc-conv-<positiveInt>` shape maps; anything else → null
 * (fail closed — an unparseable threadId means "start a new conversation",
 * never "guess a conversation").
 */
export function parseAguiThreadId(threadId: unknown): number | null {
  if (typeof threadId !== "string") return null;
  const m = /^vc-conv-([0-9]{1,12})$/.exec(threadId);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function makeAguiThreadId(conversationId: number): string {
  return `vc-conv-${conversationId}`;
}

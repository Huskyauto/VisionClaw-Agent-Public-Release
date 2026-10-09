import { createHash } from "node:crypto";
import type { DeferredResearchCall } from "./chat-tool-budget-resume";

export type PendingContextIntent = "none" | "inspect" | "resume";
export type ContextProvenance = {
  source: "system" | "resume" | "conversation" | "tool";
  source_id: string;
  injected_at: string;
  trust: "user" | "authenticated-system" | "untrusted-third-party";
  role: string;
  sha256: string;
  instruction_authority?: "policy" | "user" | "none";
  quarantined?: boolean;
};
export type TurnContextManifest = {
  version: 1;
  conversationId: number;
  userMessageId: number;
  blocks: ContextProvenance[];
  inferenceReceipts?: Array<{ requestedModel: string; responseModel: string | null; providerLane: string | null; observedAt: string }>;
};

/** Deliberately explicit: bare acknowledgements and unrelated tasks cannot resume work. */
export function pendingContextIntent(text: string): PendingContextIntent {
  if (/\b(?:provenance|source|where|trace|inspect)\b/i.test(text) &&
      /\b(?:note|context|resume|deferred|pending research)\b/i.test(text)) return "inspect";
  if (/\b(?:do not|don't|never|without)\s+(?:resume|continue|finish|complete|replay)\b/i.test(text)) return "none";
  return /^(?:\[Felix line\]\s*)?(?:please\s+)?(?:resume|continue|finish|complete|pick up)\s+(?:the\s+)?(?:deferred|pending)\s+research\b/i.test(text.trim())
    ? "resume" : "none";
}

export function assembleTurnContext(input: {
  messages: ReadonlyArray<{ role: string; content?: unknown; [key: string]: unknown }>;
  pending?: { resumeId: string; deferredCalls: DeferredResearchCall[] } | null;
  intent: PendingContextIntent;
  conversationId: number;
  userMessageId: number;
  injectedAt: string;
}): { messages: typeof input.messages[number][]; manifest: TurnContextManifest } {
  const messages = input.messages.map((message) => ({ ...message }));
  const blocks: ContextProvenance[] = messages.map((message, index) => ({
    source: message.role === "system" ? "system" : message.role === "tool" ? "tool" : "conversation",
    source_id: message.role === "system"
      ? `assembled-system:${input.conversationId}:${input.userMessageId}:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`
      : `turn:${input.userMessageId}:context-message:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`,
    injected_at: input.injectedAt,
    trust: message.role === "user" ? "user" : message.role === "system" ? "authenticated-system" : "untrusted-third-party",
    role: message.role,
    instruction_authority: message.role === "system" ? "policy" : message.role === "user" ? "user" : "none",
    sha256: createHash("sha256").update(JSON.stringify(message)).digest("hex"),
  }));
  if (input.pending && input.intent !== "none") {
    const data = {
      kind: "background_context_data",
      instruction: false,
      resume_id: input.pending.resumeId,
      state: "pending",
      tool_names: input.pending.deferredCalls.map((call) => call.toolName),
    };
    const provenance: ContextProvenance = {
      source: "resume",
      source_id: `pipeline_stage_artifacts:chat-tool-budget-${input.pending.resumeId}:research_resume`,
      injected_at: input.injectedAt,
      trust: "untrusted-third-party",
      instruction_authority: "none",
      quarantined: true,
      role: "assistant",
      sha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    };
    // The real user request remains last. No synthetic user role, imperative
    // text, tool arguments, or executor authority is introduced by this data.
    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    if (lastUserIndex >= 0) {
      messages.splice(lastUserIndex, 0, { role: "assistant", content: JSON.stringify({ ...data, provenance }) });
      blocks.splice(lastUserIndex, 0, provenance);
    }
  }
  return { messages, manifest: { version: 1, conversationId: input.conversationId, userMessageId: input.userMessageId, blocks } };
}

export async function prepareTurnContext(input: Omit<Parameters<typeof assembleTurnContext>[0], "pending" | "intent"> & {
  userText: string;
  readPending: () => Promise<NonNullable<Parameters<typeof assembleTurnContext>[0]["pending"]> | null>;
  claimPending: () => Promise<NonNullable<Parameters<typeof assembleTurnContext>[0]["pending"]> | null>;
}) {
  const intent = pendingContextIntent(input.userText);
  const pending = intent === "resume" ? await input.claimPending()
    : intent === "inspect" ? await input.readPending() : null;
  const messages = input.messages.map((message, index) => {
    // Older affected transcripts contain the server note echoed into assistant
    // prose/tool metadata. Retain the transcript itself for inspection, but do
    // not feed those contaminated answers back as current-task instructions.
    if (message.role !== "assistant" || typeof message.content !== "string" ||
        !/\b(?:pending deferred research|authenticated conversation context note)\b/i.test(message.content) ||
        !/\bresume\s+[a-f0-9]{24}\b/i.test(message.content)) return message;
    return { ...message, content: JSON.stringify({
      kind: "quarantined_historical_context", instruction: false,
      source: "system", source_id: `conversation:${input.conversationId}:context-message:${index}`,
      injected_at: input.injectedAt, trust: "untrusted-third-party",
      original_sha256: createHash("sha256").update(message.content).digest("hex"),
      retrieval: "sessions_history", reason: "obsolete_auto_resume_note_in_unrelated_task",
    }) };
  });
  return assembleTurnContext({ ...input, messages, intent, pending });
}

/** Metadata stays outside the stable cached system prefix and outside user text. */
export function provenanceFrameForContext(input: Omit<Parameters<typeof assembleTurnContext>[0], "pending" | "intent"> & {
  priorBlocks?: ContextProvenance[];
}) {
  const prepared = assembleTurnContext({ ...input, intent: "none" });
  const union = new Map((input.priorBlocks ?? []).map((block) => [block.source_id, block]));
  for (const block of prepared.manifest.blocks) {
    if (!union.has(block.source_id)) union.set(block.source_id, block);
  }
  if (union.size > 512) throw new Error("Context provenance exceeded its bounded block budget");
  prepared.manifest.blocks = [...union.values()];
  // Actual conversation messages are already addressable through the transcript.
  // The frame identifies server-added policy/context and tool data without
  // disclosing system-prompt text or copying third-party content into instructions.
  const visible = prepared.manifest.blocks.filter((block) => block.source !== "conversation");
  const frame = { role: "assistant", content: JSON.stringify({
    kind: "context_provenance_manifest", instruction: false,
    evidence_kind: "prepared_model_context",
    conversation_id: input.conversationId, user_message_id: input.userMessageId,
    blocks: visible,
  }) };
  const lastUserIndex = prepared.messages.findLastIndex((message) => message.role === "user");
  if (lastUserIndex >= 0) prepared.messages.splice(lastUserIndex, 0, frame);
  return prepared;
}

export async function contextOperationWithDeadline<T>(operation: Promise<T>, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Context provenance deadline exceeded")), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
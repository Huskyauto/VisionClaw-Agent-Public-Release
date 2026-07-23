// ─────────────────────────────────────────────────────────────────────────────
// R91 — <tool_call> fallback parser (ported from Hermes Alpha agent_loop.py)
// ─────────────────────────────────────────────────────────────────────────────
// Some providers (Hermes/Qwen-format models, vanilla vLLM endpoints, certain
// Kimi setups) emit raw <tool_call>{...}</tool_call> tags inside the assistant
// message content instead of populating structured tool_calls. This parser
// extracts those into the OpenAI tool_calls shape so the rest of our pipeline
// can treat them uniformly.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "crypto";

export interface ParsedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ParseResult {
  cleanedContent: string;
  toolCalls: ParsedToolCall[];
}

const TOOL_CALL_BLOCK_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

function genCallId(): string {
  return `call_${randomBytes(6).toString("hex")}`;
}

export function parseToolCallsFromContent(content: string | null | undefined): ParseResult {
  if (!content || !content.includes("<tool_call>")) {
    return { cleanedContent: content || "", toolCalls: [] };
  }

  const toolCalls: ParsedToolCall[] = [];
  let cleanedContent = content;

  for (const m of content.matchAll(TOOL_CALL_BLOCK_RE)) {
    const inner = m[1].trim();
    if (!inner) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(inner);
    } catch {
      continue;
    }
    const name = parsed?.name ?? parsed?.function?.name;
    if (!name) continue;
    const args = parsed?.arguments ?? parsed?.function?.arguments ?? parsed?.parameters ?? {};
    toolCalls.push({
      id: parsed?.id || genCallId(),
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    });
  }

  if (toolCalls.length > 0) {
    cleanedContent = cleanedContent.replace(TOOL_CALL_BLOCK_RE, "").trim();
  }

  return { cleanedContent, toolCalls };
}

export function hasToolCallTags(content: string | null | undefined): boolean {
  return !!content && content.includes("<tool_call>");
}

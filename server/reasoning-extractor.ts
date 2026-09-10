// ─────────────────────────────────────────────────────────────────────────────
// R86 — Reasoning content extractor (ported from Hermes Alpha agent_loop.py)
// ─────────────────────────────────────────────────────────────────────────────
// Different providers expose chain-of-thought / reasoning content under
// different keys:
//   - reasoning_content     (DeepSeek, Kimi, Qwen, GLM)
//   - reasoning             (some Anthropic, OpenAI o-series)
//   - reasoning_details[].text   (OpenRouter normalized format)
// Use this single helper instead of re-implementing the dispatch in every
// provider adapter.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReasoningCarrier {
  reasoning_content?: string | null;
  reasoning?: string | null;
  reasoning_details?: Array<{ text?: string | null } | null> | null;
}

export function extractReasoningFromMessage(
  message: ReasoningCarrier | null | undefined,
): string | null {
  if (!message) return null;
  const m = message as any;

  if (typeof m.reasoning_content === "string" && m.reasoning_content.trim()) {
    return m.reasoning_content;
  }
  if (typeof m.reasoning === "string" && m.reasoning.trim()) {
    return m.reasoning;
  }
  if (Array.isArray(m.reasoning_details)) {
    for (const detail of m.reasoning_details) {
      if (!detail) continue;
      const text = (detail as any).text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return null;
}

export function extractReasoningFromDelta(delta: any): string | null {
  if (!delta) return null;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content)
    return delta.reasoning_content;
  if (typeof delta.reasoning === "string" && delta.reasoning) return delta.reasoning;
  if (Array.isArray(delta.reasoning_details)) {
    const parts: string[] = [];
    for (const d of delta.reasoning_details) {
      if (d && typeof d.text === "string" && d.text) parts.push(d.text);
    }
    if (parts.length) return parts.join("");
  }
  return null;
}

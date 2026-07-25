// Observation masking — shrink STALE tool-output bodies from rounds older than
// the last N, while keeping the tool-call record (role:"tool" + tool_call_id)
// intact so the model still knows the call happened. The bulky payload is
// replaced with a short, recoverable stub.
//
// This is the "observation masking" technique (JetBrains Junie et al.): hide old
// tool OUTPUTS, keep old tool CALLS visible. It complements the two context
// controls VisionClaw already has:
//   - per-tool-result compression (caps a SINGLE output at ~6000 chars at exec)
//   - full-history compaction (summarizes everything near the token limit)
// Neither trims the accumulating MID-context bulk of many full-size tool
// outputs across a long agentic turn — that bulk is exactly what drives
// "Lost in the Middle" context rot. Masking removes the low-signal stale bodies
// every round, cheaply, before the limit is ever reached.
//
// Pure + idempotent + fail-open by design: mutates message bodies in place
// (the masked stub is detectable via STUB_PREFIX so re-runs across rounds never
// double-process), never touches the most-recent `keepRecentRounds` rounds, and
// never removes the message itself (the tool_call_id pairing the API requires
// stays valid).

export interface MaskOptions {
  /** Keep tool outputs from the last N rounds (assistant-with-tool_calls
   *  boundaries) fully intact. Default 2 — the model always sees the current
   *  and previous round's observations at full fidelity. */
  keepRecentRounds?: number;
  /** Only mask string bodies longer than this. Small outputs aren't worth the
   *  churn. Vision/array bodies that carry an image are masked regardless
   *  (images are the most expensive observations to retain). Default 600. */
  minBodyChars?: number;
  /** Master switch. Default true (caller env-gates). */
  enabled?: boolean;
}

export interface MaskResult {
  maskedCount: number;
  /** Approximate characters removed from the in-context message bodies. Image
   *  token savings are not counted here (they're token-level, not char-level). */
  charsSaved: number;
}

const ZERO: MaskResult = { maskedCount: 0, charsSaved: 0 };

export const STUB_PREFIX = "[stale tool output hidden to save context";

export function buildMaskStub(originalChars: number, droppedImage: boolean): string {
  const img = droppedImage ? " An image observation was also dropped." : "";
  return `${STUB_PREFIX} — was ~${originalChars} chars from an earlier step.${img} If you need the full output again, re-run the tool or call recall_context.]`;
}

function textCharsOfArray(content: any[]): { textLen: number; hasImage: boolean } {
  let textLen = 0;
  let hasImage = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") textLen += part.text.length;
    else if (part.type === "image_url") hasImage = true;
  }
  return { textLen, hasImage };
}

/**
 * Mask stale tool observations in `messages` IN PLACE. Returns how much was
 * trimmed. Safe to call every round — already-masked bodies are skipped.
 */
export function maskStaleObservations(messages: any[], opts: MaskOptions = {}): MaskResult {
  const enabled = opts.enabled !== false;
  if (!enabled || !Array.isArray(messages) || messages.length === 0) return ZERO;

  const keepRecentRounds = Math.max(1, Math.floor(opts.keepRecentRounds ?? 2));
  const minBodyChars = Math.max(1, Math.floor(opts.minBodyChars ?? 600));

  // Round boundaries = assistant messages that carry tool_calls. Everything
  // between one boundary and the next tool messages belongs to that round.
  const boundaries: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m && m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      boundaries.push(i);
    }
  }
  // Not enough completed rounds yet to have anything "stale".
  if (boundaries.length <= keepRecentRounds) return ZERO;

  // Keep the last `keepRecentRounds` rounds untouched; mask tool messages that
  // sit strictly before the cutoff boundary.
  const cutoff = boundaries[boundaries.length - keepRecentRounds];

  let maskedCount = 0;
  let charsSaved = 0;

  for (let i = 0; i < cutoff; i++) {
    const m = messages[i];
    if (!m || m.role !== "tool") continue;
    const content = m.content;

    if (typeof content === "string") {
      if (content.startsWith(STUB_PREFIX)) continue; // already masked
      if (content.length < minBodyChars) continue;
      const stub = buildMaskStub(content.length, false);
      if (stub.length >= content.length) continue; // never grow a body
      charsSaved += content.length - stub.length;
      m.content = stub;
      maskedCount++;
    } else if (Array.isArray(content)) {
      const { textLen, hasImage } = textCharsOfArray(content);
      // Mask when there's an image (always worth it) OR the text is bulky.
      if (!hasImage && textLen < minBodyChars) continue;
      const stub = buildMaskStub(textLen, hasImage);
      charsSaved += Math.max(0, textLen - stub.length);
      m.content = stub;
      maskedCount++;
    }
    // Other content shapes (null/number/object) are left alone.
  }

  return { maskedCount, charsSaved };
}

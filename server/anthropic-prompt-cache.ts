// ─────────────────────────────────────────────────────────────────────────────
// R92 — Anthropic prompt caching (system_and_3 strategy)
// ─────────────────────────────────────────────────────────────────────────────
// Reduces input token cost by ~75% on multi-turn Claude conversations by
// placing 4 cache_control breakpoints:
//   1. System prompt (most stable)
//   2-4. Last 3 non-system messages (rolling window)
// Pure function — pass it the messages, get back a deep copy with the
// cache markers attached.
// ─────────────────────────────────────────────────────────────────────────────

export type AnthropicCacheTtl = "5m" | "1h";

interface CacheMarker {
  type: "ephemeral";
  ttl?: "1h";
}

function applyCacheMarker(msg: any, marker: CacheMarker): void {
  const role = msg.role;
  const content = msg.content;

  if (role === "tool") {
    msg.cache_control = marker;
    return;
  }
  if (content === null || content === undefined) {
    msg.cache_control = marker;
    return;
  }
  if (typeof content === "string") {
    msg.content = [{ type: "text", text: content, cache_control: marker }];
    return;
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = marker;
    }
  }
}

export function applyAnthropicCacheControl<T extends { role: string; content: any }>(
  apiMessages: T[],
  cacheTtl: AnthropicCacheTtl = "5m",
): T[] {
  const messages = JSON.parse(JSON.stringify(apiMessages)) as T[];
  if (messages.length === 0) return messages;

  const marker: CacheMarker = { type: "ephemeral" };
  if (cacheTtl === "1h") marker.ttl = "1h";

  let used = 0;
  if (messages[0]?.role === "system") {
    applyCacheMarker(messages[0], marker);
    used += 1;
  }

  const remaining = 4 - used;
  if (remaining <= 0) return messages;

  const nonSysIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "system") nonSysIndices.push(i);
  }
  const tail = nonSysIndices.slice(-remaining);
  for (const idx of tail) {
    applyCacheMarker(messages[idx], marker);
  }

  return messages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-cache stability split (TokenPilot, arXiv:2606.17016)
// ─────────────────────────────────────────────────────────────────────────────
// The Anthropic system-prompt cache is keyed on the EXACT bytes of the cached
// block. buildSystemPrompt concatenates a large byte-stable prefix (corporate
// identity, protocols, persona soul, tool playbook, skills, ~10-40K tokens) with
// per-turn DYNAMIC content (live clock, recalled memory, knowledge, workspace,
// brain). When all of that is one system message, a single changing byte (e.g.
// the minute in TEMPORAL CONTEXT) busts the cache for the ENTIRE block every
// turn — the giant stable prefix is re-billed at full price every request.
//
// Fix: emit the system prompt as TWO consecutive system messages —
//   [ { stablePrefix }, { dynamic + caller appendages } ] —
// so applyAnthropicCacheControl marks ONLY messages[0] (the byte-stable prefix),
// which now cache-HITS turn-to-turn. The dynamic block sits OUTSIDE the cached
// prefix and is reprocessed cheaply. Content stays a plain string (no message
// shape change, no cross-provider risk; the codebase already sends multiple
// consecutive system messages). Pure + fail-safe: if `fullSystemPrompt` does not
// start with `stablePrefix` (or the prefix is trivially small), it returns the
// single-message shape unchanged — never a correctness regression, just no split.
export function splitSystemForCache(
  fullSystemPrompt: string,
  stablePrefix: string,
): Array<{ role: "system"; content: string }> {
  const MIN_STABLE = 200; // don't bother splitting trivially small prompts
  if (
    typeof fullSystemPrompt === "string" &&
    typeof stablePrefix === "string" &&
    stablePrefix.length >= MIN_STABLE &&
    fullSystemPrompt.length > stablePrefix.length &&
    fullSystemPrompt.startsWith(stablePrefix)
  ) {
    const rest = fullSystemPrompt.slice(stablePrefix.length).replace(/^\n+/, "");
    if (rest.length > 0) {
      return [
        { role: "system", content: stablePrefix },
        { role: "system", content: rest },
      ];
    }
  }
  return [{ role: "system", content: fullSystemPrompt }];
}

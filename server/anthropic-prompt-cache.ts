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

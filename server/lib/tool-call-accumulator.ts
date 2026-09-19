/**
 * server/lib/tool-call-accumulator.ts
 *
 * Streaming tool-call index resolution. Most providers stamp every parallel
 * tool call with a stable `index` on each delta; some (observed: gemini-flash
 * via OpenAI-compat) stream parallel calls with NO index. Naively defaulting a
 * missing index to 0 collapses every call into one buffer slot, and the caller's
 * name-merge logic then concatenates their names into a single bogus tool name
 * (e.g. "check_system_statustest_api_keyslist_modelsagent_status"), which the
 * tool dispatcher rejects as an unknown tool.
 *
 * resolveToolCallIndex() returns the correct buffer slot for an incoming delta:
 * it preserves the authoritative `index` when present, and otherwise infers a
 * new slot from a fresh per-call id, or from a different name that arrives only
 * after the current call's arguments have begun.
 */

export interface ToolCallBuffer {
  id: string;
  name: string;
  args: string;
}

export interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

// Prefix for buffer ids synthesized when a provider omits per-call ids. Marked
// so the resolver can tell a synthetic id apart from a real provider id —
// OpenAI's real ids also start with "call_", so we use a prefix that cannot
// collide with any real provider id.
export const SYNTHETIC_TOOL_CALL_ID_PREFIX = "__noid_";

export function resolveToolCallIndex(
  buffers: Record<number, ToolCallBuffer>,
  tc: ToolCallDelta,
): number {
  // Authoritative path: the provider stamped an index. Never second-guess it.
  if (typeof tc.index === "number") return tc.index;

  const keys = Object.keys(buffers).map(Number);
  const lastIdx = keys.length ? Math.max(...keys) : -1;
  if (lastIdx < 0) return 0; // first tool call of the round

  const last = buffers[lastIdx];
  const incomingName = tc.function?.name;
  // A provider-supplied id is real (synthetic ids are only ever minted by this
  // accumulator, never present on an incoming delta). When the incoming delta
  // carries a real id it is authoritative REGARDLESS of whether the previous
  // buffer used a synthetic id — otherwise a new real-id call that streams its
  // arguments before its name gets merged into the prior synthetic-id call,
  // corrupting both calls' args.
  const incomingIdReal = !!tc.id && !tc.id.startsWith(SYNTHETIC_TOOL_CALL_ID_PREFIX);

  let isNewCall: boolean;
  if (incomingIdReal) {
    // Per-call ids are authoritative: a different id is unambiguously a new call;
    // the same id is unambiguously a continuation (even a replayed name).
    isNewCall = tc.id !== last.id;
  } else {
    // No reliable per-call id. A *different* name that arrives only AFTER the
    // current call's arguments have begun marks the start of a new call. This
    // avoids both (a) collapsing parallel calls into one buffer and
    // (b) splitting a single call whose name is replayed or late-sent — a same
    // name, or a name fragment before args began, stays on the current call.
    isNewCall =
      !!incomingName && (last.args?.length ?? 0) > 0 && incomingName !== last.name;
  }

  return isNewCall ? lastIdx + 1 : lastIdx;
}

/**
 * Drizzle error messages and stacks can contain bound conversation facts.
 * Emit only fixed categories, a validated error class, and SQLSTATE.
 */
export function safeTripleErrorDetails(error: unknown): {
  kind: string;
  name: string;
  code: string;
} {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown }; message?: unknown } | null;
  const rawCode = e?.cause?.code ?? e?.code;
  const code = typeof rawCode === "string" && /^[A-Z0-9]{5}$/.test(rawCode)
    ? rawCode : "unknown";
  const name = typeof e?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(e.name)
    ? e.name : "UnknownError";
  const kind = code !== "unknown" ? "database"
    : name === "SyntaxError" ? "parse"
    : e?.message === "memory tombstone key is unavailable" ? "guard_unavailable"
    : e?.message === "A conflicting triple has the same valid_from date" ? "interval_conflict"
    : name === "AbortError" || name === "TimeoutError" ? "timeout"
    : "runtime";
  return { kind, name, code };
}
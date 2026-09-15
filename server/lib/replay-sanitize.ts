// =============================================================================
// R125+146 — Pure helpers for the Workflow Replay surface (agent-insights).
// Kept DB-free so they can be unit-tested without opening a pg pool.
//
// 1. redactForReplay — replay text is shown to every authenticated tenant
//    user, so it needs a broader net than redactSecrets (which covers known
//    provider-token formats): emails, phone numbers, Authorization/Bearer
//    headers, cookies, connection strings, password/secret assignments, and
//    long opaque tokens.
// 2. isStepResultEntry — plans.execution_log mixes real step results with
//    lifecycle events (execution.started, execution.wave, replanning,
//    deadlock). Only entries carrying a valid positive integer `step` are
//    replayable steps; NEVER invent a step number from the array index.
// =============================================================================
import { redactSecrets } from "../redactor";

const REPLAY_PATTERNS: Array<[RegExp, string | ((m: string) => string)]> = [
  // Authorization headers / bearer tokens / cookies
  [/\b(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9\-._~+/]{8,}=*/gi, "$1[REDACTED]"],
  [/\bbearer\s+[A-Za-z0-9\-._~+/]{16,}=*/gi, "Bearer [REDACTED]"],
  [/\b((?:set-)?cookie\s*[:=]\s*)[^\s;,]{8,}/gi, "$1[REDACTED]"],
  // Connection strings with credentials
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, "$1[REDACTED]:[REDACTED]@"],
  // key=value / key: value assignments for sensitive keys
  [/\b((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, "$1[REDACTED]"],
  // Emails
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]"],
  // Phone numbers (international-ish, 10+ digits with separators)
  [/(?<![\d/])(\+?\d[\d\s().-]{8,}\d)(?![\d/])/g, (m: string) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? "[PHONE]" : m;
  }],
  // Long opaque tokens (40+ chars of base64/hex-ish material)
  [/\b[A-Za-z0-9+/_-]{48,}={0,2}\b/g, "[TOKEN]"],
];

export function redactForReplay(input: string): string {
  let out = redactSecrets(input);
  for (const [re, rep] of REPLAY_PATTERNS) {
    out = out.replace(re, rep as any);
  }
  return out;
}

/** Cap + redact any value for safe replay output. */
export function capForReplay(text: unknown, max = 4000): string | null {
  if (text == null) return null;
  const s = typeof text === "string" ? text : JSON.stringify(text);
  const redacted = redactForReplay(s);
  return redacted.length > max
    ? redacted.slice(0, max) + `\n… [truncated ${redacted.length - max} chars]`
    : redacted;
}

/**
 * True only for execution_log entries that are actual step results.
 * Lifecycle events (execution.started, execution.wave, replanning, deadlock)
 * either carry no `step` or a non-positive/non-integer one.
 */
export function isStepResultEntry(entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  const step = entry.step;
  if (!Number.isInteger(step) || step <= 0) return false;
  // Lifecycle markers sometimes carry an `event`/`type` field instead of results.
  if (typeof entry.event === "string" && !("success" in entry) && !("summary" in entry) && !("output" in entry)) return false;
  return true;
}

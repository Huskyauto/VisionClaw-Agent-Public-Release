/**
 * Built With Bob weekly recap — transient-vs-deterministic failure classifier.
 *
 * Pure logic (no DB, no spawn) so it is unit-testable and importable without
 * running the orchestrator's main(). The orchestrator's bounded auto-retry uses
 * this to decide whether a failed build is worth retrying.
 *
 * Distinguish a TRANSIENT infrastructure fault (worth auto-retrying the whole
 * build) from a DETERMINISTIC content/config failure (a fail-closed guard that
 * would just fail the same way on retry — wrong/missing weight, no dated clips,
 * bad voice, missing PAT). Retrying the latter wastes ~$5 + render time and
 * still can't succeed, so it must fall straight through to the alert.
 *
 * Returns a short human label for the matched transient class, or null when the
 * failure is deterministic / unrecognized (treated as fatal — fail-closed).
 */

/** Minimal structural shape of a spawnSync result (decoupled for testability). */
export interface BuildOutcome {
  stderr?: string | Buffer | null;
  stdout?: string | Buffer | null;
  error?: { code?: string } | null;
}

// IMPORTANT: do NOT add a generic "render farm failed" matcher here. The
// render-farm wrapper ("GitHub render farm failed twice (after one retry): <underlying>")
// appends the UNDERLYING reason, so a genuine transient still carries its
// specific token (EIO / timeout / socket / 5xx) and is caught by the patterns
// below. Matching the generic phrase would also mark a DETERMINISTIC render
// failure (bad scene config, code bug) as transient and burn ~$5 of paid
// retries — the opposite of fail-closed. Match only explicit transient evidence.
const TRANSIENT: Array<[RegExp, string]> = [
  // Match the bare errno token (uppercase) so both the canonical Node form
  // ("EIO: i/o error, read") and a wrapper that only carries "Error: EIO" are
  // caught. Case-sensitive: errno codes are uppercase, avoids matching stray words.
  [/\bEIO\b/, "overlayFS EIO read fault"],
  [/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH)\b/, "network socket error"],
  [/socket hang up|fetch failed|network (?:error|timeout)|request timed out/i, "network error"],
  [/workflow run .*(?:timed out|never completed|did not complete)/i, "render-farm worker timeout"],
  // 5xx/429 and a provider name on the same line, in EITHER order
  // ("503 from github" OR "github returned 503").
  [/\b(?:429|5\d{2})\b[^\n]*\b(?:github|openai|anthropic|elevenlabs|fish|gpt-image)\b|\b(?:github|openai|anthropic|elevenlabs|fish|gpt-image)\b[^\n]*\b(?:429|5\d{2})\b/i, "upstream provider 5xx/429"],
];

export function classifyTransientFailure(b: BuildOutcome): string | null {
  const spawnCode = b.error?.code;
  if (spawnCode && ["EIO", "EAGAIN", "ETIMEDOUT", "ENOMEM"].includes(spawnCode)) {
    return `builder spawn ${spawnCode}`;
  }
  const hay = `${b.stderr ? String(b.stderr) : ""}\n${b.stdout ? String(b.stdout) : ""}`;
  for (const [re, label] of TRANSIENT) if (re.test(hay)) return label;
  return null;
}

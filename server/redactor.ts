import { logSilentCatch } from "./lib/silent-catch";
// Tiny secret/PII redactor — runs before any free-form text hits long-term
// memory or external surfaces. Strict, conservative, regex-only — never
// blocks on parse errors, just returns the input on failure.

const PATTERNS: Array<{ name: string; rx: RegExp; replace: string }> = [
  { name: "openai-key",     rx: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,                     replace: "[REDACTED:openai-key]" },
  { name: "anthropic-key",  rx: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,                           replace: "[REDACTED:anthropic-key]" },
  { name: "google-key",     rx: /\bAIza[0-9A-Za-z_-]{30,}\b/g,                              replace: "[REDACTED:google-key]" },
  { name: "github-pat",     rx: /\bghp_[A-Za-z0-9]{30,}\b/g,                                replace: "[REDACTED:github-pat]" },
  { name: "github-fg-pat",  rx: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,                        replace: "[REDACTED:github-pat]" },
  { name: "twilio-sid",     rx: /\bAC[a-f0-9]{32}\b/g,                                      replace: "[REDACTED:twilio-sid]" },
  { name: "stripe-key",     rx: /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{20,}\b/g,         replace: "[REDACTED:stripe-key]" },
  { name: "aws-key",        rx: /\bAKIA[0-9A-Z]{16}\b/g,                                    replace: "[REDACTED:aws-key]" },
  { name: "jwt",            rx: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: "[REDACTED:jwt]" },
  { name: "ssn",            rx: /\b\d{3}-\d{2}-\d{4}\b/g,                                   replace: "[REDACTED:ssn]" },
  { name: "credit-card",    rx: /\b(?:\d[ -]*?){13,16}\b/g,                                 replace: "[REDACTED:cc]" },
  { name: "private-key",    rx: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, replace: "[REDACTED:private-key]" },
];

export function redactSecrets(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  let out = input;
  for (const p of PATTERNS) {
    try { out = out.replace(p.rx, p.replace); } catch (_silentErr) { logSilentCatch("server/redactor.ts", _silentErr); }
  }
  return out;
}

// Apply byte/char caps so a single huge log line can't bloat memory.
export function applyCaps(input: string | undefined | null, opts?: { maxChars?: number }): string {
  const s = redactSecrets(input || "");
  const max = opts?.maxChars ?? 4000;
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "…[truncated]";
}

// Detect what was redacted (for logging / tagging) without exposing the values.
export function listRedactionsFound(input: string): string[] {
  if (!input) return [];
  const found: string[] = [];
  for (const p of PATTERNS) {
    try {
      if (p.rx.test(input)) found.push(p.name);
      p.rx.lastIndex = 0;
    } catch (_silentErr) { logSilentCatch("server/redactor.ts", _silentErr); }
  }
  return found;
}

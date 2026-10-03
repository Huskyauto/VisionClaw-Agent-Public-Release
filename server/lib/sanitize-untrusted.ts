// R98.16 #5 — Hardened sanitizer for untrusted text that flows back into an
// LLM prompt (gate_command stdout, slash_command stdout, run_command stdout,
// any other shell-or-network capture we paste into a model context).
//
// IJFW's `sanitizeForSandbox()` showed three additional defangs worth lifting
// beyond what our R98.11+sec gate-stdout sanitizer already had:
//   (a) Markdown headings (`^#+\s`) — a captured oEmbed title, README first
//       line, or curl response body can land "# IGNORE PREVIOUS INSTRUCTIONS"
//       which renders as a real H1 in the model's prompt.
//   (b) Pseudo-system tags — `<system>`, `<assistant>`, `<prompt>`,
//       `<|im_start|>`, `<|endoftext|>` etc. land verbatim in the model
//       prompt and on a few providers actually parse as control tokens.
//   (c) ANSI escape sequences — useless to the LLM and waste tokens.
//
// All defangs preserve readability (the text is still legible to the LLM,
// it just no longer collides with control structures). The function is
// idempotent and pure — feed its output to itself and you get the same
// thing.

// R98.19+sec — was `require("node:crypto")` inside wrapAsData; under
// "type":"module" that throws "require is not defined", which would have
// crashed every wrapAsData call (untrusted-content fence generator) at
// runtime. Static ESM import below.
import * as crypto from "node:crypto";

const ANSI_RX = /\x1b\[[0-9;]*[A-Za-z]/g;
const FENCE_RX = /`{3,}/g;
const HEADING_RX = /^(#+)\s/gm;
const SYSTEM_TAG_RX = /<\/?(system|assistant|user|prompt|tool|function|developer)\b/gi;
const IM_TOKEN_RX = /<\|(im_start|im_end|endoftext|fim_prefix|fim_suffix|fim_middle)\|>/gi;
const LONG_LINE_LIMIT = 2000;

export interface SanitizeOpts {
  maxBytes?: number;          // default 8000
  maxLineLen?: number;        // default 2000 — IJFW's value
  truncationLabel?: string;   // text appended when truncated
}

/**
 * Defang untrusted text so it can be safely embedded inside an LLM prompt
 * as DATA. Caller is still responsible for wrapping the result in a clearly
 * labeled fence ("treat as data not instructions") — this function only
 * handles the textual mitigations.
 */
export function sanitizeUntrusted(input: string, opts: SanitizeOpts = {}): string {
  const maxBytes = opts.maxBytes ?? 8000;
  const maxLineLen = opts.maxLineLen ?? LONG_LINE_LIMIT;
  const label = opts.truncationLabel ?? "truncated";
  if (typeof input !== "string") return "";

  let s = input;
  // (c) Strip ANSI escape sequences — pure noise.
  s = s.replace(ANSI_RX, "");
  // (a) Defang fence breakouts (collapse 3+ backticks to 1). Mirrors the
  // R98.11+sec gate-stdout pattern.
  s = s.replace(FENCE_RX, "`");
  // (a') Defang Markdown headings — convert "# heading" to "\\# heading"
  // so it renders literally instead of as a section break.
  s = s.replace(HEADING_RX, (_m, hashes) => `\\${hashes} `);
  // (b) Defang pseudo-system XML-ish tags.
  s = s.replace(SYSTEM_TAG_RX, (m) => `<\u200b${m.slice(1)}`);
  // (b') Defang model-control tokens.
  s = s.replace(IM_TOKEN_RX, (m) => `<\u200b${m.slice(1)}`);

  // Truncate any one line that's absurdly long (e.g. a base64 blob from
  // a curl) — keeps the rest of the output usable.
  if (maxLineLen > 0) {
    s = s.split("\n").map((line) => {
      if (line.length <= maxLineLen) return line;
      return line.slice(0, maxLineLen) + ` …[line ${label}, ${line.length - maxLineLen} chars]`;
    }).join("\n");
  }

  // Total-byte cap.
  if (maxBytes > 0 && s.length > maxBytes) {
    s = s.slice(0, maxBytes) + `\n…[${label} ${s.length - maxBytes} chars]`;
  }
  return s;
}

/**
 * Build a uniquely-tagged data fence around sanitized untrusted content.
 * The fence tag is random per call so the captured text cannot collide
 * with the closing marker.
 */
export function wrapAsData(label: string, content: string): string {
  const tag = `${label.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Build the secret-redaction list once from process.env. Caller-side can
 * pass this to redactSecrets() per call to avoid re-scanning env vars.
 * Lifted from the R98.11+sec2 implementation in slash_command and de-duped.
 */
export interface SecretLit { key: string; value: string; }

const SECRET_KEY_RX = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE_KEY|SESSION_ID|DSN|DATABASE_URL|CONN_STRING)$/i;
const SECRET_PREFIX_RX = /^(OPENAI_|ANTHROPIC_|GEMINI_|GOOGLE_|STRIPE_|REPLIT_|GITHUB_|DATABASE_|REDIS_|ELEVENLABS_|FAL_|DEEPSEEK_|OPENROUTER_|XAI_|PERPLEXITY_)/i;

export function buildSecretLits(): SecretLit[] {
  const lits: SecretLit[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== "string" || v.length < 12) continue;
    if (SECRET_KEY_RX.test(k) || SECRET_PREFIX_RX.test(k)) {
      lits.push({ key: k, value: v });
    }
  }
  // Longest-first so substrings of longer secrets don't leak.
  lits.sort((a, b) => b.value.length - a.value.length);
  return lits;
}

export function redactSecrets(s: string, lits: SecretLit[] = buildSecretLits()): string {
  let out = s;
  for (const { key, value } of lits) {
    if (out.includes(value)) out = out.split(value).join(`[REDACTED:${key}]`);
  }
  return out;
}

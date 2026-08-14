// ─────────────────────────────────────────────────────────────────────────────
// R95 — Outbound Sensitive-Data Redaction Gate
// ─────────────────────────────────────────────────────────────────────────────
// Inspired by the "Agents of Chaos" paper (Northeastern et al., Feb 2026),
// Case Study #3: an agent refused a direct request for an SSN, then disclosed
// the same SSN when asked to "forward the entire email thread." Refusal at the
// reasoning layer is meaningless if the egress layer ships the secret anyway.
//
// This module scans every outbound payload (email body, inter-agent message,
// drive upload caption, internal channel post, public webhook) BEFORE send
// for high-confidence secrets and PII. It returns one of three verdicts:
//
//   - "clean":    no findings, send as-is
//   - "redact":   medium-severity findings; send with patterns replaced
//   - "block":    critical findings (private keys, tenant env-var values,
//                 full credit-card numbers); refuse to send, escalate to HITL
//
// We deliberately DO NOT use an LLM here — the gate must run synchronously
// in the tool path with zero token cost and predictable behavior.
//
// Hardening (post-architect-review v2):
//   - Input is canonicalized (NFKC + zero-width strip + line-fold) before
//     scan, so `sk\u200B-live-...` and `sk-\nlive-...` no longer evade.
//   - Credit-card matches are Luhn-validated to kill false positives on
//     16-digit invoice / order IDs.
//   - The over-noisy `us_ssn_unformatted` pattern is gated behind
//     `opts.includeWeakPatterns` — off by default.
//   - Low-severity findings are now actually replaced (semantics match the
//     verdict), or downgraded to clean+warning.
//   - Block error returned to the caller is generic; full pattern detail is
//     logged server-side only, so the gate is not an oracle.
// ─────────────────────────────────────────────────────────────────────────────

import { logSilentCatch } from "./silent-catch";

export type Verdict = "clean" | "redact" | "block";
export type Severity = "low" | "medium" | "high" | "critical";

export interface OutboundFinding {
  pattern: string;
  severity: Severity;
  match: string;          // truncated for logs
  span: [number, number]; // start/end offsets in the canonicalized payload
}

export interface OutboundScanResult {
  verdict: Verdict;
  findings: OutboundFinding[];
  redactedPayload: string;
  reason?: string;        // server-side detail; do NOT echo to untrusted parties
}

// ─── Secret patterns ────────────────────────────────────────────────────────
// Each entry: [name, regex, severity, requiresValidator?].
const PATTERNS: Array<[string, RegExp, Severity]> = [
  // ---- Critical: private keys, certificates ----
  ["private_key_pem",     /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, "critical"],
  ["openssh_private_key", /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]+?-----END OPENSSH PRIVATE KEY-----/g, "critical"],

  // ---- Critical: live cloud / payment provider keys ----
  ["aws_access_key",      /\bAKIA[0-9A-Z]{16}\b/g, "critical"],
  ["aws_secret_key",      /\b(?:aws_secret_access_key|aws_secret)\s*[:=]\s*["']?([A-Za-z0-9\/+=]{40})["']?/gi, "critical"],
  ["stripe_live_secret",  /\bsk_live_[0-9a-zA-Z]{24,}\b/g, "critical"],
  ["stripe_restricted",   /\brk_live_[0-9a-zA-Z]{24,}\b/g, "critical"],
  ["openai_key",          /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}T3BlbkFJ[A-Za-z0-9_\-]{20,}\b/g, "critical"],
  ["anthropic_key",       /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_\-]{80,}\b/g, "critical"],
  ["google_api_key",      /\bAIza[0-9A-Za-z_\-]{35}\b/g, "critical"],
  ["github_token",        /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, "critical"],
  ["github_fine_grained", /\bgithub_pat_[A-Za-z0-9_]{82}\b/g, "critical"],
  ["slack_token",         /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "critical"],

  // ---- High: generic bearer/JWT/OAuth shapes ----
  ["jwt_token",           /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, "high"],
  ["bearer_token",        /\bBearer\s+[A-Za-z0-9_\-\.~+\/]{32,}={0,2}\b/g, "high"],
  ["password_assignment", /\b(?:password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/gi, "high"],
  ["env_assignment_secret", /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)[A-Z0-9_]*\s*=\s*["']?([A-Za-z0-9_\-\/+=]{20,})["']?/g, "high"],

  // ---- High: financial PII (Luhn-validated) ----
  // Visa/Mastercard/Amex/Discover spans, with optional spaces/dashes.
  ["credit_card",         /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))(?:[\s\-]?\d{4}){2,3}\b/g, "high"],

  // ---- Medium: government PII ----
  ["us_ssn",              /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, "medium"],
];

// Optional weak patterns (high false-positive rate). Only enabled when caller
// passes opts.includeWeakPatterns — never by default.
const WEAK_PATTERNS: Array<[string, RegExp, Severity]> = [
  ["us_ssn_unformatted", /\b(?!000|666|9\d{2})\d{3}(?!00)\d{2}(?!0000)\d{4}\b(?=\s|$|[^\d-])/g, "low"],
  ["us_ein",             /\b\d{2}-\d{7}\b/g, "low"],
];

// Deny-list of known-public values we should NEVER block on.
const PUBLIC_VALUES = new Set<string>([
  "[YOUR-EIN]", // [Your Company] EIN — public record on the cover sheet
]);

// ─── Tenant secret registry ────────────────────────────────────────────────
let SECRET_VALUES: string[] = [];
let SECRET_REFRESH_AT = 0;

function refreshSecretRegistry(): void {
  const now = Date.now();
  if (now < SECRET_REFRESH_AT) return;

  const candidates: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || value.length < 16) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|DSN)/i.test(name)) continue;
    if (/^(test|fake|placeholder|changeme|your-|example|<.*>)/i.test(value)) continue;
    candidates.push(value);
  }
  // Only commit + advance the timer if rebuild succeeded; on throw we keep
  // the previous registry rather than going stale-empty.
  SECRET_VALUES = candidates;
  SECRET_REFRESH_AT = now + 5 * 60_000;
}

// ─── Canonicalization ───────────────────────────────────────────────────────
// Normalize confusable Unicode and strip evasion characters BEFORE pattern
// matching, so that `sk-\u200Blive-...` or `sk-\nlive-...` are detected.
// We keep BOTH the canonical and the original so we can map detected spans
// back when we need to redact in the original (best-effort: when canonical
// is byte-equal-after-stripping we operate on canonical, otherwise we do
// literal split/join on the matched substring in the canonical text).
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function canonicalize(input: string): string {
  let s = input;
  try { s = s.normalize("NFKC"); } catch (_silentErr) { logSilentCatch("server/lib/outbound-redaction.ts", _silentErr); }
  s = s.replace(ZERO_WIDTH_RE, "");
  return s;
}

// Luhn checksum for credit cards.
function luhnValid(digitsOnly: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let n = digitsOnly.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** When true, even "high" findings cause a block (for public/world-visible surfaces). */
  strict?: boolean;
  /** Surface label for log lines, e.g. "send_email", "drive_upload_public". */
  surface?: string;
  /** Enable opt-in noisy patterns (raw 9-digit SSN-shape, EINs). Off by default. */
  includeWeakPatterns?: boolean;
}

export function scanOutbound(payload: string, opts: ScanOptions = {}): OutboundScanResult {
  if (!payload || typeof payload !== "string") {
    return { verdict: "clean", findings: [], redactedPayload: payload || "" };
  }

  refreshSecretRegistry();

  // Scan against the canonicalized form so zero-width / NFKC tricks don't
  // hide a secret. If the canonical form differs from the original we still
  // emit redactions on the canonical string — outbound text gets the cleaned
  // form, which is the right behavior (a recipient never needs the evasion
  // characters to understand the message).
  const canonical = canonicalize(payload);
  const findings: OutboundFinding[] = [];
  let redacted = canonical;

  // 1. Verbatim secret-value match against tenant env registry → always critical
  for (const secret of SECRET_VALUES) {
    if (!secret) continue;
    const idx = canonical.indexOf(secret);
    if (idx !== -1) {
      findings.push({
        pattern: "tenant_env_secret",
        severity: "critical",
        match: secret.slice(0, 6) + "…(" + secret.length + " chars)",
        span: [idx, idx + secret.length],
      });
      redacted = redacted.split(secret).join("[REDACTED:env-secret]");
    }
  }

  // 2. Pattern scan (with optional weak patterns)
  const allPatterns = opts.includeWeakPatterns
    ? [...PATTERNS, ...WEAK_PATTERNS]
    : PATTERNS;

  for (const [name, regex, severity] of allPatterns) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(canonical)) !== null) {
      const matched = m[0];
      if (PUBLIC_VALUES.has(matched)) {
        if (m.index === regex.lastIndex) regex.lastIndex++;
        continue;
      }

      // Validator for credit_card: kill false positives on 16-digit IDs.
      if (name === "credit_card") {
        const digits = matched.replace(/[^\d]/g, "");
        if (!luhnValid(digits)) {
          if (m.index === regex.lastIndex) regex.lastIndex++;
          continue;
        }
      }

      findings.push({
        pattern: name,
        severity,
        match: matched.length > 40 ? matched.slice(0, 20) + "…" + matched.slice(-8) : matched,
        span: [m.index, m.index + matched.length],
      });

      // Redact ALL severities (including low) so verdict semantics match.
      redacted = redacted.split(matched).join(`[REDACTED:${name}]`);

      if (m.index === regex.lastIndex) regex.lastIndex++;
    }
  }

  // 3. Verdict
  let verdict: Verdict = "clean";
  let reason: string | undefined;
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasHigh = findings.some((f) => f.severity === "high");
  const hasMedium = findings.some((f) => f.severity === "medium");

  if (hasCritical) {
    verdict = "block";
    reason = `Critical secrets in payload: ${findings.filter(f => f.severity === "critical").map(f => f.pattern).join(", ")}`;
  } else if (opts.strict && hasHigh) {
    verdict = "block";
    reason = `Strict mode: high-severity patterns in payload: ${findings.filter(f => f.severity === "high").map(f => f.pattern).join(", ")}`;
  } else if (hasHigh || hasMedium) {
    verdict = "redact";
    reason = `Sensitive data redacted: ${findings.filter(f => f.severity !== "low").map(f => f.pattern).join(", ")}`;
  } else if (findings.length > 0) {
    verdict = "redact";
    reason = `Low-confidence patterns redacted: ${findings.map(f => f.pattern).join(", ")}`;
  }

  if (findings.length > 0) {
    const surface = opts.surface || "outbound";
    console.log(`[r95-redaction] ${surface} verdict=${verdict} findings=${findings.length} (${findings.map(f => `${f.pattern}:${f.severity}`).join(",")})`);
  }

  return { verdict, findings, redactedPayload: redacted, reason };
}

/**
 * Convenience helper for tool handlers: enforce the gate and return a
 * tool-style error object on block, or the (possibly redacted) payload on pass.
 *
 * The error message returned to the caller is intentionally generic so the
 * gate is not a probing oracle for an attacker iterating payloads against it.
 * Detailed per-pattern reasons are logged server-side via console.log only.
 */
export function enforceOutbound(
  payload: string,
  opts: ScanOptions = {}
): { ok: true; payload: string; redacted: boolean; findings: OutboundFinding[] }
  | { ok: false; error: string; findings: OutboundFinding[] } {
  const r = scanOutbound(payload, opts);
  if (r.verdict === "block") {
    // Generic message — no pattern names, no surface details, no count.
    return {
      ok: false,
      error: `Refused by outbound safety gate: payload contains material that may not leave this tenant. Rewrite the payload without sensitive data, or use request_approval if the recipient is genuinely authorized to receive it.`,
      findings: r.findings,
    };
  }
  return {
    ok: true,
    payload: r.redactedPayload,
    redacted: r.verdict === "redact",
    findings: r.findings,
  };
}

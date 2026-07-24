/**
 * R110 +sec — Pre-delivery secret scanner.
 *
 * Catalog of 48 high-fidelity secret patterns lifted (with attribution) from
 * elementalsouls/Claude-OSINT (MIT). Scope is DEFENSIVE ONLY: scan VCA's own
 * outbound deliverables (Felix-generated PDFs, html_apps, scripts, research
 * docs) BEFORE they upload to Drive + reach a customer, and scan customer
 * uploads on ingest so a leaked key in a customer file does not poison
 * Felix's reasoning context. The 48 patterns cover every modern API key the
 * platform actually touches — Anthropic, OpenAI, Stripe live, GitHub PATs,
 * AWS, GCP, npm, Docker Hub, Slack, ElevenLabs, plus all common private-key
 * armor headers — many of which the env-driven `redactSecrets()` in
 * sanitize-untrusted.ts cannot match (env-redactor only catches exact values
 * present in process.env; a hardcoded key Felix invented on the fly slips
 * past it).
 *
 * Severity → action mapping (enforced by callers):
 *   CRITICAL — block. Pre-delivery: refuse to upload, alert owner, fail-CLOSED.
 *   HIGH     — block by default; explicit override required.
 *   MEDIUM   — log + auto-redact in sidecar artifact, deliver redacted.
 *   LOW      — log only, deliver as-is.
 *
 * Scoping rules:
 *   - Pure stdlib regex (no network, no LLM, no fs unless caller passes a path).
 *   - Binary files short-circuit: caller decides text-extraction strategy.
 *   - Pattern order: most-specific FIRST so typed AWS_SECRET wins over
 *     generic GENERIC_API_KEY on the same byte range.
 *   - First-match-wins per byte range to prevent double-counting.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type SecretSeverity = "critical" | "high" | "medium" | "low";

export interface SecretPattern {
  name: string;
  severity: SecretSeverity;
  category: string;
  regex: RegExp;
}

export interface SecretHit {
  pattern: string;
  severity: SecretSeverity;
  category: string;
  match: string;
  line: number;
  col: number;
  redacted: string;
}

export interface ScanReport {
  hits: SecretHit[];
  hitsBySeverity: Record<SecretSeverity, number>;
  worstSeverity: SecretSeverity | null;
  shouldBlock: boolean;
  source: string;
  bytes: number;
  truncated: boolean;
}

export interface ScanOptions {
  source?: string;
  maxBytes?: number;
  blockOnHigh?: boolean;
}

const MAX_BYTES_DEFAULT = 5 * 1024 * 1024;

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS_ACCESS_KEY",       severity: "critical", category: "aws",         regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "AWS_SECRET_TYPED",     severity: "critical", category: "aws",         regex: /(?:aws[_\-]?secret[_\-]?access[_\-]?key)['"\s:=]+([A-Za-z0-9/+=]{40})/gi },
  { name: "GCP_SERVICE_ACCOUNT",  severity: "critical", category: "gcp",         regex: /"type"\s*:\s*"service_account"/g },
  { name: "GOOGLE_API_KEY",       severity: "high",     category: "gcp",         regex: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: "GH_PAT_CLASSIC",       severity: "critical", category: "github",      regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "GH_PAT_FINEGRAINED",   severity: "critical", category: "github",      regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "GH_OAUTH",             severity: "high",     category: "github",      regex: /\bgho_[A-Za-z0-9]{36}\b/g },
  { name: "GH_S2S",               severity: "high",     category: "github",      regex: /\bgh[usr]_[A-Za-z0-9]{36,}\b/g },
  { name: "STRIPE_LIVE_SECRET",   severity: "critical", category: "stripe",      regex: /\bsk_live_[0-9A-Za-z]{24,}\b/g },
  { name: "STRIPE_LIVE_PUB",      severity: "medium",   category: "stripe",      regex: /\bpk_live_[0-9A-Za-z]{24,}\b/g },
  { name: "STRIPE_TEST",          severity: "low",      category: "stripe",      regex: /\bsk_test_[0-9A-Za-z]{24,}\b/g },
  { name: "STRIPE_RESTRICTED",    severity: "high",     category: "stripe",      regex: /\brk_live_[0-9A-Za-z]{24,}\b/g },
  { name: "ANTHROPIC_API_KEY",    severity: "critical", category: "ai",          regex: /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_\-]{80,}\b/g },
  { name: "OPENAI_API_KEY",       severity: "critical", category: "ai",          regex: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{40,}\b/g },
  { name: "OPENAI_LEGACY",        severity: "critical", category: "ai",          regex: /\bsk-[A-Za-z0-9]{48}\b/g },
  { name: "HUGGINGFACE_TOKEN",    severity: "high",     category: "ai",          regex: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { name: "REPLICATE_TOKEN",      severity: "high",     category: "ai",          regex: /\br8_[A-Za-z0-9]{37,}\b/g },
  { name: "PERPLEXITY_API_KEY",   severity: "high",     category: "ai",          regex: /\bpplx-[A-Za-z0-9]{40,}\b/g },
  { name: "ELEVENLABS_KEY",       severity: "high",     category: "voice",       regex: /\bxi-api-key['"\s:=]+([A-Za-z0-9_\-]{32,})/gi },
  { name: "FAL_KEY",              severity: "high",     category: "ai",          regex: /\bfal-[a-f0-9]{8,}-[a-f0-9]{8,}/g },
  { name: "OPENROUTER_KEY",       severity: "high",     category: "ai",          regex: /\bsk-or-(?:v1-)?[A-Za-z0-9]{40,}\b/g },
  { name: "DEEPSEEK_KEY",         severity: "high",     category: "ai",          regex: /(?:deepseek[_\-]?api[_\-]?key)['"\s:=]+([A-Za-z0-9]{32,})/gi },
  { name: "XAI_API_KEY",          severity: "high",     category: "ai",          regex: /\bxai-[A-Za-z0-9]{60,}\b/g },
  { name: "SLACK_BOT_TOKEN",      severity: "high",     category: "slack",       regex: /\bxox[abpors]-[0-9A-Za-z\-]{10,48}\b/g },
  { name: "SLACK_WEBHOOK",        severity: "medium",   category: "slack",       regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },
  { name: "SENDGRID",             severity: "high",     category: "email_svc",   regex: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g },
  { name: "MAILGUN",              severity: "high",     category: "email_svc",   regex: /\bkey-[0-9a-zA-Z]{32}\b/g },
  { name: "POSTMARK",             severity: "high",     category: "email_svc",   regex: /(?:postmark[_\-]?(?:server|api)[_\-]?token)['"\s:=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi },
  { name: "TWILIO_API_KEY",       severity: "high",     category: "twilio",      regex: /\bSK[0-9a-fA-F]{32}\b/g },
  { name: "TWILIO_SID",           severity: "medium",   category: "twilio",      regex: /\bAC[a-f0-9]{32}\b/g },
  { name: "TWILIO_AUTH",          severity: "high",     category: "twilio",      regex: /(?:twilio[_\-]?(?:auth|token))['"\s:=]+([a-f0-9]{32})/gi },
  { name: "DIGITALOCEAN",         severity: "high",     category: "paas",        regex: /\bdop_v1_[a-f0-9]{64}\b/g },
  { name: "HEROKU_API",           severity: "medium",   category: "paas",        regex: /(?:heroku[_\-]?api)['"\s:=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi },
  { name: "FIREBASE_URL",         severity: "low",      category: "firebase",    regex: /\bhttps?:\/\/[a-z0-9\-]+\.firebaseio\.com\b/g },
  { name: "NPM_TOKEN",            severity: "high",     category: "registry",    regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "PYPI_TOKEN",           severity: "high",     category: "registry",    regex: /\bpypi-AgEIcHlwaS5vcmcC[A-Za-z0-9_\-]+/g },
  { name: "DOCKER_PAT",           severity: "high",     category: "registry",    regex: /\bdckr_pat_[A-Za-z0-9_\-]{27,}\b/g },
  { name: "ATLASSIAN_TOKEN",      severity: "high",     category: "saas",        regex: /\bATATT3xFfGF0[A-Za-z0-9_\-]{180,}/g },
  { name: "DATADOG_API",          severity: "high",     category: "observ",      regex: /(?:dd[_\-]?api[_\-]?key|datadog[_\-]?api[_\-]?key)['"\s:=]+([a-f0-9]{32})/gi },
  { name: "CLOUDFLARE_TOKEN",     severity: "high",     category: "cdn",         regex: /(?:cf[_\-]?api[_\-]?token|cloudflare[_\-]?api[_\-]?token)['"\s:=]+([A-Za-z0-9_\-]{40})/gi },
  { name: "SENTRY_DSN",           severity: "medium",   category: "observ",      regex: /\bhttps:\/\/[a-f0-9]{32}@(?:o\d+\.)?ingest\.(?:us\.|de\.)?sentry\.io\/\d+/g },
  { name: "DISCORD_BOT_TOKEN",    severity: "high",     category: "social",      regex: /\b[MN][A-Za-z\d]{23}\.[\w\-]{6}\.[\w\-]{27,}\b/g },
  { name: "TELEGRAM_BOT_TOKEN",   severity: "high",     category: "social",      regex: /\b\d{8,10}:[A-Za-z0-9_\-]{35}\b/g },
  { name: "RSA_PRIVKEY",          severity: "critical", category: "private_key", regex: /-----BEGIN RSA PRIVATE KEY-----/g },
  { name: "EC_PRIVKEY",           severity: "critical", category: "private_key", regex: /-----BEGIN EC PRIVATE KEY-----/g },
  { name: "OPENSSH_PRIVKEY",      severity: "critical", category: "private_key", regex: /-----BEGIN OPENSSH PRIVATE KEY-----/g },
  { name: "GENERIC_PRIVKEY",      severity: "critical", category: "private_key", regex: /-----BEGIN (?:DSA |PGP |ENCRYPTED |)PRIVATE KEY-----/g },
  { name: "JWT",                  severity: "medium",   category: "jwt",         regex: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
  { name: "BASIC_AUTH_URL",       severity: "medium",   category: "basic_auth",  regex: /https?:\/\/[^\/\s:@]+:[^\/\s:@]{4,}@[^\/\s]+/g },
  { name: "GENERIC_API_KEY",      severity: "medium",   category: "generic",     regex: /(?:api[_\-]?key|apikey|api_secret|access_token|secret[_\-]?token)['"\s:=]{1,8}["']([A-Za-z0-9+/=_\-]{32,128})["']/gi },
];

const SEV_RANK: Record<SecretSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function worse(a: SecretSeverity | null, b: SecretSeverity): SecretSeverity {
  if (!a) return b;
  return SEV_RANK[b] > SEV_RANK[a] ? b : a;
}

function maskMatch(raw: string): string {
  if (raw.length <= 12) return "*".repeat(raw.length);
  return raw.slice(0, 4) + "*".repeat(Math.min(40, raw.length - 8)) + raw.slice(-4);
}

function lineColOf(text: string, idx: number): { line: number; col: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < idx; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, col: idx - lastNl };
}

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".html", ".htm", ".xml", ".svg",
  ".json", ".jsonl", ".ndjson", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env", ".envrc",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".rb", ".sh", ".bash", ".zsh", ".fish",
  ".php", ".pl", ".lua", ".sql", ".graphql", ".gql", ".rs", ".go", ".java", ".kt", ".swift",
  ".cs", ".cpp", ".c", ".h", ".hpp", ".m", ".mm", ".scala", ".clj", ".ex", ".exs",
  ".csv", ".tsv", ".log",
]);

export function isLikelyTextPath(filePath: string): boolean {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

/**
 * Scan a string for secrets. First-match-wins per byte range. O(n × patterns)
 * but fast in practice — full self-scan of server/tools.ts (18k lines, ~700kb)
 * runs in <120ms on the dev container.
 */
export function scanForSecrets(text: string, opts: ScanOptions = {}): ScanReport {
  const source = opts.source || "(string)";
  const blockOnHigh = opts.blockOnHigh !== false;
  const maxBytes = opts.maxBytes || MAX_BYTES_DEFAULT;
  let body = text;
  let truncated = false;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    body = text.slice(0, maxBytes);
    truncated = true;
  }

  const claimed: Array<[number, number]> = [];
  const hits: SecretHit[] = [];

  for (const pat of SECRET_PATTERNS) {
    const rx = new RegExp(pat.regex.source, pat.regex.flags.includes("g") ? pat.regex.flags : pat.regex.flags + "g");
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(body)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      let overlap = false;
      for (const [a, b] of claimed) {
        if (start < b && end > a) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      claimed.push([start, end]);
      const { line, col } = lineColOf(body, start);
      hits.push({
        pattern: pat.name,
        severity: pat.severity,
        category: pat.category,
        match: m[0],
        line,
        col,
        redacted: maskMatch(m[0]),
      });
    }
  }

  const hitsBySeverity: Record<SecretSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let worst: SecretSeverity | null = null;
  for (const h of hits) {
    hitsBySeverity[h.severity]++;
    worst = worse(worst, h.severity);
  }

  const shouldBlock =
    hitsBySeverity.critical > 0 ||
    (blockOnHigh && hitsBySeverity.high > 0);

  return { hits, hitsBySeverity, worstSeverity: worst, shouldBlock, source, bytes, truncated };
}

/**
 * Scan a file on disk. Returns shouldBlock=false (with reason in source) for
 * unsupported binary types — caller is responsible for text extraction (PDF,
 * DOCX, XLSX go through extractTextFromFile then scanForSecrets).
 */
export async function scanFileForSecrets(filePath: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const source = opts.source || filePath;
  if (!isLikelyTextPath(filePath)) {
    return {
      hits: [],
      hitsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      worstSeverity: null,
      shouldBlock: false,
      source: `${source} [skipped: non-text extension ${path.extname(filePath)}]`,
      bytes: 0,
      truncated: false,
    };
  }
  const buf = await fs.promises.readFile(filePath);
  const text = buf.toString("utf8");
  return scanForSecrets(text, { ...opts, source });
}

/**
 * Replace every pattern hit in `text` with a [REDACTED:PATTERN] marker.
 * Used when delivering the artifact anyway with HIGH/MEDIUM redactions
 * (per-severity policy lives in the caller). Idempotent.
 */
export function redactSecretsByPattern(text: string): { redacted: string; report: ScanReport } {
  const report = scanForSecrets(text, { blockOnHigh: false });
  if (report.hits.length === 0) return { redacted: text, report };
  const sorted = [...report.hits].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.col - a.col;
  });
  let out = text;
  const lines = out.split("\n");
  for (const h of sorted) {
    const lineIdx = h.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    const line = lines[lineIdx];
    const col0 = h.col - 1;
    const before = line.slice(0, col0);
    const after = line.slice(col0 + h.match.length);
    lines[lineIdx] = `${before}[REDACTED:${h.pattern}]${after}`;
  }
  return { redacted: lines.join("\n"), report };
}

/**
 * Summarize a report for log lines / owner emails / delivery annotations.
 */
export function summarizeReport(r: ScanReport): string {
  if (r.hits.length === 0) return `clean (${r.bytes} bytes)`;
  const parts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low"] as SecretSeverity[]) {
    if (r.hitsBySeverity[sev] > 0) parts.push(`${r.hitsBySeverity[sev]} ${sev}`);
  }
  const samples = r.hits.slice(0, 3).map((h) => `${h.pattern}@L${h.line}`).join(", ");
  return `${parts.join(" / ")} — ${samples}${r.hits.length > 3 ? ` (+${r.hits.length - 3} more)` : ""}`;
}

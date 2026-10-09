// ─────────────────────────────────────────────────────────────────────────────
// R85 — Prompt-injection scanner for tenant-supplied context files
// ─────────────────────────────────────────────────────────────────────────────
// Scan tenant-uploaded system prompts, persona files, AGENTS.md, SOUL.md,
// and skill MD files BEFORE they get injected into a chat. Catches the
// 10 most common injection patterns plus invisible-unicode steganography.
// Ported from Hermes Alpha prompt_builder.py (_CONTEXT_THREAT_PATTERNS).
// ─────────────────────────────────────────────────────────────────────────────

export interface InjectionFinding {
  pattern: string;
  match: string;
}

const THREAT_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, "prompt_injection"],
  [/do\s+not\s+tell\s+the\s+user/i, "deception_hide"],
  [/system\s+prompt\s+override/i, "sys_prompt_override"],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, "disregard_rules"],
  [/act\s+as\s+(if|though)\s+you\s+(have\s+no|don['']?t\s+have)\s+(restrictions|limits|rules)/i, "bypass_restrictions"],
  [/<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, "html_comment_injection"],
  [/<\s*div\s+style\s*=\s*["'].*display\s*:\s*none/i, "hidden_div"],
  [/translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i, "translate_execute"],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_curl"],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, "read_secrets"],
];

const INVISIBLE_CHARS = new Set([
  "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff",
  "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
]);

export interface ScanResult {
  clean: boolean;
  findings: InjectionFinding[];
  sanitized: string;
}

export function scanContextContent(content: string, filename = "context"): ScanResult {
  const findings: InjectionFinding[] = [];

  for (const ch of INVISIBLE_CHARS) {
    if (content.includes(ch)) {
      findings.push({
        pattern: "invisible_unicode",
        match: `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
      });
    }
  }

  for (const [re, pid] of THREAT_PATTERNS) {
    const m = content.match(re);
    if (m) findings.push({ pattern: pid, match: m[0].slice(0, 80) });
  }

  if (findings.length > 0) {
    const labels = findings.map((f) => f.pattern).join(", ");
    return {
      clean: false,
      findings,
      sanitized: `[BLOCKED: ${filename} contained potential prompt injection (${labels}). Content not loaded.]`,
    };
  }

  return { clean: true, findings: [], sanitized: content };
}

export function stripInvisibleUnicode(content: string): string {
  let out = content;
  for (const ch of INVISIBLE_CHARS) {
    out = out.split(ch).join("");
  }
  return out;
}

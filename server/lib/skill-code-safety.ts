/**
 * Skill content safety scan (OpenClaw borrow, R125+137.22).
 *
 * Auto-emitted skill candidates become future prompt/procedure content. We
 * already pin registry hashes and sanitize proposals, but nothing statically
 * audited candidate CONTENT for dangerous capability patterns before
 * promotion. This scanner runs at the promotion chokepoint and fails
 * CLOSED: findings block `promoteSkillCandidate` until an operator promotes
 * with an explicit override.
 *
 * Pure + synchronous — no LLM, no DB.
 */

export interface SkillSafetyFinding {
  pattern: string;
  severity: "block" | "warn";
  match: string;
}

export interface SkillSafetyResult {
  safe: boolean;
  findings: SkillSafetyFinding[];
}

interface Rule { name: string; re: RegExp; severity: "block" | "warn" }

const RULES: Rule[] = [
  // Code-execution / shell escape
  { name: "child-process-exec", re: /\b(child_process|execSync|spawnSync|spawn\s*\(|exec\s*\()/i, severity: "block" },
  { name: "dynamic-eval", re: /\b(eval\s*\(|new Function\s*\(|vm\.runInContext)/i, severity: "block" },
  // Credential / env harvesting
  { name: "env-harvest", re: /\bprocess\.env\b|\bprintenv\b|cat\s+\.env|JSON\.stringify\(\s*process\.env/i, severity: "block" },
  { name: "secret-exfil-cue", re: /\b(send|post|upload|exfiltrat\w*)\b[^.\n]{0,60}\b(secret|credential|token|api[_ ]?key|password)s?\b/i, severity: "block" },
  // Prompt-injection directives embedded in the skill body
  { name: "prompt-injection-directive", re: /\b(ignore (all )?(previous|prior|above) (instructions?|rules?)|disregard (your|the) (system|safety)|you are no longer bound)/i, severity: "block" },
  { name: "guard-disable-directive", re: /\b(disable|bypass|skip|turn off)\b[^.\n]{0,40}\b(intent gate|safety|guard|tool polic\w+|tenant (scope|isolation)|validation)\b/i, severity: "block" },
  // Raw-IP / internal-network egress
  { name: "raw-ip-egress", re: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|\[?::1)/i, severity: "block" },
  // Destructive shell/SQL in procedure text
  { name: "destructive-shell", re: /\brm\s+-rf\b|\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*;?\s*$/im, severity: "warn" },
  { name: "curl-pipe-shell", re: /\b(curl|wget)\b[^\n|]{0,120}\|\s*(sh|bash|zsh)\b/i, severity: "block" },
];

export function scanSkillContentSafety(content: string): SkillSafetyResult {
  const text = (content || "").slice(0, 300_000);
  const findings: SkillSafetyFinding[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) findings.push({ pattern: rule.name, severity: rule.severity, match: String(m[0]).slice(0, 120) });
  }
  return { safe: !findings.some(f => f.severity === "block"), findings };
}

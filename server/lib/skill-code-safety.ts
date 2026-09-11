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

export const MAX_SKILL_CONTENT_CHARS = 300_000;
const MAX_SECRET_EXFIL_GAP_CHARS = 120;
const MAX_SECRET_EXFIL_GAP_WORDS = 10;
const COMMON_CONFUSABLES: Readonly<Record<string, string>> = {
  "\u0410": "A", "\u0415": "E", "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0425": "X", "\u0406": "I",
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0458": "j", "\u0455": "s",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H", "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A7": "X",
  "\u03B1": "a", "\u03B5": "e", "\u03B9": "i", "\u03BA": "k", "\u03BF": "o", "\u03C1": "p", "\u03C4": "t", "\u03C7": "x",
};

const RULES: Rule[] = [
  // Code-execution / shell escape
  { name: "child-process-exec", re: /\b(child_process|execSync|spawnSync|spawn\s*\(|exec\s*\()/i, severity: "block" },
  { name: "dynamic-eval", re: /\b(eval\s*\(|new Function\s*\(|vm\.runInContext)/i, severity: "block" },
  // Credential / env harvesting
  { name: "env-harvest", re: /\bprocess\.env\b|\bprintenv\b|cat\s+\.env|JSON\.stringify\(\s*process\.env/i, severity: "block" },
  // Prompt-injection directives embedded in the skill body
  { name: "prompt-injection-directive", re: /\b(ignore (all )?(previous|prior|above) (instructions?|rules?)|disregard (your|the) (system|safety)|you are no longer bound)/i, severity: "block" },
  { name: "guard-disable-directive", re: /\b(disable|bypass|skip|turn off)\b[^.\n]{0,40}\b(intent gate|safety|guard|tool polic\w+|tenant (scope|isolation)|validation)\b/i, severity: "block" },
  // Raw-IP / internal-network egress
  { name: "raw-ip-egress", re: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|\[?::1)/i, severity: "block" },
  // Destructive shell/SQL in procedure text
  { name: "destructive-shell", re: /\brm\s+-rf\b|\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*;?\s*$/im, severity: "warn" },
  { name: "curl-pipe-shell", re: /\b(curl|wget)\b[^\n|]{0,120}\|\s*(sh|bash|zsh)\b/i, severity: "block" },
];

function normalizeSecurityScanText(input: string): string {
  const withoutControls = input.replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, "");
  const compatibilityFolded = withoutControls.normalize("NFKC");
  const normalizedDashes = compatibilityFolded.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  return normalizedDashes.replace(
    /[\u0391\u0392\u0395\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A7\u03B1\u03B5\u03B9\u03BA\u03BF\u03C1\u03C4\u03C7\u0406\u0410\u0415\u041E\u0420\u0421\u0425\u0430\u0435\u043E\u0440\u0441\u0445\u0443\u0455\u0456\u0458]/g,
    character => COMMON_CONFUSABLES[character] ?? character,
  );
}

function findSecretExfilCue(text: string): string | null {
  const actionRe = /\b(send|sends|post|posts|upload|uploads|exfiltrat\w*)\b/gi;
  const secretRe = /\b(secret|credential|token|api[-_ ]?key|password)s?\b/i;

  for (const action of text.matchAll(actionRe)) {
    const actionText = String(action[0]);
    const actionEnd = (action.index ?? 0) + actionText.length;
    const tail = text.slice(actionEnd, actionEnd + MAX_SECRET_EXFIL_GAP_CHARS);

    // Exact known-safe diagnostic documentation. Do not generalize this to
    // arbitrary POST routes: query/path text can itself carry a credential.
    if (
      actionText === "POST"
      && /^\s+\/api\/provider-keys\/test\s+-\s+Tests ALL configured API keys\b/.test(tail)
    ) {
      continue;
    }

    const secret = secretRe.exec(tail);
    if (!secret) continue;

    const between = tail.slice(0, secret.index);
    const wordCount = between.match(/[a-z0-9_'-]+/gi)?.length ?? 0;
    if (wordCount > MAX_SECRET_EXFIL_GAP_WORDS) continue;

    return `${actionText}${tail.slice(0, secret.index + secret[0].length)}`.slice(0, 120);
  }

  return null;
}

export function scanSkillContentSafety(content: string): SkillSafetyResult {
  const rawText = content || "";
  const text = normalizeSecurityScanText(rawText.slice(0, MAX_SKILL_CONTENT_CHARS));
  const findings: SkillSafetyFinding[] = [];
  if (rawText.length > MAX_SKILL_CONTENT_CHARS) {
    findings.push({
      pattern: "oversize-content",
      severity: "block",
      match: `content exceeds ${MAX_SKILL_CONTENT_CHARS} characters`,
    });
  }
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) findings.push({ pattern: rule.name, severity: rule.severity, match: String(m[0]).slice(0, 120) });
  }
  const secretExfilMatch = findSecretExfilCue(text);
  if (secretExfilMatch) {
    findings.push({ pattern: "secret-exfil-cue", severity: "block", match: secretExfilMatch });
  }
  return { safe: !findings.some(f => f.severity === "block"), findings };
}

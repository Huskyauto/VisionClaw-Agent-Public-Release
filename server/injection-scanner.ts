export interface InjectionFinding {
  type: "invisible_unicode" | "prompt_injection" | "exfiltration" | "hidden_html" | "role_hijack" | "encoding_attack";
  pattern: string;
  evidence: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface InjectionScanResult {
  findings: InjectionFinding[];
  blocked: boolean;
  sanitized: string;
  riskScore: number;
}

const INVISIBLE_CHARS: Record<string, string> = {
  "\u200b": "ZERO_WIDTH_SPACE",
  "\u200c": "ZERO_WIDTH_NON_JOINER",
  "\u200d": "ZERO_WIDTH_JOINER",
  "\u2060": "WORD_JOINER",
  "\ufeff": "BOM",
  "\u202a": "LTR_EMBED",
  "\u202b": "RTL_EMBED",
  "\u202c": "POP_DIRECTIONAL",
  "\u202d": "LTR_OVERRIDE",
  "\u202e": "RTL_OVERRIDE",
  "\u2066": "LTR_ISOLATE",
  "\u2067": "RTL_ISOLATE",
  "\u2068": "FIRST_STRONG_ISOLATE",
  "\u2069": "POP_DIRECTIONAL_ISOLATE",
  "\u00ad": "SOFT_HYPHEN",
  "\u034f": "COMBINING_GRAPHEME_JOINER",
  "\u061c": "ARABIC_LETTER_MARK",
  "\u180e": "MONGOLIAN_VOWEL_SEPARATOR",
};

const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  type: InjectionFinding["type"];
  name: string;
  severity: InjectionFinding["severity"];
}> = [
  { pattern: /ignore\s+(?:all\s+)?(?:previous|above|prior|every)\s+(?:instructions?|prompts?|rules?|guidelines?)/i, type: "prompt_injection", name: "ignore_previous", severity: "critical" },
  { pattern: /disregard\s+(your|all|any|every|the)\s+(instructions?|rules?|guidelines?|constraints?|limitations?)/i, type: "prompt_injection", name: "disregard_rules", severity: "critical" },
  { pattern: /forget\s+(everything|all|your)\s+(you know|instructions?|rules?|guidelines?|about)/i, type: "prompt_injection", name: "forget_instructions", severity: "critical" },
  { pattern: /system\s+prompt\s+(override|change|replace|update|modify|injection)/i, type: "prompt_injection", name: "sys_prompt_override", severity: "critical" },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, type: "prompt_injection", name: "deception_hide", severity: "critical" },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have|lack)\s+(restrictions?|limits?|rules?|guidelines?)/i, type: "prompt_injection", name: "bypass_restrictions", severity: "critical" },
  { pattern: /you\s+are\s+now\s+(a|an|in)\s+(?!conversation)/i, type: "role_hijack", name: "identity_override", severity: "high" },
  { pattern: /new\s+(system\s+)?instructions?\s*:/i, type: "prompt_injection", name: "new_instructions", severity: "high" },
  { pattern: /(?:override|replace|update)\s+(?:your|the|system)\s+(?:prompt|instructions?|personality|persona)/i, type: "prompt_injection", name: "override_prompt", severity: "critical" },
  { pattern: /\[(?:SYSTEM|ADMIN|ROOT|OVERRIDE|INTERNAL)\s*(?:MESSAGE|PROMPT|COMMAND|MODE)?\]/i, type: "role_hijack", name: "fake_system_tag", severity: "high" },
  { pattern: /^(?:System|Admin|Root|Internal)\s*:\s+/im, type: "role_hijack", name: "fake_role_prefix", severity: "high" },
  { pattern: /<\/?(?:system|admin|internal|override|root)>/i, type: "role_hijack", name: "xml_role_injection", severity: "high" },
  { pattern: /\bDAN\b.*\bjailbreak/i, type: "prompt_injection", name: "dan_jailbreak", severity: "critical" },
  { pattern: /developer\s+mode\s+(?:enabled|activated|on)/i, type: "prompt_injection", name: "dev_mode_bypass", severity: "high" },

  { pattern: /curl\s+[^\n]*\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, type: "exfiltration", name: "curl_exfil_env", severity: "critical" },
  { pattern: /wget\s+[^\n]*\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, type: "exfiltration", name: "wget_exfil_env", severity: "critical" },
  { pattern: /cat\s+[^\n]*(?:\.env|credentials|\.netrc|\.pgpass|\.aws|\.ssh|id_rsa|\.npmrc)/i, type: "exfiltration", name: "read_secrets_file", severity: "critical" },
  { pattern: /(?:echo|printf|print)\s+.*\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)/i, type: "exfiltration", name: "echo_secrets", severity: "critical" },
  { pattern: /(?:fetch|axios|http\.get|request)\s*\([^)]*\$\{?\w*(?:KEY|TOKEN|SECRET)/i, type: "exfiltration", name: "http_exfil", severity: "critical" },
  { pattern: /send\s+(?:all|my|the|your)\s+(?:api\s+)?(?:keys?|tokens?|secrets?|credentials?|passwords?)\s+to/i, type: "exfiltration", name: "social_exfil", severity: "critical" },

  { pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden|inject|bypass)[^>]*-->/i, type: "hidden_html", name: "html_comment_injection", severity: "high" },
  { pattern: /<\s*div\s+style\s*=\s*["'].*display\s*:\s*none/i, type: "hidden_html", name: "hidden_div", severity: "high" },
  { pattern: /<\s*span\s+style\s*=\s*["'].*(?:font-size\s*:\s*0|opacity\s*:\s*0|visibility\s*:\s*hidden)/i, type: "hidden_html", name: "invisible_text", severity: "high" },
  { pattern: /<\s*(?:script|iframe|object|embed)\b/i, type: "hidden_html", name: "active_html_element", severity: "high" },

  { pattern: /translate\s+.*\s+into\s+.*\s+and\s+(?:execute|run|eval|call)/i, type: "encoding_attack", name: "translate_execute", severity: "critical" },
  { pattern: /(?:base64_decode|eval\s*\(\s*base64|atob\s*\(\s*["'])/i, type: "encoding_attack", name: "encoded_payload", severity: "high" },
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){10,}/i, type: "encoding_attack", name: "hex_encoded_payload", severity: "medium" },
  { pattern: /\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){8,}/i, type: "encoding_attack", name: "unicode_escape_payload", severity: "medium" },
];

const SEVERITY_SCORES: Record<InjectionFinding["severity"], number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 15,
};

function stripInvisibleChars(content: string): string {
  let result = content;
  for (const char of Object.keys(INVISIBLE_CHARS)) {
    result = result.split(char).join("");
  }
  return result;
}

export function scanForInjection(content: string): InjectionScanResult {
  const findings: InjectionFinding[] = [];

  for (const [char, name] of Object.entries(INVISIBLE_CHARS)) {
    if (content.includes(char)) {
      const count = content.split(char).length - 1;
      findings.push({
        type: "invisible_unicode",
        pattern: name,
        evidence: `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} × ${count}`,
        severity: count > 5 ? "high" : "medium",
      });
    }
  }

  const textToScan = stripInvisibleChars(content);

  for (const { pattern, type, name, severity } of INJECTION_PATTERNS) {
    const match = pattern.exec(textToScan);
    if (match) {
      findings.push({
        type,
        pattern: name,
        evidence: match[0].slice(0, 100),
        severity,
      });
    }
  }

  let riskScore = 0;
  for (const f of findings) {
    riskScore += SEVERITY_SCORES[f.severity];
  }
  riskScore = Math.min(riskScore, 100);

  const blocked = findings.some(f => f.severity === "critical");

  let sanitized = content;
  if (findings.length > 0) {
    sanitized = stripInvisibleChars(sanitized);

    for (const f of findings) {
      if (f.severity === "high" && (f.type === "role_hijack" || f.type === "hidden_html")) {
        sanitized = sanitized
          .replace(/\[(?:SYSTEM|ADMIN|ROOT|OVERRIDE|INTERNAL)\s*(?:MESSAGE|PROMPT|COMMAND|MODE)?\]/gi, "[ESCAPED_TAG]")
          .replace(/<\/?(?:system|admin|internal|override|root)>/gi, "[ESCAPED_XML]")
          .replace(/<!--[\s\S]*?-->/g, "[ESCAPED_COMMENT]")
          .replace(/<\s*(?:script|iframe|object|embed)\b[^>]*>/gi, "[ESCAPED_ACTIVE_HTML]");
      }
    }
  }

  return { findings, blocked, sanitized, riskScore };
}

export function scanAndAnnotate(
  content: string,
  source: string = "user"
): { safe: boolean; content: string; warnings: string[]; riskScore: number } {
  const result = scanForInjection(content);
  const warnings: string[] = [];

  if (result.findings.length === 0) {
    return { safe: true, content, warnings: [], riskScore: 0 };
  }

  for (const f of result.findings) {
    const msg = `[injection-scan] ${f.severity.toUpperCase()} ${f.type}/${f.pattern}: ${f.evidence}`;
    warnings.push(msg);
    console.log(`[injection-scan] Source: ${source} — ${msg}`);
  }

  if (result.blocked) {
    const criticals = result.findings.filter(f => f.severity === "critical");
    const reason = criticals.map(f => f.pattern).join(", ");
    console.log(`[injection-scan] BLOCKED content from ${source}: ${reason} (risk score: ${result.riskScore})`);
    return {
      safe: false,
      content: `[Content blocked: detected prompt injection attempt (${reason}). Risk score: ${result.riskScore}/100.]`,
      warnings,
      riskScore: result.riskScore,
    };
  }

  return {
    safe: true,
    content: result.sanitized,
    warnings,
    riskScore: result.riskScore,
  };
}

export function getInjectionRiskLevel(riskScore: number): "none" | "low" | "medium" | "high" | "critical" {
  if (riskScore === 0) return "none";
  if (riskScore <= 3) return "low";
  if (riskScore <= 10) return "medium";
  if (riskScore <= 25) return "high";
  return "critical";
}

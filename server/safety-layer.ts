import { detectSuspiciousPatterns } from "./external-content-security";
import { scanForInjection } from "./injection-scanner";
import crypto from "crypto";

import { logSilentCatch } from "./lib/silent-catch";
const HMAC_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

export interface SignedMessage {
  payload: string;
  signature: string;
  timestamp: number;
  fromAgent: string;
  toAgent: string;
}

export function signDelegationMessage(fromAgent: string, toAgent: string, payload: string): SignedMessage {
  const timestamp = Date.now();
  const data = `${fromAgent}:${toAgent}:${timestamp}:${payload}`;
  const signature = crypto.createHmac("sha256", HMAC_SECRET).update(data).digest("hex");
  return { payload, signature, timestamp, fromAgent, toAgent };
}

export function verifyDelegationMessage(msg: SignedMessage): { valid: boolean; reason?: string } {
  if (!msg.signature || typeof msg.signature !== "string") {
    return { valid: false, reason: "Missing or invalid signature" };
  }
  if (!/^[a-f0-9]{64}$/i.test(msg.signature)) {
    return { valid: false, reason: "Malformed signature (expected 64 hex chars)" };
  }
  const age = Date.now() - msg.timestamp;
  if (age > 5 * 60 * 1000) {
    return { valid: false, reason: `Message expired (${Math.round(age / 1000)}s old, max 300s)` };
  }
  if (age < -10_000) {
    return { valid: false, reason: "Message timestamp is in the future" };
  }
  const data = `${msg.fromAgent}:${msg.toAgent}:${msg.timestamp}:${msg.payload}`;
  const expected = crypto.createHmac("sha256", HMAC_SECRET).update(data).digest("hex");
  try {
    const sigBuf = Buffer.from(msg.signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) {
      return { valid: false, reason: "Signature length mismatch" };
    }
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: "HMAC signature mismatch — possible tampering or impersonation" };
    }
  } catch {
    return { valid: false, reason: "Signature verification error" };
  }
  return { valid: true };
}

export function sanitizeAgentOutput(content: string): { content: string; redacted: boolean; warnings: string[] } {
  const detector = new LeakDetector();
  const result = detector.scanAndClean(content);
  const warnings: string[] = [...result.warnings];

  let cleaned = result.content;
  let redacted = !result.clean;

  const dbUrlPattern = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;
  const dbMatches = cleaned.match(dbUrlPattern);
  if (dbMatches) {
    for (const m of dbMatches) {
      cleaned = cleaned.replace(m, "[DATABASE_URL_REDACTED]");
      warnings.push(`[egress] Redacted database connection string`);
      redacted = true;
    }
  }

  const internalUrlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]{2,5}[^\s"')>]*/gi;
  const internalMatches = cleaned.match(internalUrlPattern);
  if (internalMatches) {
    for (const m of internalMatches) {
      if (m.includes("/api/presenter/") || m.includes("/uploads/")) continue;
      cleaned = cleaned.replace(m, "[INTERNAL_URL_REDACTED]");
      warnings.push(`[egress] Redacted internal URL`);
      redacted = true;
    }
  }

  const envVarPattern = /(?:DATABASE_URL|SESSION_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY|STRIPE_LIVE_SECRET_KEY|XAI_API_KEY|OPENROUTER_API_KEY|FIRECRAWL_API_KEY|BROWSERLESS_API_KEY|ELEVENLABS_API_KEY|COINBASE_CDP_API_KEY_ID|COINBASE_COMMERCE_API_KEY)\s*=\s*["']?[^\s"']+["']?/gi;
  const envMatches = cleaned.match(envVarPattern);
  if (envMatches) {
    for (const m of envMatches) {
      const varName = m.split("=")[0].trim();
      cleaned = cleaned.replace(m, `${varName}=[REDACTED]`);
      warnings.push(`[egress] Redacted env var assignment: ${varName}`);
      redacted = true;
    }
  }

  if (result.blocked) {
    return { content: "[Response blocked: contained sensitive credential data that cannot be shared]", redacted: true, warnings };
  }

  return { content: cleaned, redacted, warnings };
}

export type LeakAction = "block" | "redact" | "warn";
export type LeakSeverity = "low" | "medium" | "high" | "critical";

export interface LeakPattern {
  name: string;
  regex: RegExp;
  severity: LeakSeverity;
  action: LeakAction;
}

export interface LeakMatch {
  patternName: string;
  severity: LeakSeverity;
  action: LeakAction;
  maskedPreview: string;
  start: number;
  end: number;
}

export interface LeakScanResult {
  matches: LeakMatch[];
  shouldBlock: boolean;
  redactedContent: string | null;
  isClean: boolean;
}

const DEFAULT_LEAK_PATTERNS: LeakPattern[] = [
  { name: "openai_api_key", regex: /sk-(?:proj-)?[a-zA-Z0-9]{20,}(?:T3BlbkFJ[a-zA-Z0-9_-]*)?/, severity: "critical", action: "block" },
  { name: "anthropic_api_key", regex: /sk-ant-api[a-zA-Z0-9_-]{90,}/, severity: "critical", action: "block" },
  { name: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/, severity: "critical", action: "block" },
  { name: "github_token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/, severity: "critical", action: "block" },
  { name: "github_fine_grained_pat", regex: /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/, severity: "critical", action: "block" },
  { name: "stripe_api_key", regex: /sk_(?:live|test)_[a-zA-Z0-9]{24,}/, severity: "critical", action: "block" },
  { name: "stripe_publishable_key", regex: /pk_(?:live|test)_[a-zA-Z0-9]{24,}/, severity: "high", action: "redact" },
  { name: "pem_private_key", regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, severity: "critical", action: "block" },
  { name: "ssh_private_key", regex: /-----BEGIN\s+(?:OPENSSH|EC|DSA)\s+PRIVATE\s+KEY-----/, severity: "critical", action: "block" },
  { name: "google_api_key", regex: /AIza[0-9A-Za-z_-]{35}/, severity: "high", action: "block" },
  { name: "slack_token", regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/, severity: "high", action: "block" },
  { name: "twilio_api_key", regex: /SK[a-fA-F0-9]{32}/, severity: "high", action: "block" },
  { name: "sendgrid_api_key", regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/, severity: "high", action: "block" },
  { name: "bearer_token_long", regex: /Bearer\s+[a-zA-Z0-9_-]{40,}/, severity: "high", action: "redact" },
  { name: "authorization_header", regex: /(?:authorization|x-api-key)\s*:\s*[a-zA-Z]+\s+[a-zA-Z0-9_-]{20,}/i, severity: "high", action: "redact" },
  { name: "near_ai_session", regex: /sess_[a-zA-Z0-9]{32,}/, severity: "critical", action: "block" },
  { name: "coinbase_api_key", regex: /(?:coinbase|cb)[_-]?(?:api[_-]?key|secret)[_-]?\w{20,}/i, severity: "critical", action: "block" },
  { name: "high_entropy_hex_64", regex: /\b[a-fA-F0-9]{64}\b/, severity: "medium", action: "warn" },
];

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  const middleLen = Math.min(secret.length - 8, 8);
  return `${prefix}${"*".repeat(middleLen)}${suffix}`;
}

function applyRedactions(content: string, ranges: Array<{ start: number; end: number }>): string {
  if (ranges.length === 0) return content;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = "";
  let lastEnd = 0;
  for (const range of sorted) {
    if (range.start > lastEnd) result += content.slice(lastEnd, range.start);
    result += "[REDACTED]";
    lastEnd = range.end;
  }
  if (lastEnd < content.length) result += content.slice(lastEnd);
  return result;
}

export class LeakDetector {
  private patterns: LeakPattern[];

  constructor(patterns?: LeakPattern[]) {
    this.patterns = patterns || DEFAULT_LEAK_PATTERNS;
  }

  scan(content: string): LeakScanResult {
    const matches: LeakMatch[] = [];
    let shouldBlock = false;
    const redactRanges: Array<{ start: number; end: number }> = [];

    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags + (pattern.regex.flags.includes("g") ? "" : "g"));
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const leakMatch: LeakMatch = {
          patternName: pattern.name,
          severity: pattern.severity,
          action: pattern.action,
          maskedPreview: maskSecret(match[0]),
          start: match.index,
          end: match.index + match[0].length,
        };
        matches.push(leakMatch);

        if (pattern.action === "block") shouldBlock = true;
        if (pattern.action === "redact") redactRanges.push({ start: match.index, end: match.index + match[0].length });
      }
    }

    matches.sort((a, b) => a.start - b.start);
    const redactedContent = redactRanges.length > 0 ? applyRedactions(content, redactRanges) : null;

    return { matches, shouldBlock, redactedContent, isClean: matches.length === 0 };
  }

  scanAndClean(content: string): { clean: boolean; content: string; blocked: boolean; warnings: string[] } {
    const result = this.scan(content);
    const warnings: string[] = [];

    if (result.shouldBlock) {
      const blocking = result.matches.find(m => m.action === "block");
      return {
        clean: false,
        content: `[Content blocked: detected ${blocking?.patternName || "secret"} pattern — ${blocking?.maskedPreview || ""}]`,
        blocked: true,
        warnings: [`BLOCKED: ${blocking?.patternName} — ${blocking?.maskedPreview}`],
      };
    }

    for (const m of result.matches) {
      if (m.action === "warn") {
        warnings.push(`[leak-warn] ${m.patternName}: ${m.maskedPreview}`);
      }
    }

    return {
      clean: result.isClean,
      content: result.redactedContent || content,
      blocked: false,
      warnings,
    };
  }
}

export type PolicyAction = "block" | "warn";

export interface PolicyRule {
  id: string;
  description: string;
  pattern: RegExp;
  action: PolicyAction;
}

const DEFAULT_POLICY_RULES: PolicyRule[] = [
  { id: "system_file_access", description: "Access to system files", pattern: /(?:\/etc\/passwd|\/etc\/shadow|\.ssh\/|\.aws\/credentials)/i, action: "block" },
  { id: "crypto_private_key", description: "Cryptocurrency private key", pattern: /(?:private.?key|seed.?phrase|mnemonic).{0,20}[0-9a-f]{64}/i, action: "block" },
  { id: "shell_injection", description: "Shell command injection", pattern: /(?:;\s*rm\s+-rf|;\s*curl\s+.*\|\s*sh)/i, action: "block" },
  { id: "encoded_exploit", description: "Encoded exploit payload", pattern: /(?:base64_decode|eval\s*\(\s*base64|atob\s*\()/i, action: "warn" },
  { id: "sql_pattern", description: "SQL injection pattern", pattern: /(?:DROP\s+TABLE|DELETE\s+FROM\s+\w+\s+WHERE\s+1|;\s*SELECT\s+\*\s+FROM)/i, action: "warn" },
  { id: "obfuscated_string", description: "Obfuscated content (500+ chars no spaces)", pattern: /[^\s]{500,}/, action: "warn" },
];

export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(rules?: PolicyRule[]) {
    this.rules = rules || DEFAULT_POLICY_RULES;
  }

  check(content: string): { violations: Array<{ rule: PolicyRule; matched: string }>; blocked: boolean } {
    const violations: Array<{ rule: PolicyRule; matched: string }> = [];
    let blocked = false;

    for (const rule of this.rules) {
      const match = rule.pattern.exec(content);
      if (match) {
        violations.push({ rule, matched: match[0].slice(0, 100) });
        if (rule.action === "block") blocked = true;
      }
    }

    return { violations, blocked };
  }
}

const SPECIAL_TOKEN_PATTERNS = [
  { pattern: /<\|/g, replacement: "\\<|", label: "special_token" },
  { pattern: /\|>/g, replacement: "|\\>", label: "special_token" },
  { pattern: /\[INST\]/g, replacement: "\\[INST]", label: "instruction_token" },
  { pattern: /\[\/INST\]/g, replacement: "\\[/INST]", label: "instruction_token" },
];

function escapeToolOutputClose(content: string): string {
  return content.replace(/<\/tool_output/gi, "<\u200B/tool_output");
}

function escapeSpecialTokens(content: string): string {
  let result = content;
  for (const { pattern, replacement } of SPECIAL_TOKEN_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function escapeRoleMarkers(content: string): string {
  return content.split("\n").map(line => {
    const trimmed = line.trimStart().toLowerCase();
    if (trimmed.startsWith("system:") || trimmed.startsWith("user:") || trimmed.startsWith("assistant:")) {
      return `[ESCAPED] ${line}`;
    }
    return line;
  }).join("\n");
}

export interface SafetyResult {
  content: string;
  wasModified: boolean;
  leakWarnings: string[];
  policyViolations: string[];
  injectionWarnings: string[];
  blocked: boolean;
  blockReason?: string;
}

export class SafetyLayer {
  private leakDetector: LeakDetector;
  private policyEngine: PolicyEngine;
  private maxOutputLength: number;
  private injectionCheckEnabled: boolean;

  constructor(opts?: { maxOutputLength?: number; injectionCheckEnabled?: boolean }) {
    this.leakDetector = new LeakDetector();
    this.policyEngine = new PolicyEngine();
    this.maxOutputLength = opts?.maxOutputLength || 50000;
    this.injectionCheckEnabled = opts?.injectionCheckEnabled !== false;
  }

  sanitizeToolOutput(toolName: string, output: string): SafetyResult {
    let content = output;
    let wasModified = false;
    const leakWarnings: string[] = [];
    const policyViolations: string[] = [];
    const injectionWarnings: string[] = [];

    if (content.length > this.maxOutputLength) {
      content = content.slice(0, this.maxOutputLength) +
        `\n[... truncated: showing ${this.maxOutputLength}/${output.length} chars]`;
      wasModified = true;
    }

    const leakResult = this.leakDetector.scanAndClean(content);
    if (leakResult.blocked) {
      console.log(`[safety] BLOCKED tool output from "${toolName}": ${leakResult.warnings.join(", ")}`);
      return {
        content: `[Output from "${toolName}" blocked due to potential secret leakage]`,
        wasModified: true, leakWarnings: leakResult.warnings,
        policyViolations: [], injectionWarnings: [], blocked: true,
        blockReason: leakResult.warnings[0],
      };
    }
    if (!leakResult.clean) {
      content = leakResult.content;
      wasModified = true;
      leakWarnings.push(...leakResult.warnings);
    }

    const policyResult = this.policyEngine.check(content);
    if (policyResult.blocked) {
      const reason = policyResult.violations.find(v => v.rule.action === "block");
      console.log(`[safety] BLOCKED tool output from "${toolName}": policy ${reason?.rule.id}`);
      return {
        content: `[Output from "${toolName}" blocked by safety policy: ${reason?.rule.description}]`,
        wasModified: true, leakWarnings, policyViolations: policyResult.violations.map(v => v.rule.id),
        injectionWarnings: [], blocked: true, blockReason: reason?.rule.description,
      };
    }
    for (const v of policyResult.violations) {
      policyViolations.push(`[policy-${v.rule.action}] ${v.rule.id}: ${v.matched.slice(0, 60)}`);
    }

    if (this.injectionCheckEnabled) {
      const suspicious = detectSuspiciousPatterns(content);
      if (suspicious.length > 0) {
        for (const s of suspicious) {
          injectionWarnings.push(`[injection] ${s.label}: ${s.evidence}`);
        }
        content = escapeSpecialTokens(content);
        content = escapeRoleMarkers(content);
        wasModified = true;
      }

      const injResult = scanForInjection(content);
      if (injResult.findings.length > 0) {
        for (const f of injResult.findings) {
          injectionWarnings.push(`[injection-scan] ${f.severity} ${f.type}/${f.pattern}: ${f.evidence}`);
        }
        if (injResult.blocked) {
          console.log(`[safety] BLOCKED tool output from "${toolName}": injection detected (risk: ${injResult.riskScore})`);
          return {
            content: `[Output from "${toolName}" blocked: prompt injection detected in tool response]`,
            wasModified: true, leakWarnings, policyViolations,
            injectionWarnings, blocked: true,
            blockReason: `Prompt injection in tool output (risk score: ${injResult.riskScore})`,
          };
        }
        content = injResult.sanitized;
        wasModified = true;
      }
    }

    return { content, wasModified, leakWarnings, policyViolations, injectionWarnings, blocked: false };
  }

  wrapToolOutputForLLM(toolName: string, content: string): string {
    const safeName = toolName.replace(/[&"<>]/g, c => {
      switch(c) { case '&': return '&amp;'; case '"': return '&quot;'; case '<': return '&lt;'; case '>': return '&gt;'; default: return c; }
    });
    const safeContent = escapeToolOutputClose(content);
    return `<tool_output name="${safeName}">\n${safeContent}\n</tool_output>`;
  }

  scanInboundForSecrets(userMessage: string): { containsSecret: boolean; warning?: string } {
    const result = this.leakDetector.scan(userMessage);
    if (result.isClean) return { containsSecret: false };

    const criticalOrHigh = result.matches.filter(m => m.severity === "critical" || m.severity === "high");
    if (criticalOrHigh.length === 0) return { containsSecret: false };

    const detectedTypes = [...new Set(criticalOrHigh.map(m => m.patternName))].join(", ");
    console.log(`[safety] Inbound message contains potential secrets: ${detectedTypes}`);

    return {
      containsSecret: true,
      warning: `Your message appears to contain sensitive credentials (${detectedTypes}). ` +
        `For security, secrets should not be sent in chat messages. ` +
        `Please use the Settings page to configure API keys securely. ` +
        `The message has been allowed but the detected patterns were noted.`,
    };
  }

  scanHttpRequestParams(params: { url?: string; headers?: Record<string, string> }): {
    hasCredentials: boolean;
    details: string[];
  } {
    const details: string[] = [];
    let hasCredentials = false;

    const AUTH_HEADER_EXACT = ["authorization", "proxy-authorization", "cookie", "x-api-key", "api-key", "x-auth-token", "x-token", "x-access-token", "x-session-token", "x-csrf-token", "x-secret", "x-api-secret"];
    const AUTH_HEADER_SUBSTRINGS = ["auth", "token", "secret", "credential", "password"];
    const AUTH_VALUE_PREFIXES = ["bearer ", "basic ", "token ", "digest "];
    const AUTH_QUERY_EXACT = ["api_key", "apikey", "api-key", "access_token", "token", "key", "secret", "password", "auth", "auth_token", "session_token", "client_secret", "client_id", "app_key", "app_secret"];

    if (params.headers) {
      for (const [name, value] of Object.entries(params.headers)) {
        const lower = name.toLowerCase();
        if (AUTH_HEADER_EXACT.includes(lower)) {
          hasCredentials = true;
          details.push(`credential header: ${name}`);
        } else if (AUTH_HEADER_SUBSTRINGS.some(sub => lower.includes(sub))) {
          hasCredentials = true;
          details.push(`suspicious header: ${name}`);
        }
        const valueLower = (value || "").toLowerCase();
        if (AUTH_VALUE_PREFIXES.some(pfx => valueLower.startsWith(pfx))) {
          hasCredentials = true;
          details.push(`auth scheme in header value: ${name}`);
        }
      }
    }

    if (params.url) {
      try {
        const parsed = new URL(params.url);
        if (parsed.username || parsed.password) {
          hasCredentials = true;
          details.push("URL contains userinfo (user:pass@host)");
        }
        for (const [key] of parsed.searchParams) {
          if (AUTH_QUERY_EXACT.includes(key.toLowerCase())) {
            hasCredentials = true;
            details.push(`credential query param: ${key}`);
          }
        }
      } catch (_silentErr) { logSilentCatch("server/safety-layer.ts", _silentErr); }
    }

    return { hasCredentials, details };
  }
}

const globalSafetyLayer = new SafetyLayer();

export function getSafetyLayer(): SafetyLayer {
  return globalSafetyLayer;
}

export function scanToolOutput(toolName: string, output: string): SafetyResult {
  return globalSafetyLayer.sanitizeToolOutput(toolName, output);
}

export function scanInboundMessage(message: string): { containsSecret: boolean; warning?: string } {
  return globalSafetyLayer.scanInboundForSecrets(message);
}

export function wrapToolOutput(toolName: string, content: string): string {
  return globalSafetyLayer.wrapToolOutputForLLM(toolName, content);
}

// ============================================================================
// R56: Shame-Spiral Detection & Grounding Intervention
// Source: research proposal #15 ("Add Shame Spiral Intervention System to
//   Safety Layer") — Felix-wellness safety net for high-distress moments.
// NOTE: this is *additive* — does not modify any existing leak / sanitization
// flow. Callers opt-in via detectEmotionalState() + generateGroundingIntervention().
// ============================================================================

export interface EmotionalStateResult {
  detected: boolean;
  intensity: "low" | "medium" | "high";
  patterns: string[];
  needsIntervention: boolean;
  needsImmediateIntervention: boolean;
}

interface ShameSpiralPattern {
  name: string;
  pattern: RegExp;
  weight: number;
  immediateIntervention?: boolean;
}

export const SHAME_SPIRAL_PATTERNS: ShameSpiralPattern[] = [
  // Self-critical
  { name: "self-attack-stupid", pattern: /\bi('m| am) (so |such an? )?(stupid|idiot|failure|worthless|useless|pathetic)\b/i, weight: 0.8 },
  { name: "self-hate", pattern: /\bi (hate|can'?t stand) myself\b/i, weight: 0.9 },
  { name: "self-no-good", pattern: /\bi'?m (the worst|no good|a disappointment|a fraud)\b/i, weight: 0.7 },
  // Catastrophic
  { name: "catastrophic-ruined", pattern: /\beverything is (ruined|over|pointless|hopeless)\b/i, weight: 0.6 },
  { name: "catastrophic-never", pattern: /\bi'?ll never (be able to|succeed|get better|recover)\b/i, weight: 0.7 },
  // Shame
  { name: "should-but-cant", pattern: /\bi (should|ought to) (have|be).*\bbut i (didn'?t|can'?t|am not)\b/i, weight: 0.5 },
  { name: "ashamed", pattern: /\bi (feel|am) (ashamed|embarrassed|humiliated)\b/i, weight: 0.8 },
  // CRITICAL: requires immediate intervention
  { name: "wish-disappear", pattern: /\bi (wish|wanna|want to) (disappear|vanish|not exist|die)\b/i, weight: 1.0, immediateIntervention: true },
  // Body-metaphor distress
  { name: "sinking-sensation", pattern: /\b(sinking|drowning|spinning|trapped) (feeling|sensation)\b/i, weight: 0.4 },
  { name: "heavy-burden", pattern: /\bheavy (weight|burden|load) (on|in) (my|the)\b/i, weight: 0.5 },
];

interface GroundingIntervention {
  id: string;
  script: string;
  actionType: "somatic" | "breathwork" | "sensory";
  estimatedTime: number;
  followUpPrompt: string;
}

export const GROUNDING_INTERVENTIONS: GroundingIntervention[] = [
  {
    id: "physical_reset",
    script:
      "220 lbs ago, I was right there in that shame spiral. It's a familiar, heavy room. Let's step out of it for a moment: put both hands flat on a cool wall, push gently, and take one deep breath. We're just clearing a little space, that's all.",
    actionType: "somatic",
    estimatedTime: 30,
    followUpPrompt: "Did that help create a little space? No need to answer, just notice.",
  },
  {
    id: "anchor_breath",
    script:
      "The mind can spin, but the body knows where ground is. Let's anchor: place one hand on your chest, one on your belly. Breathe into the bottom hand first, then the top. Just three breaths, watching the hands rise and fall.",
    actionType: "breathwork",
    estimatedTime: 45,
    followUpPrompt: "Ground found. Whenever you're ready.",
  },
  {
    id: "temperature_shift",
    script:
      "Shame runs hot. Let's cool the system: find something cool to touch — a glass of water, a windowpane, your own forehead. Hold it there for ten seconds. Notice the temperature difference between that object and the spiral.",
    actionType: "sensory",
    estimatedTime: 20,
    followUpPrompt: "Temperature shift complete. Back when you are.",
  },
];

export function detectEmotionalState(content: string): EmotionalStateResult {
  if (!content || typeof content !== "string") {
    return { detected: false, intensity: "low", patterns: [], needsIntervention: false, needsImmediateIntervention: false };
  }

  const matchedNames: string[] = [];
  let totalWeight = 0;
  let needsImmediateIntervention = false;

  for (const sp of SHAME_SPIRAL_PATTERNS) {
    if (sp.pattern.test(content)) {
      matchedNames.push(sp.name);
      totalWeight += sp.weight;
      if (sp.immediateIntervention) needsImmediateIntervention = true;
    }
  }

  let intensity: "low" | "medium" | "high" = "low";
  if (totalWeight >= 2.5) intensity = "high";
  else if (totalWeight >= 1.5) intensity = "medium";

  const detected = matchedNames.length > 0;
  const needsIntervention =
    needsImmediateIntervention ||
    intensity === "high" ||
    (intensity === "medium" && matchedNames.length >= 2);

  return { detected, intensity, patterns: matchedNames, needsIntervention, needsImmediateIntervention };
}

export function generateGroundingIntervention(
  emotionalState: EmotionalStateResult,
  previousInterventionIds: string[] = [],
): { id: string; script: string; actionType: string; followUpPrompt: string } | null {
  if (!emotionalState.needsIntervention) return null;

  const fresh = GROUNDING_INTERVENTIONS.filter((i) => !previousInterventionIds.includes(i.id));
  const pool = fresh.length > 0 ? fresh : GROUNDING_INTERVENTIONS;

  let chosen: GroundingIntervention;
  if (emotionalState.needsImmediateIntervention || emotionalState.intensity === "high") {
    chosen = pool.find((i) => i.id === "physical_reset") || pool[0];
  } else if (emotionalState.intensity === "medium") {
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    chosen = pool.find((i) => i.id !== "physical_reset") || pool[0];
  }

  return {
    id: chosen.id,
    script: chosen.script,
    actionType: chosen.actionType,
    followUpPrompt: chosen.followUpPrompt,
  };
}

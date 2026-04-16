import { db } from "./db";
import { sql, desc, eq } from "drizzle-orm";
import { getClientForModel } from "./providers";
import { executeTool } from "./tools";

interface CapabilityGap {
  id: number;
  tenant_id: number;
  persona_id: number | null;
  gap_description: string;
  trigger_context: string | null;
  source: string;
  status: string;
  research_results: any[];
  resolution: string | null;
  resolved_tool: string | null;
  resolved_skill: string | null;
  created_at: Date;
  resolved_at: Date | null;
  priority: string;
}

interface ResearchResult {
  source: string;
  title: string;
  url?: string;
  summary: string;
  relevance: number;
  actionable: boolean;
  implementation_hint?: string;
  trust_score: number;
  trust_reason: string;
}

interface SkillSeekerResult {
  gap_id: number;
  gap_description: string;
  research_count: number;
  research_results: ResearchResult[];
  action_taken: string;
  new_tool?: string;
  new_skill?: string;
  status: string;
  safety_report?: SafetyReport;
}

interface SafetyReport {
  passed: boolean;
  checks_run: string[];
  issues_found: string[];
  trust_level: "high" | "medium" | "low" | "blocked";
  blocked_reason?: string;
}

const TRUSTED_DOMAINS = new Set([
  "github.com",
  "npmjs.com",
  "stackoverflow.com",
  "developer.mozilla.org",
  "docs.python.org",
  "typescriptlang.org",
  "nodejs.org",
  "expressjs.com",
  "react.dev",
  "nextjs.org",
  "tailwindcss.com",
  "drizzle.team",
  "zod.dev",
  "tanstack.com",
  "vercel.com",
  "stripe.com",
  "openai.com",
  "anthropic.com",
  "google.com",
  "googleapis.com",
  "microsoft.com",
  "learn.microsoft.com",
  "docs.github.com",
  "medium.com",
  "dev.to",
  "digitalocean.com",
  "aws.amazon.com",
  "cloud.google.com",
  "wikipedia.org",
]);

const TRUSTED_GITHUB_ORGS = new Set([
  "microsoft", "google", "facebook", "meta", "vercel", "openai",
  "anthropics", "drizzle-team", "tanstack", "tailwindlabs",
  "nodejs", "expressjs", "mozilla", "aws", "stripe", "prisma",
  "trpc", "remix-run", "sveltejs", "vuejs", "angular",
  "shadcn-ui", "radix-ui", "t3-oss", "colinhacks",
]);

const DANGEROUS_CODE_PATTERNS = [
  { pattern: /\beval\s*\(/, label: "eval() execution", severity: "critical" as const },
  { pattern: /\bFunction\s*\(/, label: "Function() constructor", severity: "critical" as const },
  { pattern: /child_process|spawn|exec\s*\(/, label: "shell command execution", severity: "critical" as const },
  { pattern: /process\.env/, label: "environment variable access", severity: "critical" as const },
  { pattern: /require\s*\(\s*['"`]fs/, label: "filesystem access via require", severity: "critical" as const },
  { pattern: /require\s*\(\s*['"`]net/, label: "network socket access", severity: "critical" as const },
  { pattern: /require\s*\(\s*['"`]http/, label: "HTTP server creation", severity: "high" as const },
  { pattern: /import\s*\(/, label: "dynamic import", severity: "high" as const },
  { pattern: /globalThis|global\./, label: "global scope mutation", severity: "high" as const },
  { pattern: /\.constructor\s*\[/, label: "prototype pollution attempt", severity: "critical" as const },
  { pattern: /__proto__/, label: "prototype chain manipulation", severity: "critical" as const },
  { pattern: /Object\.defineProperty/, label: "property descriptor manipulation", severity: "medium" as const },
  { pattern: /Proxy\s*\(/, label: "Proxy object creation", severity: "medium" as const },
  { pattern: /Reflect\./, label: "Reflect API usage", severity: "medium" as const },
  { pattern: /crypto\./, label: "crypto module access", severity: "medium" as const },
  { pattern: /document\.cookie/, label: "cookie access", severity: "critical" as const },
  { pattern: /localStorage|sessionStorage/, label: "browser storage access", severity: "medium" as const },
  { pattern: /innerHTML\s*=/, label: "innerHTML injection", severity: "high" as const },
  { pattern: /\bfetch\s*\(/, label: "network fetch call", severity: "medium" as const },
  { pattern: /XMLHttpRequest/, label: "XHR network call", severity: "medium" as const },
  { pattern: /WebSocket/, label: "WebSocket connection", severity: "high" as const },
  { pattern: /\.env\b/, label: ".env file reference", severity: "high" as const },
  { pattern: /password|secret|token|api_key|apikey/i, label: "potential credential reference", severity: "medium" as const },
  { pattern: /DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i, label: "destructive SQL", severity: "critical" as const },
  { pattern: /rm\s+-rf|rmdir|unlink/i, label: "file deletion command", severity: "critical" as const },
];

const BLOCKED_SKILL_PATTERNS = [
  /ignore.*(?:previous|above|prior).*(?:instruction|prompt|rule)/i,
  /you are now|act as|pretend to be|forget.*(?:rule|instruction)/i,
  /override.*(?:safety|security|governance|rule)/i,
  /disable.*(?:auth|security|check|validation|guard)/i,
  /bypass.*(?:auth|check|validation|permission)/i,
  /reveal.*(?:secret|password|token|key|credential)/i,
  /execute.*(?:arbitrary|raw|unfiltered)/i,
  /grant.*(?:admin|root|superuser|full access)/i,
];

const GAP_DETECTION_PATTERNS = [
  /i (?:don't|do not|cannot|can't) (?:have|know how to|do|perform|access|create)/i,
  /(?:no tool|no capability|not supported|not available|missing feature)/i,
  /(?:unable to|lack the ability|beyond my (?:current )?capabilit)/i,
  /(?:unfortunately|sorry),? (?:i |this |that )(?:isn't|is not|can't|cannot)/i,
  /this (?:tool|feature|capability) (?:doesn't|does not) exist/i,
];

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTrustedDomain(url: string): boolean {
  const domain = getDomain(url);
  if (!domain) return false;
  for (const trusted of TRUSTED_DOMAINS) {
    if (domain === trusted || domain.endsWith("." + trusted)) return true;
  }
  return false;
}

function isTrustedGitHubRepo(url: string): boolean {
  const domain = getDomain(url);
  if (domain !== "github.com") return false;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      return TRUSTED_GITHUB_ORGS.has(parts[0].toLowerCase());
    }
  } catch {}
  return false;
}

function getUrlTrustScore(url: string): { score: number; reason: string } {
  if (!url) return { score: 0.3, reason: "no URL" };
  const domain = getDomain(url);

  if (isTrustedGitHubRepo(url)) return { score: 1.0, reason: `trusted GitHub org` };
  if (domain === "github.com") return { score: 0.7, reason: "GitHub (unverified org)" };
  if (isTrustedDomain(url)) return { score: 0.9, reason: `trusted domain: ${domain}` };
  if (domain.endsWith(".gov") || domain.endsWith(".edu")) return { score: 0.85, reason: `government/education domain` };

  return { score: 0.3, reason: `untrusted domain: ${domain}` };
}

function scanCodeForDangers(code: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const { pattern, label, severity } of DANGEROUS_CODE_PATTERNS) {
    if (pattern.test(code)) {
      if (severity === "critical") {
        issues.push(`BLOCKED: ${label}`);
      } else if (severity === "high") {
        issues.push(`BLOCKED: ${label}`);
      } else {
        issues.push(`NOTICE: ${label}`);
      }
    }
  }
  const blockedCount = issues.filter(i => i.startsWith("BLOCKED")).length;
  return { safe: blockedCount === 0, issues };
}

const VALID_APPROACHES = new Set(["tool", "skill", "both", "external_api", "not_feasible"]);
const VALID_ASSESSMENTS = new Set(["safe", "caution", "risky", "blocked"]);

function validateAnalysisSchema(analysis: any): { valid: boolean; reason?: string } {
  if (typeof analysis !== "object" || analysis === null) return { valid: false, reason: "Not an object" };
  if (typeof analysis.solvable !== "boolean") return { valid: false, reason: "Missing or invalid 'solvable'" };
  if (!VALID_APPROACHES.has(analysis.approach)) return { valid: false, reason: `Invalid approach: ${analysis.approach}` };
  if (analysis.security_assessment && !VALID_ASSESSMENTS.has(analysis.security_assessment)) {
    return { valid: false, reason: `Invalid security_assessment: ${analysis.security_assessment}` };
  }
  if (analysis.approach === "tool" && !analysis.tool_description) return { valid: false, reason: "Tool approach without tool_description" };
  if (analysis.approach === "skill" && !analysis.skill_content) return { valid: false, reason: "Skill approach without skill_content" };
  return { valid: true };
}

function scanSkillForInjection(content: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const pattern of BLOCKED_SKILL_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`BLOCKED: Prompt injection pattern detected: ${pattern.source.substring(0, 50)}`);
    }
  }
  return { safe: issues.length === 0, issues };
}

function sanitizeResearchContent(content: string): string {
  if (!content || typeof content !== "string") return "";
  let clean = content;
  for (const pattern of BLOCKED_SKILL_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    clean = clean.replace(globalPattern, "[REDACTED]");
  }
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, "[REDACTED]");
  clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "[REDACTED]");
  clean = clean.replace(/javascript\s*:/gi, "[REDACTED]");
  clean = clean.replace(/data\s*:\s*text\/html/gi, "[REDACTED]");
  clean = clean.replace(/\beval\s*\(/gi, "[REDACTED](");
  clean = clean.replace(/\bFunction\s*\(/gi, "[REDACTED](");
  clean = clean.replace(/child_process/gi, "[REDACTED]");
  clean = clean.replace(/process\.env/gi, "[REDACTED]");
  clean = clean.replace(/__proto__/g, "[REDACTED]");
  return clean;
}

function sanitizeResearchResult(r: ResearchResult): ResearchResult {
  return {
    ...r,
    title: sanitizeResearchContent(r.title),
    summary: sanitizeResearchContent(r.summary),
    implementation_hint: r.implementation_hint ? sanitizeResearchContent(r.implementation_hint) : undefined,
  };
}

const ANALYSIS_PROMPT = `You are a SECURITY-CONSCIOUS capability analyst for the VisionClaw AI agent platform.
Given a capability gap, analyze research results and determine the safest approach to add this capability.

SECURITY RULES (MANDATORY):
1. NEVER suggest tools that access the filesystem, environment variables, network sockets, or shell commands
2. NEVER suggest skills that override safety rules, disable auth, or grant elevated permissions
3. Only recommend approaches using SANDBOXED code execution (no imports, no require, no network)
4. Prefer skill-based solutions (prompt knowledge) over tool-based solutions (code) when possible
5. If the capability requires external API access, mark as "external_api" — it needs manual admin integration
6. If the capability could compromise security or data integrity, mark as "not_feasible" with clear reasoning
7. Tool implementations must be pure JavaScript: Math, Date, JSON, String, Number, Array, Object, Map, Set, RegExp only
8. NEVER generate code that references passwords, tokens, API keys, or credentials

Respond with ONLY valid JSON:
{
  "solvable": true/false,
  "approach": "tool" | "skill" | "both" | "external_api" | "not_feasible",
  "reasoning": "Why this approach, including security considerations",
  "security_assessment": "safe" | "caution" | "risky" | "blocked",
  "security_notes": "Specific security considerations for this capability",
  "tool_description": "If approach includes tool: describe what the tool should do (SANDBOXED, no network/fs/env)",
  "skill_content": "If approach includes skill: the full skill prompt content",
  "skill_name": "If approach includes skill: short name",
  "skill_category": "coding|research|communication|automation|creative|analysis|general",
  "priority": "high|medium|low",
  "estimated_complexity": "simple|moderate|complex",
  "requires_admin_approval": true/false
}`;

async function getAnalysisClient() {
  try {
    const { client } = await getClientForModel("gpt-4.1");
    return { client, model: "gpt-4.1" };
  } catch {
    try {
      const { client } = await getClientForModel("claude-sonnet-4-20250514");
      return { client, model: "claude-sonnet-4-20250514" };
    } catch {
      const { client } = await getClientForModel("gpt-5.4");
      return { client, model: "gpt-5.4" };
    }
  }
}

export async function detectGap(
  description: string,
  context?: string,
  personaId?: number,
  tenantId: number = 1,
  source: string = "auto"
): Promise<CapabilityGap> {
  const existing = await db.execute(
    sql`SELECT * FROM capability_gaps WHERE gap_description = ${description} AND tenant_id = ${tenantId} AND status NOT IN ('resolved', 'safety_blocked') LIMIT 1`
  );
  if (existing.rows.length > 0) return existing.rows[0] as any;

  const result = await db.execute(
    sql`INSERT INTO capability_gaps (tenant_id, persona_id, gap_description, trigger_context, source, status, priority)
        VALUES (${tenantId}, ${personaId ?? null}, ${description}, ${context ?? null}, ${source}, 'detected', 'medium')
        ON CONFLICT DO NOTHING
        RETURNING *`
  );
  if (result.rows.length === 0) {
    const retry = await db.execute(
      sql`SELECT * FROM capability_gaps WHERE gap_description = ${description} AND tenant_id = ${tenantId} LIMIT 1`
    );
    if (retry.rows.length > 0) return retry.rows[0] as any;
    throw new Error(`Failed to insert or find gap: ${description}`);
  }
  console.log(`[skill-seeker] Gap detected (tenant ${tenantId}): ${description}`);
  return result.rows[0] as any;
}

export function scanForGaps(responseText: string): string | null {
  for (const pattern of GAP_DETECTION_PATTERNS) {
    const match = responseText.match(pattern);
    if (match) {
      const sentenceStart = Math.max(0, responseText.lastIndexOf(".", match.index! - 100) + 1);
      const sentenceEnd = responseText.indexOf(".", match.index! + match[0].length) + 1 || match.index! + match[0].length + 100;
      return responseText.substring(sentenceStart, sentenceEnd).trim();
    }
  }
  return null;
}

export async function researchGap(gapId: number): Promise<ResearchResult[]> {
  const gapRows = await db.execute(sql`SELECT * FROM capability_gaps WHERE id = ${gapId}`);
  if (gapRows.rows.length === 0) throw new Error(`Gap ${gapId} not found`);
  const gap = gapRows.rows[0] as any;

  await db.execute(sql`UPDATE capability_gaps SET status = 'researching' WHERE id = ${gapId}`);
  console.log(`[skill-seeker] Researching gap #${gapId}: ${gap.gap_description}`);

  const results: ResearchResult[] = [];

  try {
    const webResults = await executeTool("web_search", {
      query: `${gap.gap_description} implementation tutorial API`,
      max_results: 8,
    });
    if (webResults?.results) {
      for (const r of webResults.results.slice(0, 8)) {
        const url = r.url || r.link || "";
        const trust = getUrlTrustScore(url);
        results.push({
          source: "web_search",
          title: r.title || r.name || "Web result",
          url,
          summary: r.snippet || r.description || "",
          relevance: 0.7,
          actionable: trust.score >= 0.5,
          trust_score: trust.score,
          trust_reason: trust.reason,
        });
      }
    }
  } catch (e: any) {
    console.log(`[skill-seeker] Web search failed: ${e.message}`);
  }

  try {
    const ghResults = await executeTool("web_search", {
      query: `site:github.com ${gap.gap_description} typescript javascript`,
      max_results: 5,
    });
    if (ghResults?.results) {
      for (const r of ghResults.results.slice(0, 5)) {
        const url = r.url || r.link || "";
        const trust = getUrlTrustScore(url);
        results.push({
          source: "github",
          title: r.title || r.name || "GitHub result",
          url,
          summary: r.snippet || r.description || "",
          relevance: 0.8,
          actionable: trust.score >= 0.5,
          trust_score: trust.score,
          trust_reason: trust.reason,
        });
      }
    }
  } catch (e: any) {
    console.log(`[skill-seeker] GitHub search failed: ${e.message}`);
  }

  try {
    const npmResults = await executeTool("web_search", {
      query: `site:npmjs.com ${gap.gap_description}`,
      max_results: 3,
    });
    if (npmResults?.results) {
      for (const r of npmResults.results.slice(0, 3)) {
        const url = r.url || r.link || "";
        const trust = getUrlTrustScore(url);
        results.push({
          source: "npm",
          title: r.title || r.name || "npm package",
          url,
          summary: r.snippet || r.description || "",
          relevance: 0.75,
          actionable: trust.score >= 0.5,
          trust_score: trust.score,
          trust_reason: trust.reason,
        });
      }
    }
  } catch (e: any) {
    console.log(`[skill-seeker] npm search failed: ${e.message}`);
  }

  const trustedResults = results.filter(r => r.trust_score >= 0.5);
  const untrustedCount = results.length - trustedResults.length;
  if (untrustedCount > 0) {
    console.log(`[skill-seeker] Filtered out ${untrustedCount} untrusted results for gap #${gapId}`);
  }

  if (trustedResults.length > 0) {
    let detailCount = 0;
    for (const r of trustedResults) {
      if (detailCount >= 3) break;
      if (r.url && r.trust_score >= 0.7) {
        try {
          const pageContent = await executeTool("web_fetch", { url: r.url, max_length: 3000 });
          if (pageContent?.content || pageContent?.text) {
            const raw = (pageContent.content || pageContent.text).substring(0, 1500);
            r.implementation_hint = sanitizeResearchContent(raw);
            detailCount++;
          }
        } catch {}
      }
    }
  }

  await db.execute(
    sql`UPDATE capability_gaps SET research_results = ${JSON.stringify(results)}::jsonb, status = 'researched' WHERE id = ${gapId}`
  );

  console.log(`[skill-seeker] Research complete for gap #${gapId}: ${trustedResults.length} trusted / ${results.length} total results`);
  return results;
}

function runSafetyChecks(analysis: any): SafetyReport {
  const report: SafetyReport = {
    passed: true,
    checks_run: [],
    issues_found: [],
    trust_level: "high",
  };

  if (analysis.security_assessment === "blocked") {
    report.passed = false;
    report.trust_level = "blocked";
    report.blocked_reason = `LLM security assessment: ${analysis.security_notes || "blocked by analyst"}`;
    report.issues_found.push(report.blocked_reason);
    report.checks_run.push("llm_security_assessment");
    return report;
  }

  if (analysis.tool_description) {
    report.checks_run.push("tool_code_safety_scan");
    const codeScan = scanCodeForDangers(analysis.tool_description);
    if (!codeScan.safe) {
      report.passed = false;
      report.trust_level = "blocked";
      report.blocked_reason = `Tool description contains dangerous patterns: ${codeScan.issues.join(", ")}`;
      report.issues_found.push(...codeScan.issues);
    } else if (codeScan.issues.length > 0) {
      report.trust_level = "medium";
      report.issues_found.push(...codeScan.issues);
    }
  }

  if (analysis.skill_content) {
    report.checks_run.push("skill_injection_scan");
    const skillScan = scanSkillForInjection(analysis.skill_content);
    if (!skillScan.safe) {
      report.passed = false;
      report.trust_level = "blocked";
      report.blocked_reason = `Skill content contains injection patterns: ${skillScan.issues.join(", ")}`;
      report.issues_found.push(...skillScan.issues);
    }

    report.checks_run.push("skill_content_safety_scan");
    const contentScan = scanCodeForDangers(analysis.skill_content);
    if (contentScan.issues.length > 0) {
      report.issues_found.push(...contentScan.issues.map(i => `In skill content: ${i}`));
      const hasCritical = contentScan.issues.some(i => i.startsWith("BLOCKED"));
      if (hasCritical) {
        report.passed = false;
        report.trust_level = "blocked";
        report.blocked_reason = "Skill content references dangerous operations";
      }
    }
  }

  if (analysis.approach === "external_api") {
    report.checks_run.push("external_api_check");
    report.trust_level = "low";
    report.passed = false;
    report.blocked_reason = "Requires external API integration — needs admin manual setup, not auto-creation";
    report.issues_found.push("External API capabilities cannot be auto-created safely");
  }

  if (analysis.requires_admin_approval) {
    report.checks_run.push("admin_approval_required");
    if (report.trust_level === "high") report.trust_level = "medium";
    report.issues_found.push("LLM analyst flagged this for admin review");
  }

  if (analysis.security_assessment === "risky") {
    report.checks_run.push("risk_level_check");
    report.trust_level = "low";
    report.passed = false;
    report.blocked_reason = `LLM flagged as risky: ${analysis.security_notes || "unspecified risk"}`;
    report.issues_found.push(report.blocked_reason);
  }

  if (analysis.estimated_complexity === "complex" && analysis.approach === "tool") {
    report.checks_run.push("complexity_check");
    if (report.trust_level === "high") report.trust_level = "medium";
    report.issues_found.push("Complex tool — sandboxed execution may be limited");
  }

  return report;
}

export async function analyzeAndLearn(gapId: number): Promise<SkillSeekerResult> {
  const gapRows = await db.execute(sql`SELECT * FROM capability_gaps WHERE id = ${gapId}`);
  if (gapRows.rows.length === 0) throw new Error(`Gap ${gapId} not found`);
  const gap = gapRows.rows[0] as any;

  let researchResults: ResearchResult[] = gap.research_results || [];
  if (researchResults.length === 0 || gap.status === "detected") {
    researchResults = await researchGap(gapId);
  }

  const trustedOnly = researchResults
    .filter(r => (r.trust_score || 0) >= 0.5)
    .map(sanitizeResearchResult);

  const { client, model } = await getAnalysisClient();
  const sanitizedGapDesc = sanitizeResearchContent(gap.gap_description);
  const sanitizedContext = sanitizeResearchContent(gap.trigger_context || "None");
  const analysisResponse = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: ANALYSIS_PROMPT },
      {
        role: "user",
        content: `Gap: ${sanitizedGapDesc}\nContext: ${sanitizedContext}\n\nTrusted Research Results (${trustedOnly.length} of ${researchResults.length} passed trust filter):\n${JSON.stringify(trustedOnly, null, 2)}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });

  let analysis: any;
  try {
    const raw = analysisResponse.choices[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    analysis = { solvable: false, approach: "not_feasible", reasoning: "Could not parse analysis", security_assessment: "blocked" };
  }

  const schemaCheck = validateAnalysisSchema(analysis);
  if (!schemaCheck.valid) {
    console.log(`[skill-seeker] LLM analysis failed schema validation: ${schemaCheck.reason} (gap #${gapId})`);
    analysis = { solvable: false, approach: "not_feasible", reasoning: `Analysis schema invalid: ${schemaCheck.reason}`, security_assessment: "blocked" };
  }

  const safetyReport = runSafetyChecks(analysis);

  const result: SkillSeekerResult = {
    gap_id: gapId,
    gap_description: gap.gap_description,
    research_count: researchResults.length,
    research_results: researchResults,
    action_taken: "none",
    status: "analyzed",
    safety_report: safetyReport,
  };

  if (!analysis.solvable) {
    await db.execute(
      sql`UPDATE capability_gaps SET status = 'not_feasible', resolution = ${analysis.reasoning} WHERE id = ${gapId}`
    );
    result.action_taken = "not_feasible";
    result.status = "not_feasible";
    return result;
  }

  if (!safetyReport.passed) {
    const blockMsg = `SAFETY BLOCKED: ${safetyReport.blocked_reason}. Issues: ${safetyReport.issues_found.join("; ")}`;
    console.log(`[skill-seeker] ${blockMsg} (gap #${gapId})`);
    await db.execute(
      sql`UPDATE capability_gaps SET status = 'safety_blocked', resolution = ${blockMsg} WHERE id = ${gapId}`
    );
    result.action_taken = "safety_blocked";
    result.status = "safety_blocked";
    return result;
  }

  if (safetyReport.trust_level === "low") {
    const cautionMsg = `NEEDS REVIEW: ${safetyReport.issues_found.join("; ")}. Flagged for admin approval.`;
    console.log(`[skill-seeker] ${cautionMsg} (gap #${gapId})`);
    await db.execute(
      sql`UPDATE capability_gaps SET status = 'needs_review', resolution = ${cautionMsg} WHERE id = ${gapId}`
    );
    result.action_taken = "needs_review";
    result.status = "needs_review";
    return result;
  }

  if (analysis.approach === "tool" || analysis.approach === "both") {
    if (analysis.tool_description) {
      const toolCodeScan = scanCodeForDangers(analysis.tool_description);
      if (toolCodeScan.safe) {
        try {
          const toolResult = await executeTool("create_tool", {
            description: analysis.tool_description,
          });
          const toolName = toolResult?.name || toolResult?.tool?.name;
          const toolImpl = toolResult?.implementation || toolResult?.tool?.implementation;
          if (toolName) {
            if (toolImpl) {
              const implScan = scanCodeForDangers(toolImpl);
              if (!implScan.safe) {
                console.log(`[skill-seeker] SAFETY: Generated tool code failed safety scan: ${implScan.issues.join(", ")}`);
                try {
                  await executeTool("delete_custom_tool", { name: toolName });
                } catch (delErr: any) {
                  console.log(`[skill-seeker] WARNING: Failed to delete unsafe tool ${toolName}: ${delErr.message}`);
                }
                result.safety_report!.issues_found.push(`Generated code blocked and deleted: ${implScan.issues.join(", ")}`);
              } else {
                result.new_tool = toolName;
                result.action_taken = "created_tool";
                await db.execute(
                  sql`UPDATE capability_gaps SET resolved_tool = ${toolName} WHERE id = ${gapId}`
                );
                console.log(`[skill-seeker] Created trusted tool: ${toolName} for gap #${gapId} (trust: ${safetyReport.trust_level})`);
              }
            } else {
              result.new_tool = toolName;
              result.action_taken = "created_tool";
              await db.execute(
                sql`UPDATE capability_gaps SET resolved_tool = ${toolName} WHERE id = ${gapId}`
              );
              console.log(`[skill-seeker] Created tool (no impl to verify): ${toolName} for gap #${gapId}`);
            }
          }
        } catch (e: any) {
          console.log(`[skill-seeker] Tool creation failed for gap #${gapId}: ${e.message}`);
        }
      } else {
        console.log(`[skill-seeker] SAFETY: Tool description blocked: ${toolCodeScan.issues.join(", ")}`);
        result.safety_report!.issues_found.push(`Tool description blocked: ${toolCodeScan.issues.join(", ")}`);
      }
    }
  }

  if (analysis.approach === "skill" || analysis.approach === "both") {
    if (analysis.skill_content && analysis.skill_name) {
      const skillScan = scanSkillForInjection(analysis.skill_content);
      const contentScan = scanCodeForDangers(analysis.skill_content);
      const hasCriticalContent = contentScan.issues.some(i => i.startsWith("BLOCKED"));

      if (skillScan.safe && !hasCriticalContent) {
        try {
          const skillResult = await executeTool("manage_skills", {
            command: "create",
            name: analysis.skill_name,
            description: `Auto-learned skill: ${gap.gap_description}`,
            promptContent: analysis.skill_content,
            category: analysis.skill_category || "general",
            icon: "Lightbulb",
          });
          if (skillResult?.id || skillResult?.skill) {
            const skillName = skillResult.skill?.name || analysis.skill_name;
            result.new_skill = skillName;
            result.action_taken = result.new_tool ? "created_both" : "created_skill";
            await db.execute(
              sql`UPDATE capability_gaps SET resolved_skill = ${skillName} WHERE id = ${gapId}`
            );
            console.log(`[skill-seeker] Created trusted skill: ${skillName} for gap #${gapId} (trust: ${safetyReport.trust_level})`);
          }
        } catch (e: any) {
          console.log(`[skill-seeker] Skill creation failed: ${e.message}`);
        }
      } else {
        const reasons = [...skillScan.issues, ...contentScan.issues.filter(i => i.startsWith("BLOCKED"))];
        console.log(`[skill-seeker] SAFETY: Skill blocked: ${reasons.join(", ")}`);
        result.safety_report!.issues_found.push(`Skill blocked: ${reasons.join(", ")}`);
      }
    }
  }

  const finalStatus = result.new_tool || result.new_skill ? "resolved" : "analyzed";
  const resolution = result.new_tool || result.new_skill
    ? `Resolved via ${[result.new_tool && `tool: ${result.new_tool}`, result.new_skill && `skill: ${result.new_skill}`].filter(Boolean).join(" + ")}. Safety: ${safetyReport.trust_level}. ${analysis.reasoning}`
    : `${analysis.reasoning}. Safety: ${safetyReport.trust_level}. ${safetyReport.issues_found.length > 0 ? "Issues: " + safetyReport.issues_found.join("; ") : "No issues."}`;

  await db.execute(
    sql`UPDATE capability_gaps SET status = ${finalStatus}, resolution = ${resolution}, 
        resolved_at = ${finalStatus === "resolved" ? sql`NOW()` : sql`NULL`} WHERE id = ${gapId}`
  );

  result.status = finalStatus;
  return result;
}

export async function seekAndLearn(
  description: string,
  context?: string,
  personaId?: number,
  tenantId: number = 1
): Promise<SkillSeekerResult> {
  const gap = await detectGap(description, context, personaId, tenantId, "agent_request");
  return analyzeAndLearn(gap.id);
}

export async function listGaps(
  status?: string,
  limit: number = 20,
  tenantId?: number
): Promise<CapabilityGap[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  if (status && tenantId) {
    const result = await db.execute(
      sql`SELECT * FROM capability_gaps WHERE status = ${status} AND tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${safeLimit}`
    );
    return result.rows as any[];
  } else if (status) {
    const result = await db.execute(
      sql`SELECT * FROM capability_gaps WHERE status = ${status} ORDER BY created_at DESC LIMIT ${safeLimit}`
    );
    return result.rows as any[];
  } else if (tenantId) {
    const result = await db.execute(
      sql`SELECT * FROM capability_gaps WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${safeLimit}`
    );
    return result.rows as any[];
  } else {
    const result = await db.execute(
      sql`SELECT * FROM capability_gaps ORDER BY created_at DESC LIMIT ${safeLimit}`
    );
    return result.rows as any[];
  }
}

export async function runSkillSeekerSweep(tenantId: number = 1): Promise<{
  gaps_found: number;
  gaps_researched: number;
  gaps_resolved: number;
  gaps_blocked: number;
  gaps_needs_review: number;
  new_tools: string[];
  new_skills: string[];
  safety_blocks: string[];
}> {
  console.log(`[skill-seeker] Starting sweep for tenant ${tenantId}`);

  const unresolvedRows = await db.execute(
    sql`SELECT * FROM capability_gaps WHERE status IN ('detected', 'researched') AND tenant_id = ${tenantId} ORDER BY priority DESC, created_at ASC LIMIT 5`
  );

  const summary = {
    gaps_found: unresolvedRows.rows.length,
    gaps_researched: 0,
    gaps_resolved: 0,
    gaps_blocked: 0,
    gaps_needs_review: 0,
    new_tools: [] as string[],
    new_skills: [] as string[],
    safety_blocks: [] as string[],
  };

  for (const row of unresolvedRows.rows) {
    const gap = row as any;
    try {
      const result = await analyzeAndLearn(gap.id);
      summary.gaps_researched++;
      if (result.status === "resolved") {
        summary.gaps_resolved++;
        if (result.new_tool) summary.new_tools.push(result.new_tool);
        if (result.new_skill) summary.new_skills.push(result.new_skill);
      } else if (result.status === "safety_blocked") {
        summary.gaps_blocked++;
        summary.safety_blocks.push(`Gap #${gap.id}: ${result.safety_report?.blocked_reason || "blocked"}`);
      } else if (result.status === "needs_review") {
        summary.gaps_needs_review++;
      }
    } catch (e: any) {
      console.log(`[skill-seeker] Failed to process gap #${gap.id}: ${e.message}`);
    }
  }

  if (summary.new_tools.length > 0 || summary.new_skills.length > 0) {
    try {
      await executeTool("sync_personas", {});
      console.log(`[skill-seeker] Synced persona docs after learning new capabilities`);
    } catch {}
  }

  console.log(`[skill-seeker] Sweep complete: ${summary.gaps_resolved} resolved, ${summary.gaps_blocked} blocked, ${summary.gaps_needs_review} needs review (of ${summary.gaps_found} total)`);
  return summary;
}

export function setupGapDetectionHook(hookEmitter: any) {
  if (!hookEmitter) return;

  hookEmitter.on("message:sent", async (data: any) => {
    try {
      const content = data?.content || data?.message || "";
      if (typeof content !== "string" || content.length < 30) return;

      const gapText = scanForGaps(content);
      if (gapText) {
        const personaId = data?.personaId || data?.persona_id;
        const tenantId = data?.tenantId || data?.tenant_id;
        await detectGap(gapText, `Auto-detected from agent response`, personaId, tenantId, "auto_detection");
      }
    } catch {}
  });

  console.log("[skill-seeker] Gap detection hook registered on message:sent");
}

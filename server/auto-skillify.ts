import { db } from "./db";
import { skills } from "@shared/schema";
import { ilike } from "drizzle-orm";
import { storage } from "./storage";

interface OrchestrationSummary {
  planId: string;
  objective: string;
  conversationId: number;
  tenantId: number;
  personaId?: number;
  steps: {
    name: string;
    agent: string;
    toolsUsed: string[];
    status: string;
    leanMode?: boolean;
  }[];
  totalTimeMs: number;
  status: "complete" | "failed";
}

const MIN_STEPS_FOR_SKILL = 3;
const MIN_UNIQUE_TOOLS = 2;
const MIN_STEPS_FOR_FAILURE_SKILL = 2;
const MIN_UNIQUE_TOOLS_FOR_FAILURE = 1;
const SIMILARITY_THRESHOLD = 0.7;
const COOLDOWN_MS = 300_000;
const ADVISORY_LOCK_NAMESPACE = 0x534b4c4c;
const recentCaptures = new Map<string, number>();

function learningSpaceLockKey(tenantId: number, mode: "success" | "failure", objective: string): bigint {
  const normalized = `${tenantId}:${mode}:${normalizeForComparison(objective).slice(0, 80)}`;
  let h = 0n;
  for (let i = 0; i < normalized.length; i++) {
    h = (h * 31n + BigInt(normalized.charCodeAt(i))) & 0x7fffffffn;
  }
  return h;
}

async function withLearningSpaceLock<T>(
  tenantId: number,
  mode: "success" | "failure",
  objective: string,
  fn: () => Promise<T>,
): Promise<T | "locked"> {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");
  const ns = BigInt(ADVISORY_LOCK_NAMESPACE);
  const key = learningSpaceLockKey(tenantId, mode, objective);

  // pg_try_advisory_xact_lock is bound to the transaction — auto-released on
  // commit/rollback, so we don't risk the unlock being routed to a different
  // pooled connection than the lock (Neon serverless pool gotcha).
  return await db.transaction(async (tx) => {
    const acquired = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${ns}::int, ${key}::int) AS got`);
    const rows = (acquired as any).rows || acquired;
    const got = !!(rows?.[0]?.got);
    if (!got) {
      console.log(`[auto-skill] Skipping — learning-space lock held (tenant=${tenantId} mode=${mode})`);
      return "locked" as const;
    }
    return await fn();
  });
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function calculateSimilarity(a: string, b: string): number {
  const aNorm = normalizeForComparison(a);
  const bNorm = normalizeForComparison(b);
  if (aNorm === bNorm) return 1;

  const aWords = new Set(aNorm.split(" "));
  const bWords = new Set(bNorm.split(" "));
  const intersection = new Set([...aWords].filter(w => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

async function isDuplicateSkill(candidateName: string, category: string): Promise<boolean> {
  // NOTE (R125+13.17+sec triage): architect flagged this as a missing tenant
  // filter. Verified: the `skills` table is intentionally GLOBAL (no tenant_id
  // column — see shared/schema.ts:308). The dedup-against-global behavior is
  // by design (learned skills are platform-wide). A future hardening pass
  // could add tenancy to the table; logged in replit.md as a deferred concern.
  // Dedup within the candidate's own category: success skills ("learned") and
  // failure lessons ("learned-failure") live in separate namespaces, so the
  // query must match the category being written or failure lessons bypass
  // dedup entirely and accumulate noise.
  const existing = await db.select({ name: skills.name })
    .from(skills)
    .where(ilike(skills.category, category));

  for (const skill of existing) {
    if (calculateSimilarity(candidateName, skill.name) >= SIMILARITY_THRESHOLD) {
      return true;
    }
  }
  return false;
}

// R125+13.17+sec — gate auto-skillify against destructive tool sequences.
// If the orchestration touched any destructive/sensitive tool (per the policy
// registry), don't auto-distill a learned skill from it — a "how to delete
// data more reliably" skill is a maladaptive learning path. Architect HIGH.
async function involvesDestructiveTool(uniqueTools: string[]): Promise<boolean> {
  const { getToolRiskClass } = await import("./safety/destructive-tool-policy");
  for (const t of uniqueTools) {
    const risk = getToolRiskClass(t);
    if (risk === "HIGH" || risk === "CRITICAL") return true;
  }
  return false;
}

export async function autoSkillCapture(summary: OrchestrationSummary): Promise<void> {
  try {
    const mode: "success" | "failure" = summary.status === "complete" ? "success" : "failure";

    if (mode === "success") {
      const completedSteps = summary.steps.filter(s => s.status === "complete");
      if (completedSteps.length < MIN_STEPS_FOR_SKILL) return;

      const allTools = completedSteps.flatMap(s => s.toolsUsed);
      const uniqueTools = [...new Set(allTools)];
      if (uniqueTools.length < MIN_UNIQUE_TOOLS) return;

      await captureSkill(summary, mode, completedSteps.length, uniqueTools);
    } else {
      const executedSteps = summary.steps.filter(s => s.status === "complete" || s.status === "failed");
      if (executedSteps.length < MIN_STEPS_FOR_FAILURE_SKILL) return;

      const allTools = executedSteps.flatMap(s => s.toolsUsed);
      const uniqueTools = [...new Set(allTools)];
      if (uniqueTools.length < MIN_UNIQUE_TOOLS_FOR_FAILURE) return;

      await captureSkill(summary, mode, executedSteps.length, uniqueTools);
    }
  } catch (err: any) {
    console.error(`[auto-skill] Error:`, err.message);
  }
}

async function captureSkill(
  summary: OrchestrationSummary,
  mode: "success" | "failure",
  stepCount: number,
  uniqueTools: string[],
): Promise<void> {
  const captureKey = `${summary.tenantId}:${mode}:${normalizeForComparison(summary.objective).slice(0, 50)}`;
  const lastCapture = recentCaptures.get(captureKey);
  if (lastCapture && Date.now() - lastCapture < COOLDOWN_MS) return;

  if (await involvesDestructiveTool(uniqueTools)) {
    console.log(`[auto-skill] Skipping "${summary.objective.slice(0, 60)}" — orchestration touched destructive/sensitive tools (safety-gate)`);
    return;
  }

  const candidateName = generateSkillName(summary, mode);
  const dedupeCategory = mode === "failure" ? "learned-failure" : "learned";
  if (await isDuplicateSkill(candidateName, dedupeCategory)) {
    console.log(`[auto-skill] Skipping "${candidateName}" — similar skill already exists`);
    return;
  }

  await withLearningSpaceLock(summary.tenantId, mode, summary.objective, async () => {
    if (await isDuplicateSkill(candidateName, dedupeCategory)) {
      console.log(`[auto-skill] Skipping "${candidateName}" — duplicate appeared after lock`);
      return;
    }

    const { distillIntent, skillifyConversation } = await import("./skillify");

    const distill = await distillIntent(summary.conversationId, summary.tenantId, mode);
    if (!distill.worthSkillifying) {
      console.log(`[auto-skill] Stage-1 gate rejected (${mode}, plan ${summary.planId}): ${distill.reason}`);
      return;
    }
    console.log(`[auto-skill] Stage-1 gate passed (${mode}, plan ${summary.planId}): ${distill.reason}${distill.scopeHint ? ` [scope: ${distill.scopeHint}]` : ""}`);

    recentCaptures.set(captureKey, Date.now());

    const result = await skillifyConversation(
      summary.conversationId,
      summary.tenantId,
      candidateName,
      summary.personaId ?? null,
      mode,
    );

    await handleResult(result, summary, mode, stepCount, uniqueTools);
  });
}

async function handleResult(
  result: { skill?: { id: number; name: string; description: string }; error?: string },
  summary: OrchestrationSummary,
  mode: "success" | "failure",
  stepCount: number,
  uniqueTools: string[],
): Promise<void> {

  if (result.skill) {
    const tag = mode === "failure" ? "failure-lesson" : "skill";
    console.log(`[auto-skill] Captured ${tag} "${result.skill.name}" (ID ${result.skill.id}) from plan ${summary.planId} — ${stepCount} steps, ${uniqueTools.length} tools`);

    const { trackActivity } = await import("./agent-activity");
    await trackActivity({
      tenantId: summary.tenantId,
      personaId: summary.personaId,
      personaName: "Felix",
      activityType: mode === "failure" ? "failure_lesson_learned" : "skill_learned",
      status: "complete",
      summary: mode === "failure"
        ? `Distilled failure-lesson: "${result.skill.name}" from failed orchestration "${summary.objective}"`
        : `Learned new skill: "${result.skill.name}" from orchestration "${summary.objective}"`,
      conversationId: summary.conversationId,
      metadata: {
        skillId: result.skill.id,
        skillName: result.skill.name,
        planId: summary.planId,
        stepsExecuted: stepCount,
        toolsUsed: uniqueTools,
        mode,
      },
    });
  } else if (result.error) {
    console.log(`[auto-skill] Extraction failed for plan ${summary.planId} (${mode}): ${result.error}`);
  }
}

function generateSkillName(summary: OrchestrationSummary, mode: "success" | "failure" = "success"): string {
  const objective = summary.objective.toLowerCase();

  const patterns: [RegExp, string][] = [
    [/research|analyze|investigate|study/i, "Research"],
    [/report|document|write|draft/i, "Report Generation"],
    [/email|outreach|contact|send/i, "Email Outreach"],
    [/competitive|competitor|market/i, "Competitive Analysis"],
    [/legal|contract|compliance/i, "Legal Review"],
    [/presentation|slides|pitch/i, "Presentation Creation"],
    [/content|blog|article|post/i, "Content Creation"],
    [/financial|budget|forecast|revenue/i, "Financial Analysis"],
    [/recruit|hiring|candidate/i, "Recruitment"],
    [/seo|search.*engine|ranking/i, "SEO Strategy"],
  ];

  let category = "Multi-Step Task";
  for (const [pattern, name] of patterns) {
    if (pattern.test(objective)) {
      category = name;
      break;
    }
  }

  const agents = [...new Set(summary.steps.map(s => s.agent))];
  const agentSuffix = agents.length > 1 ? ` (${agents.join(" + ")})` : "";
  const prefix = mode === "failure" ? "Auto: Avoid: " : "Auto: ";

  return `${prefix}${category}${agentSuffix}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentCaptures) {
    if (now - ts > COOLDOWN_MS * 2) recentCaptures.delete(key);
  }
}, 600_000);

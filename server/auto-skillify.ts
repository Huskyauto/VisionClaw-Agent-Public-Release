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
const SIMILARITY_THRESHOLD = 0.7;
const COOLDOWN_MS = 300_000;
const recentCaptures = new Map<string, number>();

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

async function isDuplicateSkill(candidateName: string): Promise<boolean> {
  const existing = await db.select({ name: skills.name })
    .from(skills)
    .where(ilike(skills.category, "learned"));

  for (const skill of existing) {
    if (calculateSimilarity(candidateName, skill.name) >= SIMILARITY_THRESHOLD) {
      return true;
    }
  }
  return false;
}

export async function autoSkillCapture(summary: OrchestrationSummary): Promise<void> {
  try {
    if (summary.status !== "complete") return;

    const completedSteps = summary.steps.filter(s => s.status === "complete");
    if (completedSteps.length < MIN_STEPS_FOR_SKILL) return;

    const allTools = completedSteps.flatMap(s => s.toolsUsed);
    const uniqueTools = [...new Set(allTools)];
    if (uniqueTools.length < MIN_UNIQUE_TOOLS) return;

    const captureKey = `${summary.tenantId}:${normalizeForComparison(summary.objective).slice(0, 50)}`;
    const lastCapture = recentCaptures.get(captureKey);
    if (lastCapture && Date.now() - lastCapture < COOLDOWN_MS) return;

    const candidateName = generateSkillName(summary);
    if (await isDuplicateSkill(candidateName)) {
      console.log(`[auto-skill] Skipping "${candidateName}" — similar skill already exists`);
      return;
    }

    recentCaptures.set(captureKey, Date.now());

    const { skillifyConversation } = await import("./skillify");
    const result = await skillifyConversation(
      summary.conversationId,
      summary.tenantId,
      candidateName,
      summary.personaId ?? null,
    );

    if (result.skill) {
      console.log(`[auto-skill] Captured "${result.skill.name}" (ID ${result.skill.id}) from plan ${summary.planId} — ${completedSteps.length} steps, ${uniqueTools.length} tools`);

      const { trackActivity } = await import("./agent-activity");
      await trackActivity({
        tenantId: summary.tenantId,
        personaId: summary.personaId,
        personaName: "Felix",
        activityType: "skill_learned",
        status: "complete",
        summary: `Learned new skill: "${result.skill.name}" from orchestration "${summary.objective}"`,
        conversationId: summary.conversationId,
        metadata: {
          skillId: result.skill.id,
          skillName: result.skill.name,
          planId: summary.planId,
          stepsCompleted: completedSteps.length,
          toolsUsed: uniqueTools,
        },
      });
    } else if (result.error) {
      console.log(`[auto-skill] Extraction failed for plan ${summary.planId}: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`[auto-skill] Error:`, err.message);
  }
}

function generateSkillName(summary: OrchestrationSummary): string {
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

  return `Auto: ${category}${agentSuffix}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentCaptures) {
    if (now - ts > COOLDOWN_MS * 2) recentCaptures.delete(key);
  }
}, 600_000);

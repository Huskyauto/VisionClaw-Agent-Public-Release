import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ExportedPersona {
  format: "visionclaw-agent-v1";
  exportedAt: string;
  agent: {
    name: string;
    role: string;
    model: string;
    temperature: number;
    autonomyLevel: string;
    identity: {
      soul: string;
      operatingLoop: string;
      toolPreferences: string;
      heartbeatInstructions: string;
    };
    trustProfile: {
      categories: Record<string, number>;
      overallLevel: string;
    };
    skills: Array<{ name: string; description: string; enabled: boolean }>;
    tools: string[];
    governanceRules: Array<{ name: string; category: string; priority: number; description: string }>;
    expressLanes: Array<{ from: string; to: string }>;
    knowledgeTopics: string[];
  };
}

export async function exportPersona(personaId: number, tenantId: number): Promise<ExportedPersona | null> {
  const personaResult = await db.execute(sql`SELECT * FROM personas WHERE id = ${personaId}`);
  const persona = ((personaResult as any).rows || personaResult)[0];
  if (!persona) return null;

  const [trustResult, skillsResult, rulesResult, knowledgeResult] = await Promise.all([
    db.execute(sql`SELECT category, score FROM trust_scores WHERE persona_id = ${personaId} AND tenant_id = ${tenantId}`),
    db.execute(sql`SELECT name, description, enabled FROM skills WHERE persona_id = ${personaId} OR persona_id IS NULL ORDER BY enabled DESC, name`).catch(() => ({ rows: [] })),
    db.execute(sql`SELECT rule_name, category, priority, description FROM governance_rules WHERE tenant_id = ${tenantId} AND enabled = true ORDER BY category, id`),
    db.execute(sql`SELECT DISTINCT category FROM agent_knowledge WHERE persona_id = ${personaId} AND tenant_id = ${tenantId}`).catch(() => ({ rows: [] })),
  ]);

  const trustRows = (trustResult as any).rows || trustResult;
  const trustCategories: Record<string, number> = {};
  for (const row of trustRows) trustCategories[row.category] = Number(row.score);

  const avgTrust = trustRows.length > 0
    ? Math.round(trustRows.reduce((s: number, r: any) => s + Number(r.score), 0) / trustRows.length)
    : 50;

  const autonomyLevel = avgTrust >= 80 ? "trusted" : avgTrust >= 60 ? "autonomous" : avgTrust >= 40 ? "assisted" : avgTrust >= 20 ? "supervised" : "restricted";

  const skillRows = (skillsResult as any).rows || skillsResult;
  const ruleRows = (rulesResult as any).rows || rulesResult;
  const knowledgeRows = (knowledgeResult as any).rows || knowledgeResult;

  const toolNames: string[] = [];
  try {
    const { getPersonaBlockedTools } = await import("./tool-router");
    const personaRole = persona.role || persona.name || "";
    const blockedSet = getPersonaBlockedTools(personaRole);
    if (blockedSet.size > 0) {
      toolNames.push(`All tools except blocked: ${[...blockedSet].join(", ")}`);
    } else {
      toolNames.push("All tools (no blocks)");
    }
  } catch {
    toolNames.push("All tools (default routing)");
  }

  const lanes: Array<{ from: string; to: string }> = [];
  try {
    const { findLanesForAgent } = await import("./express-lanes");
    const agentLanes = findLanesForAgent(personaId);
    for (const lane of agentLanes.outbound) {
      lanes.push({ from: lane.fromName, to: lane.toName });
    }
  } catch {}

  return {
    format: "visionclaw-agent-v1",
    exportedAt: new Date().toISOString(),
    agent: {
      name: persona.name || "Unknown",
      role: persona.role || "",
      model: persona.model || "auto",
      temperature: persona.temperature ?? 0.7,
      autonomyLevel,
      identity: {
        soul: persona.soul || "",
        operatingLoop: persona.operating_loop || "",
        toolPreferences: persona.tool_preferences || "",
        heartbeatInstructions: persona.heartbeat_instructions || "",
      },
      trustProfile: {
        categories: trustCategories,
        overallLevel: autonomyLevel,
      },
      skills: (skillRows as any[]).map((s: any) => ({
        name: s.name,
        description: s.description || "",
        enabled: s.enabled,
      })),
      tools: toolNames,
      governanceRules: (ruleRows as any[]).map((r: any) => ({
        name: r.rule_name,
        category: r.category,
        priority: r.priority,
        description: r.description || "",
      })),
      expressLanes: lanes,
      knowledgeTopics: (knowledgeRows as any[]).map((r: any) => r.category).filter(Boolean),
    },
  };
}

export function exportToMarkdown(exported: ExportedPersona): string {
  const a = exported.agent;
  let md = `# Agent Definition: ${a.name}\n\n`;
  md += `> Exported from VisionClaw Agent Platform on ${exported.exportedAt}\n\n`;
  md += `## Identity\n\n`;
  md += `- **Name:** ${a.name}\n`;
  md += `- **Role:** ${a.role}\n`;
  md += `- **Model:** ${a.model}\n`;
  md += `- **Temperature:** ${a.temperature}\n`;
  md += `- **Autonomy Level:** ${a.autonomyLevel}\n\n`;

  if (a.identity.soul) {
    md += `## SOUL\n\n${a.identity.soul}\n\n`;
  }
  if (a.identity.operatingLoop) {
    md += `## Operating Loop\n\n${a.identity.operatingLoop}\n\n`;
  }

  md += `## Trust Profile\n\n`;
  md += `| Category | Score |\n|---|---|\n`;
  for (const [cat, score] of Object.entries(a.trustProfile.categories)) {
    md += `| ${cat} | ${score} |\n`;
  }
  md += `\n**Overall Level:** ${a.trustProfile.overallLevel}\n\n`;

  const enabledSkills = a.skills.filter(s => s.enabled);
  if (enabledSkills.length > 0) {
    md += `## Skills (${enabledSkills.length} active)\n\n`;
    for (const skill of enabledSkills) {
      md += `- **${skill.name}**: ${skill.description}\n`;
    }
    md += `\n`;
  }

  md += `## Tools\n\n`;
  for (const tool of a.tools) {
    md += `- ${tool}\n`;
  }

  if (a.expressLanes.length > 0) {
    md += `\n## Express Lanes\n\n`;
    for (const lane of a.expressLanes) {
      md += `- ${lane.from} → ${lane.to}\n`;
    }
  }

  md += `\n## Governance Rules (${a.governanceRules.length})\n\n`;
  const byCategory: Record<string, typeof a.governanceRules> = {};
  for (const rule of a.governanceRules) {
    if (!byCategory[rule.category]) byCategory[rule.category] = [];
    byCategory[rule.category].push(rule);
  }
  for (const [cat, rules] of Object.entries(byCategory)) {
    md += `### ${cat}\n`;
    for (const rule of rules) {
      md += `- **${rule.name}** (priority: ${rule.priority}): ${rule.description}\n`;
    }
    md += `\n`;
  }

  if (a.knowledgeTopics.length > 0) {
    md += `## Knowledge Domains\n\n`;
    for (const topic of a.knowledgeTopics) {
      md += `- ${topic}\n`;
    }
  }

  md += `\n---\n*Format: ${exported.format}*\n`;
  return md;
}

import { db } from "./db";
import { messages, conversations, personas } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getClientForModel } from "./providers";
import { storage } from "./storage";

interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
}

interface DelegationStep {
  targetAgent: string;
  taskName: string;
}

interface ConversationAnalysis {
  toolSequence: ToolCall[];
  delegations: DelegationStep[];
  userCorrections: string[];
  totalMessages: number;
  personaName: string;
  conversationTitle: string;
}

interface SkillDefinition {
  name: string;
  description: string;
  steps: string[];
  requiredTools: string[];
  requiredPersonas: string[];
  successCriteria: string[];
  promptContent: string;
}

function parseToolMetadata(content: string): ToolCall[] {
  const match = content.match(/^\s*<!-- tools:([\s\S]*?) -->/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t: { name?: string }) => t.name && typeof t.name === "string")
      .map((t: { name: string; input?: Record<string, unknown> }) => ({
        name: t.name,
        input: t.input,
      }));
  } catch {
    return [];
  }
}

function extractDelegationsFromTools(tools: ToolCall[]): DelegationStep[] {
  const delegations: DelegationStep[] = [];
  for (const t of tools) {
    if (t.name === "delegate_task" && t.input) {
      const targetAgent = String(t.input.targetAgent || "");
      const taskName = String(t.input.taskName || t.input.description || "");
      if (targetAgent) {
        delegations.push({ targetAgent, taskName });
      }
    }
  }
  return delegations;
}

function extractUserCorrections(msgs: { role: string; content: string }[]): string[] {
  const corrections: string[] = [];
  const correctionPattern = /\b(no|wrong|incorrect|fix|change|instead|actually|not what|redo|try again|different)\b/i;

  for (const m of msgs) {
    if (m.role === "user" && correctionPattern.test(m.content)) {
      corrections.push(m.content.slice(0, 200));
    }
  }

  return corrections;
}

async function analyzeConversation(conversationId: number, tenantId: number): Promise<ConversationAnalysis> {
  const conv = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv.length) throw new Error(`Conversation ${conversationId} not found`);

  if (conv[0].tenantId !== tenantId) {
    throw new Error("Access denied: conversation belongs to a different tenant");
  }

  const msgs = await db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  const orderedTools: ToolCall[] = [];
  const allDelegations: DelegationStep[] = [];

  for (const m of msgs) {
    if (m.role === "assistant") {
      const tools = parseToolMetadata(m.content);
      orderedTools.push(...tools);
      allDelegations.push(...extractDelegationsFromTools(tools));
    }
  }

  const userCorrections = extractUserCorrections(msgs.map(m => ({ role: m.role, content: m.content })));

  let personaName = "VisionClaw";
  if (conv[0].personaId) {
    try {
      const personaRows = await db.select({ name: personas.name })
        .from(personas)
        .where(eq(personas.id, conv[0].personaId))
        .limit(1);
      if (personaRows[0]?.name) {
        personaName = personaRows[0].name;
      }
    } catch {}
  }

  return {
    toolSequence: orderedTools,
    delegations: allDelegations,
    userCorrections,
    totalMessages: msgs.length,
    personaName,
    conversationTitle: conv[0].title,
  };
}

const SKILLIFY_PROMPT = `You are a skill extraction engine for an AI agent platform. Analyze the conversation summary below and produce a reusable skill definition.

A skill is a set of instructions that teaches an AI agent how to reliably complete a specific type of task. It includes:
- A clear name and description
- Step-by-step instructions
- Which tools to use and when
- Which specialist agents to delegate to
- Success criteria

Rules:
- Steps should be concrete and actionable, not vague
- Include error handling guidance ("if X fails, try Y")
- Reference specific tool names the agent should use
- If user corrections were made, incorporate the corrected approach
- Success criteria should be measurable or verifiable
- The promptContent should be the full instruction set, written as if speaking to the agent

Respond with ONLY valid JSON:
{
  "name": "skill_name_here",
  "description": "One-line description",
  "steps": ["Step 1: ...", "Step 2: ..."],
  "requiredTools": ["tool_name_1", "tool_name_2"],
  "requiredPersonas": ["Persona Name"],
  "successCriteria": ["Criterion 1", "Criterion 2"],
  "promptContent": "Full instruction text for the agent..."
}`;

export async function skillifyConversation(
  conversationId: number,
  tenantId: number,
  suggestedName?: string,
  personaId?: number | null,
): Promise<{ skill?: { id: number; name: string; description: string }; error?: string }> {
  try {
    const analysis = await analyzeConversation(conversationId, tenantId);

    if (analysis.totalMessages < 4) {
      return { error: "Conversation is too short to extract a meaningful skill. Need at least 4 messages." };
    }

    const uniqueTools = [...new Set(analysis.toolSequence.map(t => t.name))];
    const orderedToolNames = analysis.toolSequence.map(t => t.name);
    const uniquePersonas = [...new Set(analysis.delegations.map(d => d.targetAgent))];

    const summaryForLLM = `Conversation: "${analysis.conversationTitle}"
Lead Agent: ${analysis.personaName}
Total messages: ${analysis.totalMessages}
Tool execution sequence (${orderedToolNames.length} calls): ${orderedToolNames.join(" → ") || "none detected"}
Unique tools (${uniqueTools.length}): ${uniqueTools.join(", ") || "none"}
Delegations (${analysis.delegations.length}): ${analysis.delegations.map(d => `${d.targetAgent}: ${d.taskName}`).join("; ") || "none"}
Agents involved: ${[analysis.personaName, ...uniquePersonas].join(", ")}
User corrections (${analysis.userCorrections.length}): ${analysis.userCorrections.join(" | ") || "none"}
${suggestedName ? `Suggested skill name: "${suggestedName}"` : ""}

Recent conversation excerpt (last messages):`;

    const recentMsgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);

    const excerpt = recentMsgs.reverse().map(m => {
      const clean = m.content.replace(/^<!-- tools:[\s\S]*? -->\n?/, "").trim();
      return `[${m.role}]: ${clean.slice(0, 300)}`;
    }).join("\n");

    const { client, actualModelId } = await getClientForModel("gpt-4.1");

    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: SKILLIFY_PROMPT },
        { role: "user", content: `${summaryForLLM}\n${excerpt}` },
      ],
      max_completion_tokens: 2000,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "Could not parse skill definition from LLM response" };
    }

    const skillDef: SkillDefinition = JSON.parse(jsonMatch[0]);

    if (!skillDef.name || !skillDef.description || !skillDef.promptContent) {
      return { error: "LLM produced incomplete skill definition (missing name, description, or promptContent)" };
    }

    const skillName = suggestedName || skillDef.name;

    const stepsSection = skillDef.steps?.length
      ? `\n\nSTEPS:\n${skillDef.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "";
    const toolsSection = skillDef.requiredTools?.length
      ? `\n\nREQUIRED TOOLS: ${skillDef.requiredTools.join(", ")}`
      : "";
    const personasSection = skillDef.requiredPersonas?.length
      ? `\n\nDELEGATE TO: ${skillDef.requiredPersonas.join(", ")}`
      : "";
    const criteriaSection = skillDef.successCriteria?.length
      ? `\n\nSUCCESS CRITERIA:\n${skillDef.successCriteria.map(c => `- ${c}`).join("\n")}`
      : "";

    const fullPromptContent = `${skillDef.promptContent}${stepsSection}${toolsSection}${personasSection}${criteriaSection}`;

    const created = await storage.createSkill({
      name: skillName,
      description: skillDef.description,
      promptContent: fullPromptContent,
      category: "learned",
      icon: "GraduationCap",
      enabled: true,
      personaId: personaId ?? null,
    });

    import("./persona-sync").then(m => m.syncPersonaDocs()).catch(e =>
      console.error("[skillify] Persona sync after skill creation failed:", e.message)
    );

    console.log(`[skillify] Created skill "${skillName}" (ID ${created.id}) from conversation ${conversationId} — ${orderedToolNames.length} tool calls, ${uniquePersonas.length} delegations`);

    return {
      skill: {
        id: created.id,
        name: created.name,
        description: created.description,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[skillify] Failed:`, message);
    return { error: `Skill extraction failed: ${message}` };
  }
}

export function parseToolsFromMessage(content: string): ToolCall[] {
  return parseToolMetadata(content);
}

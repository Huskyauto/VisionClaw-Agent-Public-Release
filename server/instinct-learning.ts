import { storage } from "./storage";

interface ToolExecution {
  name: string;
  input: any;
  output: any;
}

interface InstinctEntry {
  patternId: string;
  tenantId: number;
  personaId: number;
  trigger: string;
  toolSequence: string[];
  delegationChain: string[];
  confidence: number;
  observations: number;
  lastSuccess: number;
  graduated: boolean;
}

const CONFIDENCE_THRESHOLD = 0.7;
const MIN_OBSERVATIONS_TO_GRADUATE = 3;
const TOOL_SEQUENCE_LIMIT = 8;
const INSTINCT_PREFIX = "[INSTINCT]";

function classifyRequestType(content: string): string {
  const patterns: [RegExp, string][] = [
    [/\b(research|analyze|investigate|find out|look into|compare)\b/i, "research"],
    [/\b(write|draft|create|compose|generate)\b.*\b(report|document|article|summary|brief|post)\b/i, "content-creation"],
    [/\b(presentation|slide|deck|pptx|keynote)\b/i, "presentation"],
    [/\b(email|send|notify|message)\b/i, "communication"],
    [/\b(code|build|implement|fix|debug|deploy)\b/i, "engineering"],
    [/\b(chart|graph|dashboard|visualiz|diagram)\b/i, "visualization"],
    [/\b(stock|market|financ|invest|portfolio|trade)\b/i, "finance"],
    [/\b(schedule|automate|recurring|heartbeat|monitor)\b/i, "automation"],
    [/\b(image|photo|design|brand|logo|creative)\b/i, "creative"],
    [/\b(video|audio|tts|narrat|voice)\b/i, "media-production"],
  ];

  for (const [regex, type] of patterns) {
    if (regex.test(content)) return type;
  }
  return "general";
}

function buildPatternId(requestType: string, toolSequence: string[]): string {
  const toolSig = toolSequence.slice(0, TOOL_SEQUENCE_LIMIT).join("+");
  return `${requestType}:${toolSig}`;
}

function extractDelegationChain(tools: ToolExecution[]): string[] {
  const chain: string[] = [];
  for (const t of tools) {
    if (t.name === "delegate_task" && t.input?.targetAgent) {
      chain.push(t.input.targetAgent);
    }
  }
  return chain;
}

async function findExistingInstinct(tenantId: number, personaId: number, patternId: string): Promise<{ id: number; entry: InstinctEntry } | null> {
  const result = await storage.getMemoryEntries(personaId, 200, 0, tenantId);
  for (const m of result.data) {
    if (m.category === "instinct" && m.fact.startsWith(INSTINCT_PREFIX)) {
      try {
        const data: InstinctEntry = JSON.parse(m.fact.slice(INSTINCT_PREFIX.length));
        if (data.patternId === patternId) {
          return { id: m.id, entry: data };
        }
      } catch {}
    }
  }
  return null;
}

function serializeInstinct(entry: InstinctEntry): string {
  return INSTINCT_PREFIX + JSON.stringify(entry);
}

async function learnFromCompletion(
  tenantId: number,
  personaId: number,
  userMessage: string,
  executedTools: ToolExecution[],
  success: boolean
): Promise<{ learned: boolean; patternId?: string; graduated?: boolean }> {
  if (!success || executedTools.length < 2) {
    return { learned: false };
  }

  const requestType = classifyRequestType(userMessage);
  const toolSequence = executedTools.map(t => t.name);
  const delegationChain = extractDelegationChain(executedTools);
  const patternId = buildPatternId(requestType, toolSequence);

  try {
    const existing = await findExistingInstinct(tenantId, personaId, patternId);

    if (existing) {
      const newObservations = existing.entry.observations + 1;
      const newConfidence = Math.min(0.95, existing.entry.confidence + (1 - existing.entry.confidence) * 0.15);
      const shouldGraduate = !existing.entry.graduated &&
        newConfidence >= CONFIDENCE_THRESHOLD &&
        newObservations >= MIN_OBSERVATIONS_TO_GRADUATE;

      const updated: InstinctEntry = {
        ...existing.entry,
        confidence: newConfidence,
        observations: newObservations,
        lastSuccess: Date.now(),
        graduated: shouldGraduate || existing.entry.graduated,
      };

      await storage.updateMemoryEntry(existing.id, {
        fact: serializeInstinct(updated),
      });

      if (shouldGraduate) {
        await graduateToKnowledge(tenantId, personaId, requestType, toolSequence, delegationChain, newConfidence);
        console.log(`[instinct] Graduated pattern ${patternId} (confidence: ${newConfidence.toFixed(2)}, observations: ${newObservations})`);
      } else {
        console.log(`[instinct] Reinforced pattern ${patternId} (confidence: ${newConfidence.toFixed(2)}, observations: ${newObservations})`);
      }

      return { learned: true, patternId, graduated: shouldGraduate };
    }

    const entry: InstinctEntry = {
      patternId,
      tenantId,
      personaId,
      trigger: requestType,
      toolSequence: toolSequence.slice(0, TOOL_SEQUENCE_LIMIT),
      delegationChain,
      confidence: 0.3,
      observations: 1,
      lastSuccess: Date.now(),
      graduated: false,
    };

    await storage.createMemoryEntry({
      tenantId,
      personaId,
      category: "instinct",
      fact: serializeInstinct(entry),
      source: "instinct-learning",
    });

    console.log(`[instinct] New pattern learned: ${patternId} (${toolSequence.length} tools, ${delegationChain.length} delegations)`);
    return { learned: true, patternId };
  } catch (err: any) {
    console.warn(`[instinct] Learning failed: ${err.message}`);
    return { learned: false };
  }
}

async function graduateToKnowledge(
  tenantId: number,
  personaId: number,
  requestType: string,
  toolSequence: string[],
  delegationChain: string[],
  confidence: number
) {
  const toolDesc = toolSequence.join(" → ");
  const delegationDesc = delegationChain.length > 0
    ? `\nDelegation chain: ${delegationChain.join(" → ")}`
    : "";

  const knowledgeContent = `Learned execution pattern for "${requestType}" tasks:
Tool sequence: ${toolDesc}${delegationDesc}
Confidence: ${(confidence * 100).toFixed(0)}%
This pattern has been verified through multiple successful executions and represents a reliable approach for this type of request.`;

  try {
    await storage.createKnowledge({
      tenantId,
      personaId,
      title: `Execution Pattern: ${requestType}`,
      content: knowledgeContent,
      category: "learned-pattern",
      source: "instinct-graduation",
    });
    console.log(`[instinct] Graduated to knowledge: "${requestType}" pattern for persona ${personaId}`);
  } catch (err: any) {
    console.warn(`[instinct] Knowledge graduation failed: ${err.message}`);
  }
}

async function getRelevantInstincts(tenantId: number, personaId: number, userMessage: string): Promise<string | null> {
  const requestType = classifyRequestType(userMessage);
  try {
    const result = await storage.getMemoryEntries(personaId, 100, 0, tenantId);
    const instincts: InstinctEntry[] = [];

    for (const m of result.data) {
      if (m.category === "instinct" && m.fact.startsWith(INSTINCT_PREFIX)) {
        try {
          const data: InstinctEntry = JSON.parse(m.fact.slice(INSTINCT_PREFIX.length));
          if (data.graduated && data.trigger === requestType) {
            instincts.push(data);
          }
        } catch {}
      }
    }

    if (instincts.length === 0) return null;

    const best = instincts.sort((a, b) => b.confidence - a.confidence)[0];
    return `[LEARNED PATTERN] For "${best.trigger}" requests, the proven tool sequence is: ${best.toolSequence.join(" → ")}${best.delegationChain.length > 0 ? `. Delegate to: ${best.delegationChain.join(", ")}` : ""}. Confidence: ${(best.confidence * 100).toFixed(0)}%. Use this approach unless the request requires something different.`;
  } catch {
    return null;
  }
}

export {
  learnFromCompletion,
  getRelevantInstincts,
  classifyRequestType,
  InstinctEntry,
};

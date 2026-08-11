import { db } from "./db";
import { sql } from "drizzle-orm";
import { getProtocolLimit } from "./auto-tuner";

import { logSilentCatch } from "./lib/silent-catch";
export type DecisionComplexity = "simple" | "moderate" | "complex" | "ambiguous" | "strategic";
export type ProtocolType = "direct_delegation" | "specialist_critique" | "chain_of_debates" | "tree_of_thought" | "full_council";

export interface ProtocolConfig {
  type: ProtocolType;
  description: string;
  typicalCost: string;
  maxPerDay: number;
  participants?: number[];
}

const PROTOCOL_MAP: Record<DecisionComplexity, ProtocolConfig> = {
  simple: { type: "direct_delegation", description: "One specialist handles it", typicalCost: "1 LLM call", maxPerDay: -1 },
  moderate: { type: "specialist_critique", description: "Specialist produces + critique evaluates", typicalCost: "2 LLM calls", maxPerDay: -1 },
  complex: { type: "chain_of_debates", description: "3-4 specialists argue perspectives, synthesis produced", typicalCost: "4-6 LLM calls", maxPerDay: 5 },
  ambiguous: { type: "tree_of_thought", description: "3 distinct reasoning paths explored, best selected", typicalCost: "3-5 LLM calls", maxPerDay: 5 },
  strategic: { type: "full_council", description: "ToT → Debate → Critique → Cost estimate → Full recommendation", typicalCost: "10-15 LLM calls", maxPerDay: 2 },
};

const PARTICIPANT_DOMAINS: Record<string, number[]> = {
  product_strategy: [3, 11, 9, 13],
  financial_decision: [13, 11, 12, 14],
  marketing_strategy: [4, 11, 9, 7],
  legal_compliance: [14, 13, 3, 2],
  technical_architecture: [3, 6, 9, 12],
  hiring_team: [2, 13, 14],
};

const dailyProtocolUsage = new Map<string, { debate: number; tree_of_thought: number; full_council: number; date: string }>();

function cleanupDailyUsage() {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, val] of dailyProtocolUsage) {
    if (val.date !== today) dailyProtocolUsage.delete(key);
  }
}

export function classifyComplexity(
  description: string,
  domainCount: number = 1,
  riskLevel: string = "low"
): DecisionComplexity {
  const lowRisk = riskLevel === "low";
  const highRisk = riskLevel === "high" || riskLevel === "critical";

  if (domainCount >= 3 && highRisk) return "strategic";
  if (domainCount >= 3) return "complex";

  const ambiguousKeywords = ["how should", "best approach", "which way", "options for", "alternatives", "compare", "trade-off", "pros and cons"];
  const strategicKeywords = ["long-term", "irreversible", "major decision", "company direction", "pivot", "exit", "acquisition", "fundrais"];
  const complexKeywords = ["evaluate", "multi-factor", "competing", "stakeholder", "cross-functional"];

  const lower = description.toLowerCase();
  if (strategicKeywords.some(k => lower.includes(k))) return "strategic";
  if (complexKeywords.some(k => lower.includes(k)) || (domainCount >= 2 && highRisk)) return "complex";
  if (ambiguousKeywords.some(k => lower.includes(k))) return "ambiguous";
  if (!lowRisk || domainCount >= 2) return "moderate";
  return "simple";
}

export function getProtocol(complexity: DecisionComplexity): ProtocolConfig {
  return PROTOCOL_MAP[complexity];
}

export function getParticipants(domain: string): number[] {
  return PARTICIPANT_DOMAINS[domain] || PARTICIPANT_DOMAINS.product_strategy;
}

export function detectDomain(description: string): string {
  const lower = description.toLowerCase();
  if (/price|revenue|cost|budget|financial|invest|fund/.test(lower)) return "financial_decision";
  if (/market|brand|campaign|social|seo|content strategy/.test(lower)) return "marketing_strategy";
  if (/legal|compliance|contract|regulation|privacy|gdpr/.test(lower)) return "legal_compliance";
  if (/architect|infrastructure|api|system design|tech stack/.test(lower)) return "technical_architecture";
  if (/hire|team|role|culture|onboard/.test(lower)) return "hiring_team";
  return "product_strategy";
}

export async function canUseProtocol(tenantId: number, protocol: ProtocolType): Promise<{ allowed: boolean; reason?: string }> {
  if (protocol === "direct_delegation" || protocol === "specialist_critique") return { allowed: true };

  const today = new Date().toISOString().split("T")[0];
  const key = `${tenantId}:${today}`;
  const usage = dailyProtocolUsage.get(key) || { debate: 0, tree_of_thought: 0, full_council: 0, date: today };

  if (usage.date !== today) {
    dailyProtocolUsage.set(key, { debate: 0, tree_of_thought: 0, full_council: 0, date: today });
    return { allowed: true };
  }

  let limits: Record<string, number> = { chain_of_debates: 5, tree_of_thought: 5, full_council: 2 };
  try { limits = { chain_of_debates: getProtocolLimit("chain_of_debates"), tree_of_thought: getProtocolLimit("tree_of_thought"), full_council: getProtocolLimit("full_council") }; } catch (_silentErr) { logSilentCatch("server/collective-intelligence.ts", _silentErr); }
  const usageKey = protocol === "chain_of_debates" ? "debate" : protocol === "tree_of_thought" ? "tree_of_thought" : "full_council";
  const current = usage[usageKey as keyof typeof usage] as number;
  const limit = limits[protocol] || 5;

  if (current >= limit) return { allowed: false, reason: `Daily ${protocol} limit reached (${current}/${limit})` };

  try {
    const { evalDailySpend } = await import("./evaluators");
    const spend = await evalDailySpend(tenantId);
    if (spend.metrics.spend_percent >= 80 && (protocol as any) !== "specialist_critique") {
      return { allowed: false, reason: "Token budget ≥ 80%. Only Specialist + Critique available." };
    }
  } catch (_silentErr) { logSilentCatch("server/collective-intelligence.ts", _silentErr); }

  return { allowed: true };
}

export function recordProtocolUsage(tenantId: number, protocol: ProtocolType) {
  cleanupDailyUsage();
  const today = new Date().toISOString().split("T")[0];
  const key = `${tenantId}:${today}`;
  const usage = dailyProtocolUsage.get(key) || { debate: 0, tree_of_thought: 0, full_council: 0, date: today };
  if (protocol === "chain_of_debates") usage.debate++;
  else if (protocol === "tree_of_thought") usage.tree_of_thought++;
  else if (protocol === "full_council") usage.full_council++;
  dailyProtocolUsage.set(key, usage);
}

export function getProtocolUsage(tenantId: number): { debate: number; tree_of_thought: number; full_council: number } {
  const today = new Date().toISOString().split("T")[0];
  const key = `${tenantId}:${today}`;
  return dailyProtocolUsage.get(key) || { debate: 0, tree_of_thought: 0, full_council: 0 };
}

export function buildProtocolPrompt(complexity: DecisionComplexity, domain: string, question: string): string {
  const protocol = PROTOCOL_MAP[complexity];
  const participants = getParticipants(domain);

  switch (protocol.type) {
    case "direct_delegation":
      return "";

    case "specialist_critique":
      return `REASONING PROTOCOL: Specialist + Critique
1. Delegate to specialist → get answer
2. Use critique_response to evaluate (threshold: 7/10)
3. If ≥ 7: deliver. If < 7: return to specialist with feedback.`;

    case "chain_of_debates":
      return `REASONING PROTOCOL: Chain of Debates
Use debate tool with this question: "${question}"
Participants: ${participants.length} specialists (persona IDs: ${participants.join(", ")})
Synthesize all perspectives. Note consensus level. Present recommendation with dissenting views.`;

    case "tree_of_thought":
      return `REASONING PROTOCOL: Tree of Thought
Use tree_of_thought tool: 3 reasoning branches for "${question}"
Score each on: soundness, completeness, feasibility.
Select best path or synthesize hybrid. Present recommended approach with alternatives.`;

    case "full_council":
      return `REASONING PROTOCOL: Full Council (Strategic Decision)
Step 1: tree_of_thought — generate 3 approaches to "${question}"
Step 2: debate — multi-perspective analysis of best approach (persona IDs: ${participants.join(", ")})
Step 3: critique_response — quality check synthesis
Step 4: estimate_cost — resource assessment for implementation
Present: Recommended approach, alternatives, multi-perspective analysis, cost estimate, risk assessment.`;
  }
}

export function getCollectiveIntelligenceContext(): string {
  return `DECISION COMPLEXITY ROUTING:
- Simple (single domain, clear answer): Direct delegation
- Moderate (needs analysis): Specialist + critique_response (≥7/10 to ship)
- Complex (multi-domain, competing factors): debate tool with 3-4 specialists
- Ambiguous (multiple valid approaches): tree_of_thought with 3 branches
- Strategic (long-term, irreversible): Full Council (ToT → Debate → Critique → Cost)`;
}

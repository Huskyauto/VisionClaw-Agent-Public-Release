import { storage } from "./storage";
import { replitOpenai, getClientForModel } from "./providers";

export interface DebatePosition {
  personaId: number;
  personaName: string;
  role: string;
  perspective: string;
  keyPoints: string[];
  recommendation: string;
  confidence: number;
}

export interface DebateResult {
  question: string;
  participants: DebatePosition[];
  synthesis: string;
  finalRecommendation: string;
  consensusLevel: "unanimous" | "strong" | "moderate" | "divided";
  dissents: string[];
}

const PERSONA_DEBATE_PROMPT = `You are {NAME}, the {ROLE}. You are participating in a corporate deliberation on an important question.

Your specialty: {SPECIALTY}

Analyze the question from YOUR unique perspective and expertise. Be opinionated — argue for what you believe is best based on your role.

Respond in JSON:
{
  "perspective": "Your 2-3 sentence analysis from your role's viewpoint",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "recommendation": "Your specific recommendation in 1-2 sentences",
  "confidence": <1-10 how confident you are>
}`;

const SYNTHESIS_PROMPT = `You are the sovereign AI orchestrator. Your executive team has debated a question and provided their individual positions.

Your job: synthesize all perspectives into a final executive decision. Consider each persona's expertise and confidence level. Identify areas of agreement and disagreement.

Output JSON:
{
  "synthesis": "A comprehensive 3-5 sentence synthesis of all perspectives",
  "finalRecommendation": "The definitive recommendation incorporating the strongest arguments",
  "consensusLevel": "unanimous|strong|moderate|divided",
  "dissents": ["any notable disagreements that should be flagged"]
}`;

const ROLE_RELEVANCE: Record<string, string[]> = {
  financial: ["Cassandra", "Apollo", "Felix"],
  legal: ["Luna", "Felix", "Cassandra"],
  technical: ["Forge", "Blueprint", "Atlas"],
  marketing: ["Teagan", "Scribe", "Apollo"],
  strategic: ["Felix", "Chief of Staff", "Radar"],
  research: ["Neptune", "Radar", "Atlas"],
  operations: ["Chief of Staff", "Blueprint", "Forge"],
  content: ["Scribe", "Teagan", "Proof"],
  risk: ["Luna", "Cassandra", "Proof"],
  data: ["Atlas", "Neptune", "Forge"],
  revenue: ["Apollo", "Cassandra", "Teagan"],
  quality: ["Proof", "Scribe", "Luna"],
};

function selectDebaters(question: string, allPersonas: any[], count: number = 4): any[] {
  const q = question.toLowerCase();
  let bestCategory = "strategic";
  let bestScore = 0;

  for (const [category, _] of Object.entries(ROLE_RELEVANCE)) {
    const keywords: Record<string, string[]> = {
      financial: ["money", "cost", "budget", "revenue", "profit", "price", "invest", "financial", "expense", "roi"],
      legal: ["legal", "contract", "compliance", "regulation", "law", "policy", "liability", "terms", "privacy", "gdpr"],
      technical: ["code", "build", "deploy", "architecture", "api", "database", "server", "technical", "engineer", "infrastructure"],
      marketing: ["marketing", "brand", "campaign", "audience", "social media", "content", "seo", "growth", "launch"],
      strategic: ["strategy", "plan", "direction", "future", "decision", "should we", "approach", "priority"],
      research: ["research", "analyze", "study", "data", "report", "findings", "investigation", "trend"],
      operations: ["process", "workflow", "efficiency", "scale", "team", "manage", "operations", "coordinate"],
      content: ["write", "blog", "article", "copy", "publish", "newsletter", "editorial"],
      risk: ["risk", "danger", "threat", "vulnerability", "exposure", "audit", "compliance"],
      data: ["metrics", "analytics", "dashboard", "kpi", "measure", "track", "performance"],
      revenue: ["sales", "pipeline", "deal", "client", "customer", "subscription", "pricing"],
      quality: ["quality", "review", "check", "test", "standard", "verify", "approve"],
    };

    const categoryKeywords = keywords[category] || [];
    const score = categoryKeywords.filter(kw => q.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  const preferredNames = ROLE_RELEVANCE[bestCategory] || ROLE_RELEVANCE.strategic;
  const selected: any[] = [];

  for (const name of preferredNames) {
    const persona = allPersonas.find(p => p.name === name);
    if (persona && selected.length < count) {
      selected.push(persona);
    }
  }

  if (selected.length < count) {
    for (const p of allPersonas) {
      if (!selected.find(s => s.id === p.id) && p.name !== "VisionClaw" && selected.length < count) {
        selected.push(p);
      }
    }
  }

  return selected.slice(0, count);
}

export async function runDebate(
  question: string,
  tenantId: number,
  participantCount: number = 4
): Promise<DebateResult> {
  // R74.13f fail-closed: removed `tenantId: number = 1` default. Sole
  // caller (server/tools.ts:8711 run_debate tool) passes _tenantId
  // explicitly. Default was dead code masking the real bug.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`runDebate requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  const allPersonas = await storage.getPersonas();

  const debaters = selectDebaters(question, allPersonas, participantCount);

  console.log(`[debate] Starting debate: "${question.slice(0, 80)}..." with ${debaters.map(d => d.name).join(", ")}`);

  const positionPromises = debaters.map(async (persona): Promise<DebatePosition> => {
    const prompt = PERSONA_DEBATE_PROMPT
      .replace("{NAME}", persona.name)
      .replace("{ROLE}", persona.role || "Team Member")
      .replace("{SPECIALTY}", persona.instructions?.slice(0, 200) || persona.role || "General");

    try {
      const resp = await replitOpenai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Deliberation question: "${question}"` },
        ],
        max_completion_tokens: 400,
        response_format: { type: "json_object" },
      });

      const content = resp.choices[0]?.message?.content;
      const parsed = content ? JSON.parse(content) : {};

      const rawConf = Number(parsed.confidence);
      const confidence = isNaN(rawConf) ? 5 : Math.max(1, Math.min(10, rawConf));

      return {
        personaId: persona.id,
        personaName: persona.name,
        role: persona.role || "Team Member",
        perspective: typeof parsed.perspective === "string" ? parsed.perspective : "No perspective provided",
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((k: any) => typeof k === "string") : [],
        recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : "No recommendation",
        confidence,
      };
    } catch (err) {
      console.log(`[debate] ${persona.name} failed to respond: ${(err as Error).message}`);
      return {
        personaId: persona.id,
        personaName: persona.name,
        role: persona.role || "Team Member",
        perspective: "Unable to provide perspective due to processing error",
        keyPoints: [],
        recommendation: "Abstain",
        confidence: 1,
      };
    }
  });

  const positions = await Promise.all(positionPromises);

  const positionsSummary = positions.map(p =>
    `**${p.personaName}** (${p.role}, confidence: ${p.confidence}/10):\n- Perspective: ${p.perspective}\n- Key Points: ${p.keyPoints.join("; ")}\n- Recommendation: ${p.recommendation}`
  ).join("\n\n");

  try {
    const synthResp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYNTHESIS_PROMPT },
        {
          role: "user",
          content: `Question: "${question}"\n\nTeam positions:\n${positionsSummary}\n\nSynthesize the final decision:`,
        },
      ],
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
    });

    const synthContent = synthResp.choices[0]?.message?.content;
    const synth = synthContent ? JSON.parse(synthContent) : {};

    const consensusLevels = ["unanimous", "strong", "moderate", "divided"] as const;
    const consensusLevel = consensusLevels.includes(synth.consensusLevel) ? synth.consensusLevel : "moderate";

    console.log(`[debate] Complete. Consensus: ${consensusLevel}. Participants: ${positions.length}`);

    return {
      question,
      participants: positions,
      synthesis: synth.synthesis || "Synthesis unavailable",
      finalRecommendation: synth.finalRecommendation || "No consensus reached",
      consensusLevel,
      dissents: Array.isArray(synth.dissents) ? synth.dissents : [],
    };
  } catch (err) {
    console.log(`[debate] Synthesis failed: ${(err as Error).message}`);
    return {
      question,
      participants: positions,
      synthesis: "Synthesis failed — individual positions are available above",
      finalRecommendation: positions.sort((a, b) => b.confidence - a.confidence)[0]?.recommendation || "No recommendation",
      consensusLevel: "divided",
      dissents: ["Synthesis agent was unable to process all perspectives"],
    };
  }
}

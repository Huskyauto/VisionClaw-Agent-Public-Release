import { getClientForModel } from "./providers";
import { logSilentCatch } from "./lib/silent-catch";

export type RequestClass =
  | "research"
  | "content-creation"
  | "media-production"
  | "outreach"
  | "sales"
  | "data-query"
  | "engineering"
  | "finance"
  | "legal"
  | "admin"
  | "open-ended";

export interface EarlyCommitment {
  requestClass: RequestClass;
  confidence: number;
  allowedSkillTypes: string[];
  escapeHatch: boolean;
  reason: string;
}

// R125+13.17+sec — exported so plan-replay can incorporate a stable hash of
// this mapping into its cache key. When the mapping changes (new class, new
// allowed skill type), old cached plans MUST NOT replay onto the new regime —
// they were narrowed for a different toolChain surface and would be wrong.
export const CLASS_TO_SKILL_TYPES: Record<RequestClass, string[]> = {
  "research": ["Research", "Analysis", "Competitive Intelligence"],
  "content-creation": ["Writing", "Design", "Slides", "Presentation", "PDF", "Document", "Marketing"],
  "media-production": ["Slides", "Presentation", "Design", "Engineering"],
  "outreach": ["Outreach", "Marketing", "Sales", "Email", "Lead Enrichment"],
  "sales": ["Sales", "Lead Enrichment", "Outreach", "Email"],
  "data-query": ["Research", "Analysis", "Finance"],
  "engineering": ["Engineering", "Research"],
  "finance": ["Finance", "Analysis"],
  "legal": ["Legal", "Document", "PDF"],
  "admin": ["General", "Document", "Email"],
  "open-ended": [],
};

const CLASSIFIER_PROMPT = `You are the Early Commitment classifier for VisionClaw's orchestrator. Your job is to classify the user's objective into ONE request class so the planner can constrain its tool surface and avoid expensive open-ended exploration on routine work.

This is a cost optimization. Be confident on routine work. Be honest when the request genuinely needs cross-class exploration — in that case return "open-ended" and let the orchestrator fall back to the full tool surface.

Available classes:
- "research" — gather/synthesize external information (web research, competitor scans, market study)
- "content-creation" — produce written/designed deliverables (blog posts, articles, slides, decks, PDFs, reports, newsletters, marketing copy)
- "media-production" — produce audio/video/image media (YouTube videos, narrated slides, ad creatives, infographics)
- "outreach" — send messages to external parties (email campaigns, drip sequences, cold outreach)
- "sales" — pipeline work (lead enrichment, ICP definition, lead scoring, follow-up sequences)
- "data-query" — answer factual questions from internal data (CRM lookups, financial snapshots, KPI reads)
- "engineering" — code, scripts, debugging, deployment, infra
- "finance" — financial analysis, budgeting, expense work, P&L
- "legal" — contracts, compliance reviews, legal documents
- "admin" — small one-off ops (file moves, calendar, simple notes)
- "open-ended" — genuinely spans multiple classes OR is novel/edge-case OR the user is exploring; planner should see the FULL tool surface

Default to "open-ended" when uncertain. False narrowing breaks edge cases; false widening just costs more tokens.

Respond with ONLY valid JSON:
{
  "requestClass": "<one of the classes above>",
  "confidence": 0.0-1.0,
  "reason": "one-sentence justification"
}`;

export async function classifyForEarlyCommitment(
  objective: string,
  tenantId: number,
): Promise<EarlyCommitment> {
  try {
    const { client, actualModelId } = await getClientForModel("openai/gpt-4.1-mini", tenantId, {});

    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: `Objective:\n${objective}` },
      ],
      max_completion_tokens: 200,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return openEnded("classifier returned no parseable JSON");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const requestClass = (parsed.requestClass || "open-ended") as RequestClass;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reason = parsed.reason || "(no reason given)";

    if (!(requestClass in CLASS_TO_SKILL_TYPES)) {
      return openEnded(`unknown class "${requestClass}", falling back to open-ended`);
    }

    // Low-confidence verdicts fall back to open-ended — preserves the article's
    // point that unconstrained exploration is essential for novel edge cases.
    if (confidence < 0.6 || requestClass === "open-ended") {
      return {
        requestClass: "open-ended",
        confidence,
        allowedSkillTypes: [],
        escapeHatch: true,
        reason: `${reason} (confidence ${confidence} → escape hatch)`,
      };
    }

    return {
      requestClass,
      confidence,
      allowedSkillTypes: CLASS_TO_SKILL_TYPES[requestClass],
      escapeHatch: false,
      reason,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logSilentCatch("server/early-commitment.ts", err);
    return openEnded(`classifier error: ${message}`);
  }
}

function openEnded(reason: string): EarlyCommitment {
  return {
    requestClass: "open-ended",
    confidence: 0,
    allowedSkillTypes: [],
    escapeHatch: true,
    reason,
  };
}

export function formatCommitmentForPlanner(c: EarlyCommitment): string {
  if (c.escapeHatch) {
    return `\nEARLY COMMITMENT: open-ended (${c.reason}). Use the FULL tool surface — this request needs cross-class exploration.`;
  }
  return `\nEARLY COMMITMENT: request classified as "${c.requestClass}" (confidence ${c.confidence}).
Reason: ${c.reason}
Constrain your plan's specialist assignments to skill types: ${c.allowedSkillTypes.join(", ")}.
Avoid pulling in unrelated specialists or tools — this is a cost optimization. If the request genuinely needs a specialist outside this list, you may include one step for it, but justify why in the step description.`;
}

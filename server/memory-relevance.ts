import { replitOpenai } from "./providers";
import crypto from "crypto";

const RELEVANCE_CACHE = new Map<string, { selections: RelevanceSelection[]; ts: number }>();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_SIZE = 30;
const LLM_TIMEOUT_MS = 2000;
const MODEL = "gpt-4.1-mini";

const WARNING_KEYWORDS = /warning|gotcha|known.?issue|caveat|pitfall|bug|workaround|limitation|breaking|deprecated|caution/i;
const GENERIC_DOC_KEYWORDS = /\b(overview|introduction|getting.?started|setup|installation|reference|api.?docs?|documentation|guide|tutorial|usage|basics|quick.?start|how.?to.?use)\b/i;

export interface MemoryCandidate {
  id: number;
  title?: string;
  fact?: string;
  content?: string;
  category: string;
  similarity: number;
  priority?: number;
  createdAt?: string | Date;
  source?: string;
}

export interface RelevanceSelection {
  id: number;
  score: number;
  reason?: string;
}

export interface RelevanceContext {
  activeSkills?: string[];
  projectName?: string;
  personaName?: string;
  activeToolNames?: string[];
  isDelegation?: boolean;
}

function getCacheKey(query: string, candidateIds: number[], context: RelevanceContext): string {
  const parts = [
    query.slice(0, 200),
    candidateIds.sort().join(","),
    (context.activeSkills || []).sort().join(","),
    (context.activeToolNames || []).sort().join(","),
    context.personaName || "",
    context.projectName || "",
  ];
  const hash = crypto.createHash("md5").update(parts.join("|")).digest("hex");
  return hash;
}

function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of RELEVANCE_CACHE) {
    if (now - entry.ts > CACHE_TTL_MS) RELEVANCE_CACHE.delete(key);
  }
  if (RELEVANCE_CACHE.size > CACHE_MAX_SIZE) {
    const oldest = [...RELEVANCE_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < oldest.length - CACHE_MAX_SIZE; i++) {
      RELEVANCE_CACHE.delete(oldest[i][0]);
    }
  }
}

function getRecencyBoost(createdAt?: string | Date): number {
  if (!createdAt) return 0;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / 3600000;
  if (ageHours < 1) return 0.15;
  if (ageHours < 24) return 0.10;
  if (ageHours < 72) return 0.05;
  return 0;
}

function applySmartFiltering(
  candidates: MemoryCandidate[],
  context: RelevanceContext
): MemoryCandidate[] {
  const activeNames = [
    ...(context.activeSkills || []),
    ...(context.activeToolNames || []),
  ];

  let filtered = candidates.map(c => {
    const boost = getRecencyBoost(c.createdAt);
    return boost > 0 ? { ...c, similarity: Math.min(1, c.similarity + boost) } : c;
  });

  if (activeNames.length === 0) return filtered;
  const namesLower = new Set(activeNames.map(s => s.toLowerCase()));

  filtered = filtered.filter(c => {
    const text = `${c.title || ""} ${c.fact || ""} ${c.content || ""}`;
    const titleLower = (c.title || c.fact || "").toLowerCase();

    if (WARNING_KEYWORDS.test(text)) return true;

    for (const name of namesLower) {
      const nameInTitle = titleLower.includes(name);
      if (nameInTitle && GENERIC_DOC_KEYWORDS.test(titleLower)) {
        return false;
      }
    }

    if (context.isDelegation && GENERIC_DOC_KEYWORDS.test(titleLower) && c.similarity < 0.75) {
      return false;
    }

    return true;
  });

  filtered.sort((a, b) => b.similarity - a.similarity);
  return filtered;
}

function buildCandidateList(candidates: MemoryCandidate[]): string {
  return candidates.map((c, i) => {
    const text = c.title || c.fact || "";
    const snippet = (c.content || c.fact || "").slice(0, 120);
    const age = c.createdAt ? getAgeLabel(c.createdAt) : "unknown age";
    return `[${c.id}] "${text.slice(0, 80)}" (${c.category}, ${age}, sim=${c.similarity})\n  ${snippet}`;
  }).join("\n");
}

function getAgeLabel(date: string | Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export async function selectRelevantMemories(
  query: string,
  candidates: MemoryCandidate[],
  context: RelevanceContext = {},
  maxSelections: number = 7
): Promise<RelevanceSelection[]> {
  if (candidates.length === 0) return [];
  if (candidates.length <= maxSelections) {
    return candidates.map(c => ({ id: c.id, score: c.similarity }));
  }

  cleanCache();
  const cacheKey = getCacheKey(query, candidates.map(c => c.id), context);
  const cached = RELEVANCE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.selections;
  }

  const vectorRanked = [...candidates].sort((a, b) => b.similarity - a.similarity);

  const filtered = applySmartFiltering(candidates, context);
  if (filtered.length <= maxSelections) {
    const selections = filtered.map(c => ({ id: c.id, score: c.similarity }));
    RELEVANCE_CACHE.set(cacheKey, { selections, ts: Date.now() });
    return selections;
  }

  try {
    const selections = await llmSelectRelevant(query, filtered, context, maxSelections);
    RELEVANCE_CACHE.set(cacheKey, { selections, ts: Date.now() });
    return selections;
  } catch (err: any) {
    console.log(`[memory-relevance] LLM selection failed, falling back to pure vector ranking: ${err.message}`);
    return fallbackSelection(vectorRanked, maxSelections);
  }
}

async function llmSelectRelevant(
  query: string,
  candidates: MemoryCandidate[],
  context: RelevanceContext,
  maxSelections: number
): Promise<RelevanceSelection[]> {
  const candidateList = buildCandidateList(candidates);

  const contextParts: string[] = [];
  if (context.activeSkills?.length) contextParts.push(`Active skills: ${context.activeSkills.slice(0, 10).join(", ")}`);
  if (context.activeToolNames?.length) contextParts.push(`Active tools: ${context.activeToolNames.slice(0, 10).join(", ")}`);
  if (context.personaName) contextParts.push(`Agent: ${context.personaName}`);
  if (context.projectName) contextParts.push(`Project: ${context.projectName}`);

  const prompt = `Select the ${maxSelections} most relevant memories for this user query. Return ONLY a JSON array of objects with "id" (number), "score" (0-1 relevance), and "reason" (brief 5-10 word justification).

${contextParts.length > 0 ? "Context: " + contextParts.join("; ") + "\n" : ""}
User query: "${query.slice(0, 300)}"

Candidate memories:
${candidateList}

Rules:
- STRONGLY prefer warnings, known issues, gotchas, and caveats — these prevent mistakes
- Prefer memories from the last 24h over older ones (recency = relevance)
- Prefer memories that directly address the query's intent over tangentially related ones
- If a skill or tool is already active, skip its general docs/overview but KEEP its known issues
- During delegation, skip generic documentation entirely unless similarity > 0.8

Return JSON array only:`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await replitOpenai.chat.completions.create(
      {
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_completion_tokens: 500,
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);
    const text = response.choices?.[0]?.message?.content?.trim() || "";
    return parseSelections(text, candidates, maxSelections);
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      console.log(`[memory-relevance] LLM call timed out (${LLM_TIMEOUT_MS}ms), using vector fallback`);
    }
    throw err;
  }
}

function parseSelections(
  text: string,
  candidates: MemoryCandidate[],
  maxSelections: number
): RelevanceSelection[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("No JSON array found in LLM response");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error("Response is not an array");

  const validIds = new Set(candidates.map(c => c.id));
  const selections: RelevanceSelection[] = [];

  for (const item of parsed) {
    if (typeof item.id !== "number" || !validIds.has(item.id)) continue;
    const score = typeof item.score === "number" ? Math.min(1, Math.max(0, item.score)) : 0.5;
    const reason = typeof item.reason === "string" ? item.reason.slice(0, 80) : undefined;
    selections.push({ id: item.id, score, reason });
    if (selections.length >= maxSelections) break;
  }

  if (selections.length === 0) {
    throw new Error("LLM returned no valid selections");
  }

  selections.sort((a, b) => b.score - a.score);
  return selections;
}

function fallbackSelection(
  candidates: MemoryCandidate[],
  maxSelections: number
): RelevanceSelection[] {
  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxSelections)
    .map(c => ({ id: c.id, score: c.similarity }));
}

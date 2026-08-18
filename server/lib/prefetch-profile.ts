// Task 147 — Deterministic proactive-context (memory prefetch) classifier.
//
// Zero-Mem (arXiv:2607.29377) shows the per-turn "which memory context should
// we prefetch?" routing decision can be made deterministically from a cheap
// query profile (entities/keywords, temporal cues, question shape) instead of
// an LLM call. This module is that deterministic classifier. It emits the SAME
// decision contract as the LLM classifier in proactiveContextLoad():
//   { relevant: string[], anticipated: string[] }  (category NAMES)
//
// Invariants:
// - Pure + synchronous: no DB, no LLM, no env reads — safe on the hot turn
//   path and trivially unit-testable (tests/lib, query-free by design).
// - Fail-open like the LLM path: when nothing matches, it returns empty
//   arrays (proactiveContextLoad feeds ONLY the safe-to-skip L2-Anticipated
//   tier, so an empty verdict is always acceptable).

export interface PrefetchCategory {
  id: number;
  name: string;
  description?: string | null;
  memory_count?: number;
}

export interface PrefetchVerdict {
  relevant: string[];
  anticipated: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to", "in",
  "on", "at", "for", "with", "by", "from", "about", "as", "is", "are", "was",
  "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "its",
  "they", "them", "their", "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "whom", "how", "when", "where", "why", "can",
  "could", "should", "would", "will", "shall", "may", "might", "must", "not",
  "no", "yes", "just", "please", "ok", "okay", "hey", "hi", "hello",
  "thanks", "thank", "get", "got", "make", "let", "lets", "want", "need",
  "like", "also", "some", "any", "all", "up", "out", "into", "over", "than",
]);

// Temporal / planning cues — when present, forward-looking categories
// (goals, plans, schedule, calendar) become likely NEXT-turn references.
const TEMPORAL_CUES = [
  "today", "tomorrow", "tonight", "yesterday", "week", "month", "monday",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "schedule", "deadline", "soon", "later", "next", "upcoming", "plan",
  "planning", "remind", "reminder", "calendar", "morning", "evening",
];

const FORWARD_LOOKING_CATEGORY_HINTS = [
  "goal", "plan", "schedule", "calendar", "task", "project", "upcoming",
];

// Question-shape cues about the user themselves → identity/preference
// categories are likely relevant ("what do I usually…", "what's my…").
const SELF_REFERENCE_RE = /\b(my|mine|me|i)\b/i;
const QUESTION_RE = /\?|^\s*(what|who|when|where|why|how|which|do|does|did|is|are|can|could|should|would)\b/i;
const SELF_CATEGORY_HINTS = ["preference", "identity", "relationship"];

export function tokenizeQuery(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Naive singular/plural + suffix folding so "meetings" matches "meeting". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

function stemmedSet(tokens: string[]): Set<string> {
  return new Set(tokens.map(stem));
}

/**
 * Deterministic query-profile classifier. Same inputs the LLM classifier
 * sees (user message + category catalog), same output contract, zero tokens.
 */
export function deterministicPrefetchClassify(
  userMessage: string,
  categories: PrefetchCategory[],
  maxRelevant: number = 3,
  maxAnticipated: number = 2,
): PrefetchVerdict {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { relevant: [], anticipated: [] };
  }
  const msgTokens = tokenizeQuery(userMessage);
  const msgSet = stemmedSet(msgTokens);
  const msgLower = (userMessage || "").toLowerCase();

  const hasTemporalCue = TEMPORAL_CUES.some((c) => msgSet.has(stem(c)));
  const isSelfQuestion =
    QUESTION_RE.test(userMessage || "") && SELF_REFERENCE_RE.test(userMessage || "");

  const scored: { name: string; score: number; count: number }[] = [];

  for (const cat of categories) {
    const name = String(cat.name || "");
    if (!name) continue;
    const nameTokens = tokenizeQuery(name);
    const nameSet = stemmedSet(nameTokens);
    const descSet = stemmedSet(tokenizeQuery(String(cat.description || "")));

    let score = 0;
    // Keyword/entity overlap: category-name token hits weigh most.
    for (const t of nameSet) if (msgSet.has(t)) score += 3;
    for (const t of descSet) if (msgSet.has(t) && !nameSet.has(t)) score += 1;
    // Whole-name substring match (multi-word categories like "Tool Patterns").
    if (name.length > 3 && msgLower.includes(name.toLowerCase())) score += 4;

    const nameLower = name.toLowerCase();
    // Temporal cue → forward-looking categories get an anticipation boost.
    if (hasTemporalCue && FORWARD_LOOKING_CATEGORY_HINTS.some((h) => nameLower.includes(h))) {
      score += 2;
    }
    // Self-referential question → identity/preference categories.
    if (isSelfQuestion && SELF_CATEGORY_HINTS.some((h) => nameLower.includes(h))) {
      score += 2;
    }

    if (score > 0) {
      scored.push({ name, score, count: Number(cat.memory_count || 0) });
    }
  }

  // Deterministic order: score desc, then memory_count desc, then name asc.
  scored.sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name));

  const relevant = scored.slice(0, maxRelevant).map((s) => s.name);
  const anticipated = scored
    .slice(maxRelevant, maxRelevant + maxAnticipated)
    .map((s) => s.name);

  return { relevant, anticipated };
}

/**
 * Agreement between the two verdicts, computed on resolved category-ID sets
 * (the downstream unit that actually drives the prefetch query).
 */
export function verdictAgreement(
  llmIds: number[],
  detIds: number[],
): { exactMatch: boolean; jaccard: number; overlap: number } {
  const a = new Set(llmIds);
  const b = new Set(detIds);
  if (a.size === 0 && b.size === 0) return { exactMatch: true, jaccard: 1, overlap: 0 };
  let overlap = 0;
  a.forEach((id) => { if (b.has(id)) overlap++; });
  const union = a.size + b.size - overlap;
  return {
    exactMatch: a.size === b.size && overlap === a.size,
    jaccard: union === 0 ? 1 : overlap / union,
    overlap,
  };
}

/**
 * Rough per-call token cost of the LLM classifier this replaces (system
 * prompt + category list + message input, plus the completion cap). Used
 * only for the savings estimate in the shadow rollup — never for billing.
 */
export function estimateClassifierTokens(userMessage: string, categoryListLength: number): number {
  const promptChars = 420 + categoryListLength + (userMessage || "").length;
  return Math.ceil(promptChars / 4) + 120; // 120 = max_completion_tokens cap
}

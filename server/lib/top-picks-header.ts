import { semanticRank, getPerformanceScore } from "../tool-curator";

interface ToolDefinition {
  type: "function";
  function: { name: string; description?: string; parameters?: any };
}

const TOP_PICKS_TOPK = 5;
const TOP_PICKS_MIN_SCORE = 0.30;
const DESC_SLICE = 240;
const ENV_DISABLE = process.env.TOOL_TOP_PICKS_DISABLE === "1";

let _hitCount = 0;
let _fallbackCount = 0;
let _errCount = 0;

// ─── R125+9.1: Hit-rate tracking ────────────────────────────────────────
// Per-conversation cache of the last picks so we can ask "did the LLM
// actually pick from the top-5 we suggested?" after a tool call lands.
//
// Bounded LRU keyed by `${tenantId}:${conversationId}`. We only need the
// most-recent picks per thread because the next user message will recompute.
interface PicksRecord {
  picks: string[];        // names only, top-5
  computedAt: number;     // ms epoch
  recorded: boolean;      // first tool call this turn already counted?
}
const _picksMemory = new Map<string, PicksRecord>();
const PICKS_MEMORY_MAX = 500;
let _topPickHits = 0;     // first tool call was in the top-5
let _topPickMisses = 0;   // first tool call was NOT in the top-5
let _noPicksAvailable = 0; // tool was called but no picks were computed (e.g. short msg)

function _pruneMemoryIfNeeded() {
  if (_picksMemory.size <= PICKS_MEMORY_MAX) return;
  // Drop the oldest 20% by computedAt
  const entries = [..._picksMemory.entries()].sort((a, b) => a[1].computedAt - b[1].computedAt);
  const dropN = Math.ceil(_picksMemory.size * 0.2);
  for (let i = 0; i < dropN; i++) _picksMemory.delete(entries[i][0]);
}

export function rememberPicks(tenantId: number, conversationId: number | string, picks: TopPick[]): void {
  const key = `${tenantId}:${conversationId}`;
  _picksMemory.set(key, {
    picks: picks.map(p => p.name),
    computedAt: Date.now(),
    recorded: false,
  });
  _pruneMemoryIfNeeded();
}

/**
 * Record the FIRST tool call of a turn against the picks computed for that
 * turn. We only count the first call per turn because subsequent calls are
 * usually follow-on (e.g. orchestrate → delegate_task is one "decision").
 */
export function recordToolCall(tenantId: number, conversationId: number | string, toolName: string): void {
  const key = `${tenantId}:${conversationId}`;
  const rec = _picksMemory.get(key);
  if (!rec) { _noPicksAvailable++; return; }
  if (rec.recorded) return; // first-call-per-turn semantics
  rec.recorded = true;
  if (rec.picks.includes(toolName)) _topPickHits++;
  else _topPickMisses++;
}

export interface TopPick {
  name: string;
  semanticScore: number;
  perfScore: number;
  shortDesc: string;
}

export async function computeTopPicks(
  userMessage: string,
  availableTools: ToolDefinition[],
  tenantId: number
): Promise<TopPick[]> {
  if (ENV_DISABLE) return [];
  if (!userMessage || userMessage.length < 8) return [];
  if (!availableTools || availableTools.length < 5) return [];

  try {
    const candidateNames = new Set(availableTools.map(t => t.function.name));
    const ranked = await semanticRank(userMessage, {
      topK: TOP_PICKS_TOPK * 2,
      candidatePool: candidateNames,
      minScore: TOP_PICKS_MIN_SCORE,
    });

    if (ranked.length === 0) {
      _fallbackCount++;
      return [];
    }

    const descByName = new Map<string, string>();
    for (const t of availableTools) {
      descByName.set(t.function.name, t.function.description || "");
    }

    const enriched: TopPick[] = [];
    for (const r of ranked) {
      const perfScore = await getPerformanceScore(tenantId, r.name).catch(() => 0.5);
      const desc = (descByName.get(r.name) || "").slice(0, DESC_SLICE).replace(/\s+/g, " ").trim();
      enriched.push({
        name: r.name,
        semanticScore: r.score,
        perfScore,
        shortDesc: desc,
      });
    }

    enriched.sort((a, b) => {
      const a_combined = a.semanticScore * 0.7 + a.perfScore * 0.3;
      const b_combined = b.semanticScore * 0.7 + b.perfScore * 0.3;
      return b_combined - a_combined;
    });

    _hitCount++;
    return enriched.slice(0, TOP_PICKS_TOPK);
  } catch (err) {
    _errCount++;
    console.warn("[top-picks-header] computeTopPicks failed:", (err as Error).message);
    return [];
  }
}

export function formatTopPicksBlock(picks: TopPick[]): string {
  if (picks.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("═══ ★ TOP TOOL PICKS FOR THIS REQUEST (R112.18 Layer 1) ★ ═══");
  lines.push("Embeddings-ranked. These are the tools whose 'use when' signatures BEST match what the user just asked.");
  lines.push("CONSIDER THESE FIRST before scrolling the full inventory below. If one fits, use it. If none fit, scan the full list.");
  lines.push("");
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const confidence = p.semanticScore >= 0.55 ? "STRONG" : p.semanticScore >= 0.40 ? "GOOD" : "PLAUSIBLE";
    const perfTag = p.perfScore >= 0.7 ? " · proven reliable here" : p.perfScore <= 0.3 ? " · historically flaky" : "";
    lines.push(`  ${i + 1}. ${p.name} [${confidence}${perfTag}]`);
    lines.push(`     ${p.shortDesc}`);
  }
  lines.push("");
  lines.push("Override the picks ONLY when you have a specific reason — e.g. you already tried #1 this turn, or the user's true intent differs from the surface phrasing.");
  lines.push("═════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

export function getTopPicksStats() {
  const total = _topPickHits + _topPickMisses;
  return {
    // Computation stats (curator ran successfully?)
    hits: _hitCount,
    fallbacks: _fallbackCount,
    errors: _errCount,
    // R125+9.1: Effectiveness stats (did the LLM actually use what we suggested?)
    topPickHits: _topPickHits,
    topPickMisses: _topPickMisses,
    topPickHitRate: total > 0 ? +(_topPickHits / total).toFixed(3) : null,
    toolCallsWithNoPicks: _noPicksAvailable,
    memoryEntries: _picksMemory.size,
  };
}

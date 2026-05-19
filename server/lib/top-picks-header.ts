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
  return { hits: _hitCount, fallbacks: _fallbackCount, errors: _errCount };
}

/**
 * Cost-ordered context-compaction ladder.
 *
 * Motivation (Claude-Code-harness anatomy, arXiv:2604.14228; Bob 2026-06-13):
 * the cheapest deterministic reductions should run FIRST and we should only
 * escalate to a tighter (more aggressive, more lossy) rung — and ultimately to
 * the EXPENSIVE LLM summarizer — when the cheaper layer fails to get the message
 * array under the token budget. Previously the preemptive path used a single
 * DUMB head-slice (`truncateToolResults` @8000) and the LLM summarizer fired on
 * a separate message-COUNT heuristic, so we paid for gpt-5-mini summaries even
 * when free head+tail compression would have reclaimed the budget on its own.
 *
 * This module is deliberately dependency-light (imports only the dep-free
 * `compressToolOutput` + the pure `getContextWindow` lookup) so the ladder is
 * unit-testable WITHOUT opening a pg pool (avoids the node:test DB-pool hang).
 * The LLM rung itself lives in `server/compaction.ts#compactMessages`; this
 * ladder reports `needsLlmCompaction` so the caller invokes it only as a last
 * resort.
 *
 * Hard guarantees:
 *   - FAIL OPEN: per-result compression falls back to a bounded head-slice on
 *     any error; the budget cap is never exceeded and nothing throws.
 *   - NON-DESTRUCTIVE to stored history: callers pass the per-request copy of
 *     the messages; the persisted conversation rows are untouched.
 */

import { compressToolOutput } from "./tool-output-compressor";
import { getContextWindow } from "../context-window-guard";

type Msg = { role: string; content: any };

// Descending per-tool-result char caps. Each rung is cheaper-first: we only
// drop to a tighter cap (more aggressive, more lossy) when the looser cap did
// not bring the estimate under budget. All four rungs are FREE (deterministic,
// no LLM); the expensive LLM summary sits ABOVE this ladder.
const LADDER_CAPS = [8000, 3000, 1000, 400] as const;

// Kept in lockstep with server/compaction.ts estimateTokens (ceil(len/3.5)).
const CHARS_PER_TOKEN = 3.5;

const FALLBACK_SUFFIX = "\n[...tool output truncated for context budget]";

/**
 * Bounded head-slice fallback used when the type-aware compressor throws. The
 * cap MUST hold here too (the whole point of the budget contract is that NO
 * branch — including the fail-open one — exceeds maxChars), so we reserve the
 * suffix length before slicing. Degenerate case (cap smaller than the suffix):
 * return a bare bounded slice with no suffix.
 */
export function boundedFallback(text: string, cap: number): string {
  const c = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
  if (text.length <= c) return text;
  if (c <= FALLBACK_SUFFIX.length) return text.slice(0, c);
  return text.slice(0, c - FALLBACK_SUFFIX.length) + FALLBACK_SUFFIX;
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        if (part?.type === "image_url") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return String(content ?? "");
}

export function estimateLadderTokens(messages: Msg[]): number {
  let chars = 0;
  for (const m of messages) chars += extractText(m.content).length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Soft-compact trigger budget. Mirrors server/compaction.ts#shouldPreemptivelyCompact:
 * a modelId string derives the budget from the real context window (reserve 64K
 * for output + tool rounds, use 75% of the remaining headroom, floor 64K);
 * a raw number keeps the legacy *0.75 scaling.
 */
export function computeContextBudget(contextBudgetOrModelId: number | string = 120000): number {
  if (typeof contextBudgetOrModelId === "string") {
    const win = getContextWindow(contextBudgetOrModelId);
    return Math.max(64_000, Math.floor((win - 64_000) * 0.75));
  }
  return Math.floor(contextBudgetOrModelId * 0.75);
}

/**
 * Type-aware, head+tail tool-result compaction (replaces the dumb head-slice).
 * Only touches `tool` messages; FAIL OPEN to a bounded head-slice on any error.
 */
export function smartTruncateToolResults<T extends Msg>(messages: T[], maxCharsPerResult: number): T[] {
  const cap = Math.max(0, maxCharsPerResult);
  return messages.map((m) => {
    if (m.role !== "tool") return m;
    const text = extractText(m.content);
    if (text.length <= cap) return m;
    try {
      const r = compressToolOutput({ toolName: "ctx-compact", raw: text, maxChars: cap });
      return { ...m, content: r.text };
    } catch {
      // FAIL OPEN — but the cap MUST still hold (reserve suffix before slicing).
      return { ...m, content: boundedFallback(text, cap) };
    }
  });
}

export interface CompactionLadderResult<T extends Msg> {
  messages: T[];
  /** Names of the free rungs that fired, in order (e.g. ["smart-compress@8000", "smart-compress@3000"]). */
  layersFired: string[];
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  /** True when the free ladder got the estimate under budget. */
  fits: boolean;
  /** True when even the tightest free rung left us over budget → caller should escalate to the LLM summarizer. */
  needsLlmCompaction: boolean;
}

/**
 * Run the free, escalating compaction ladder. Applies the CHEAPEST reduction
 * first and drops to a tighter rung ONLY when the looser one did not get the
 * estimate under budget ("each layer runs only when cheaper ones fail"). Returns
 * `needsLlmCompaction: true` when all free rungs are exhausted and we are still
 * over budget — the caller then (and only then) pays for the LLM summarizer.
 */
export function compactLadder<T extends Msg>(
  messages: T[],
  opts: { modelId?: number | string } = {},
): CompactionLadderResult<T> {
  const budget = computeContextBudget(opts.modelId ?? 120000);
  const estimatedTokensBefore = estimateLadderTokens(messages);
  const layersFired: string[] = [];
  let current = messages;

  if (estimatedTokensBefore < budget) {
    return {
      messages: current,
      layersFired,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      fits: true,
      needsLlmCompaction: false,
    };
  }

  for (const cap of LADDER_CAPS) {
    current = smartTruncateToolResults(current, cap);
    layersFired.push(`smart-compress@${cap}`);
    if (estimateLadderTokens(current) < budget) break;
  }

  const estimatedTokensAfter = estimateLadderTokens(current);
  const fits = estimatedTokensAfter < budget;
  return { messages: current, layersFired, estimatedTokensBefore, estimatedTokensAfter, fits, needsLlmCompaction: !fits };
}

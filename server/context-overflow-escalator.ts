// ─────────────────────────────────────────────────────────────────────────────
// Context-Overflow Escalator (R74.13z-quat)
// ─────────────────────────────────────────────────────────────────────────────
// When a chat round fails with a "context too long" / "prompt too large" error,
// the previous behavior was to emergency-truncate every tool/assistant message
// to 800 chars and retry on the SAME model. That is lossy by design — it drops
// the actual content the agent was working with — and Bob's standing direction
// is "drive to completion." Truncation kills delivery quality.
//
// This module provides the FIRST escalation step the chat engine should try
// BEFORE falling back to lossy truncation: jump to a model with a 1M+ token
// context window. Gemini 3.5 Flash is Bob's preferred primary (R125+3.7, free tier — promoted from Gemini 3.1 Pro pending Gemini 3.5 Pro release), with
// Claude Opus 4.7 (also 1M, free) as backup, then 1M+ cheap models.
//
// Only when EVERY model in the chain has been tried (or the conversation truly
// exceeds 1M tokens — which is essentially never in normal use) does the
// chat engine fall through to the existing truncation recovery.
//
// Order matters: free + Bob's pick first, then free flagship, then cheap with
// even bigger windows as last resorts. Anything not free is opted-in by being
// in this list — none of them are paid-tier $$$.
// ─────────────────────────────────────────────────────────────────────────────

import { MODEL_REGISTRY, type ModelInfo } from "./providers";
import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";
import { parseContextLimitFromError } from "./error-context-parser";

// ─────────────────────────────────────────────────────────────────────────────
// R83 — Learned context-length cache (in-memory + DB-backed)
// ─────────────────────────────────────────────────────────────────────────────
// When a provider error reveals the real context limit (e.g. "maximum context
// length is 32768"), we record it so the next request to that model can
// pre-flight properly. Persisted in model_context_lengths so the knowledge
// survives restarts.

const _learnedCache = new Map<string, number>();

function cacheKey(modelId: string, baseUrl?: string | null): string {
  return `${modelId}@@${baseUrl || ""}`;
}

export async function recordLearnedContextLength(
  modelId: string,
  contextLength: number,
  baseUrl: string = "",
  source: "learned" | "manual" | "registry" = "learned",
): Promise<void> {
  if (!modelId || contextLength < 1024) return;
  _learnedCache.set(cacheKey(modelId, baseUrl), contextLength);
  try {
    await db.execute(sql`
      INSERT INTO model_context_lengths (model_id, base_url, context_length, source)
      VALUES (${modelId}, ${baseUrl}, ${contextLength}, ${source})
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      UPDATE model_context_lengths
         SET context_length = ${contextLength},
             source = ${source},
             updated_at = NOW()
       WHERE model_id = ${modelId} AND base_url = ${baseUrl}
    `);
  } catch (e: any) {
    console.warn(`[escalator] recordLearnedContextLength persist failed: ${String(e?.message).slice(0, 120)}`);
  }
}

export async function getLearnedContextLength(
  modelId: string,
  baseUrl: string = "",
): Promise<number | null> {
  const key = cacheKey(modelId, baseUrl);
  if (_learnedCache.has(key)) return _learnedCache.get(key)!;
  try {
    const r: any = await db.execute(sql`
      SELECT context_length FROM model_context_lengths
       WHERE model_id = ${modelId} AND base_url = ${baseUrl}
       LIMIT 1
    `);
    const rows = r.rows || r;
    if (Array.isArray(rows) && rows.length > 0) {
      const len = Number(rows[0].context_length);
      if (len > 0) {
        _learnedCache.set(key, len);
        return len;
      }
    }
  } catch (e) { logSilentCatch("server/context-overflow-escalator.ts", e); }
  return null;
}

/**
 * Convenience wrapper: parse a context-overflow error message and persist any
 * limit we can extract. Returns the learned limit (or null if no match).
 */
export async function learnFromOverflowError(
  modelId: string,
  errorMessage: string | null | undefined,
  baseUrl: string = "",
): Promise<number | null> {
  const limit = parseContextLimitFromError(errorMessage);
  if (!limit) return null;
  await recordLearnedContextLength(modelId, limit, baseUrl, "learned");
  return limit;
}

export interface BigContextEntry {
  modelId: string;
  contextWindow: number;       // total context window in tokens
  rationale: string;           // human-readable why-this-rank
}

export const BIG_CONTEXT_FALLBACK_CHAIN: BigContextEntry[] = [
  {
    modelId: "gemini-3.5-flash",
    contextWindow: 1_000_000,
    rationale: "Bob's primary pick (R125+3.7) — Gemini 3.5 Flash, the new FLAGSHIP Google model (I/O 2026-05-19), 1M-token window, free via Google integration; promoted from Gemini 3.1 Pro pending Gemini 3.5 Pro release",
  },
  // Opus REMOVED from the big-context escalation chain (Bob 2026-06-12 cost policy):
  // overflow used to escalate to metered Opus on huge prompts (~110K-token calls
  // were a top driver of the $440 Opus burst). Opus is jury-only now; Gemini 3.5
  // Flash (1M, free) leads and Nemotron (1M) / Grok (2M) cover larger prompts.
  {
    modelId: "nvidia/nemotron-3-super-120b-a12b",
    contextWindow: 1_000_000,
    rationale: "NVIDIA Nemotron 3 Super, 1M ctx, Mamba-Transformer hybrid — cheap OpenRouter fallback",
  },
  {
    modelId: "x-ai/grok-4.20-multi-agent",
    contextWindow: 2_000_000,
    rationale: "Grok 4.20 Multi-Agent — 2M ctx, parallel sub-agent orchestration — top-tier escalation for genuinely massive prompts",
  },
];

/**
 * Returns the next big-context model to try, or null when every entry in the
 * chain has already been attempted. Excludes models we've already tried this
 * round AND models that are not present in the live registry (defensive — if
 * an entry was removed from MODEL_REGISTRY we just skip it).
 *
 * @param currentModelId - the model that just overflowed
 * @param triedModelIds - set of model IDs already attempted this round
 *                        (the caller should add `currentModelId` before calling
 *                        so we don't recommend the same model that failed)
 */
export function getNextBigContextEscalation(
  currentModelId: string,
  triedModelIds: Set<string>,
): BigContextEntry | null {
  for (const entry of BIG_CONTEXT_FALLBACK_CHAIN) {
    if (triedModelIds.has(entry.modelId)) continue;
    if (entry.modelId === currentModelId) continue;
    const inRegistry = MODEL_REGISTRY.find((m) => m.id === entry.modelId);
    if (!inRegistry) continue;
    return entry;
  }
  return null;
}

/**
 * True iff the given model id is one of our designated big-context fallbacks.
 * Useful for logging / preventing infinite escalation loops on the call site.
 */
export function isBigContextFallback(modelId: string): boolean {
  return BIG_CONTEXT_FALLBACK_CHAIN.some((e) => e.modelId === modelId);
}

/**
 * Convenience: lookup a registry entry for a big-context fallback id.
 */
export function getBigContextModelInfo(modelId: string): ModelInfo | null {
  return MODEL_REGISTRY.find((m) => m.id === modelId) || null;
}

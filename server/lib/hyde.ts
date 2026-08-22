/**
 * HyDE — Hypothetical Document Embeddings
 *
 * Instead of embedding the user's raw question and searching for semantically
 * similar memory entries, we first generate a short hypothetical answer and
 * embed *that*. Because stored memories are factual statements, the hypothetical
 * answer lives in the same semantic space and retrieves far more relevant entries
 * than the question does — especially when the user's phrasing differs
 * significantly from how the fact is stored.
 *
 * Example: "should I deploy now?" → hypothetical "Bob requires explicit approval
 * before any deployment or publish action." → cosine-similarity finds the stored
 * memory "Never deploy without Bob's explicit go-ahead." The raw question
 * embedding would typically miss this.
 *
 * Reference: Gao et al., "Precise Zero-Shot Dense Retrieval without Relevance
 * Labels" (HyDE), ACL 2023. arXiv:2212.10496.
 */

import { replitOpenai } from "../providers";
import { logSilentCatch } from "./silent-catch";

const HYDE_MODEL = "gpt-5-mini";
const HYDE_MAX_TOKENS = 60;
const HYDE_TIMEOUT_MS = 4_000;

const HYDE_SYSTEM_PROMPT = `You are a memory retrieval assistant. Given a user message, write a single concise factual statement (under 25 words) that captures the most relevant stored fact a personal AI would have about this topic.

Write it as a stored fact, not as an answer to the question. Output ONLY the statement — no preamble, no quotes, no explanation.

Examples:
User: "should I deploy now?"
Output: Bob requires explicit approval before any deployment or publish action.

User: "what's my communication style preference?"
Output: Bob prefers terse, direct responses with no unnecessary commentary or emojis.

User: "how does the memory system work?"
Output: VisionClaw uses pgvector embeddings with MMR re-ranking and temporal decay for memory retrieval.

User: "what model should I use for this task?"
Output: The platform routes to different models based on task category using the auto-router; Opus is jury-only.`;

// ── In-process observability ─────────────────────────────────────────────────
// Reset on server restart. Surfaced via getHydeStats() and periodic log lines.

const _stats = {
  attempts: 0,    // total calls to generateHypotheticalMemory
  timeouts: 0,    // calls that hit the 4 s abort
  successes: 0,   // calls that returned a usable hypothetical
  shadowCount: 0, // shadow delta comparisons recorded
  totalDeltaTop5: 0, // cumulative sum of delta values (0=identical, 5=fully different)
  lastLogAt: 0,
};

/**
 * Generate a short hypothetical memory entry for HyDE-based retrieval.
 *
 * The returned string is intended to be embedded in place of the raw user
 * question. Because it reads like a stored fact rather than a question, cosine
 * similarity search against the memory store yields dramatically better recall.
 *
 * Returns null if generation times out (> 4 s) or fails — callers must fall
 * back to embedding the raw user message. Never throws.
 */
export async function generateHypotheticalMemory(
  userMessage: string,
): Promise<string | null> {
  if (!userMessage?.trim()) return null;
  _stats.attempts++;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), HYDE_TIMEOUT_MS);

  try {
    const resp = await replitOpenai.chat.completions.create(
      {
        model: HYDE_MODEL,
        messages: [
          { role: "system", content: HYDE_SYSTEM_PROMPT },
          { role: "user", content: userMessage.slice(0, 500) },
        ],
        max_completion_tokens: HYDE_MAX_TOKENS,
        temperature: 0.3,
      },
      { signal: abortController.signal },
    );
    const text = resp.choices[0]?.message?.content?.trim();
    if (text && text.length > 5) {
      _stats.successes++;
      return text;
    }
    _stats.timeouts++; // API returned but no usable text — treat as a miss
    return null;
  } catch (err: any) {
    _stats.timeouts++;
    if (!abortController.signal.aborted) {
      // Unexpected error (not a timeout) — log but still fail open.
      logSilentCatch("server/lib/hyde.ts", err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Record a shadow comparison result.
 *
 * `deltaTop5` is the number of memories in the HyDE top-5 that differ from the
 * raw-query top-5 (0 = identical results, 5 = completely different). Callers
 * compute this by running rankMemories twice — once with the HyDE embedding and
 * once with the raw query embedding — and counting the set difference.
 *
 * Logs a summary line every 50 comparisons or every 60 s, whichever comes first.
 */
export function recordHydeShadow(deltaTop5: number): void {
  _stats.shadowCount++;
  _stats.totalDeltaTop5 += deltaTop5;

  const now = Date.now();
  const shouldLog =
    _stats.shadowCount % 50 === 0 ||
    (now - _stats.lastLogAt > 60_000 && _stats.shadowCount > 0);

  if (shouldLog) {
    _stats.lastLogAt = now;
    const timeoutPct = ((_stats.timeouts / Math.max(1, _stats.attempts)) * 100).toFixed(1);
    const avgDelta = (_stats.totalDeltaTop5 / Math.max(1, _stats.shadowCount)).toFixed(2);
    console.log(
      `[hyde:stats] attempts=${_stats.attempts} timeout_rate=${timeoutPct}% ` +
      `shadows=${_stats.shadowCount} avg_delta_top5=${avgDelta} ` +
      `(0=HyDE+raw identical top-5, 5=fully different — higher delta = HyDE finding different memories)`,
    );
  }

  if (process.env.MEMORY_HYDE_LOG === "1") {
    console.log(`[hyde:shadow] delta_top5=${deltaTop5}`);
  }
}

/**
 * Return a snapshot of in-process HyDE performance counters.
 * Useful for health checks and diagnostics.
 */
export function getHydeStats() {
  return {
    attempts: _stats.attempts,
    timeouts: _stats.timeouts,
    successes: _stats.successes,
    timeoutRatePct: _stats.attempts > 0
      ? Number(((_stats.timeouts / _stats.attempts) * 100).toFixed(1))
      : 0,
    shadowCount: _stats.shadowCount,
    avgDeltaTop5: _stats.shadowCount > 0
      ? Number((_stats.totalDeltaTop5 / _stats.shadowCount).toFixed(2))
      : null,
  };
}

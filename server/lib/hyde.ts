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
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "./silent-catch";
import {
  classifyHydeQuery,
  type HydeQueryCategory,
  type HydeComparisonFailureReason,
  type HydeRetrievalSurface,
  type HydeResultComparison,
} from "./hyde-observability";

const HYDE_MODEL = "gpt-5-mini";
const HYDE_MAX_TOKENS = 100;
const HYDE_TIMEOUT_MS = 4_000;
let lastPersistenceErrorAt = 0;

export const HYDE_FEW_SHOT_EXAMPLES = [
  {
    user: "should I deploy now?",
    output: "Bob requires explicit approval before any deployment or publish action.",
  },
  {
    user: "what's my communication style preference?",
    output: "Bob prefers terse, direct responses with no unnecessary commentary or emojis.",
  },
  {
    user: "how does the memory system work?",
    output: "VisionClaw uses pgvector embeddings with MMR re-ranking and temporal decay for memory retrieval.",
  },
  {
    user: "what model should I use for this task?",
    output: "The platform routes to different models based on task category using the auto-router; Opus is jury-only.",
  },
] as const;

const HYDE_SYSTEM_PROMPT = `You are a memory retrieval assistant. Given a user message, write a single concise factual statement (under 25 words) that captures the most relevant stored fact a personal AI would have about this topic.

Write it as a stored fact, not as an answer to the question. Output ONLY the statement — no preamble, no quotes, no explanation.

Examples:
${HYDE_FEW_SHOT_EXAMPLES.map((example) => `User: "${example.user}"\nOutput: ${example.output}`).join("\n\n")}`;

// ── In-process observability ─────────────────────────────────────────────────
// Reset on server restart. Surfaced via getHydeStats() and periodic log lines.

const _stats = {
  attempts: 0,    // total calls to generateHypotheticalMemory
  timeouts: 0,    // calls that hit the 4 s abort
  failures: 0,    // non-timeout errors or empty provider responses
  successes: 0,   // calls that returned a usable hypothetical
  shadowCount: 0, // shadow delta comparisons recorded
  totalDeltaTop5: 0, // cumulative sum of delta values (0=identical, 5=fully different)
  totalRankDisplacement: 0,
  rankDisplacementCount: 0,
  lastLogAt: 0,
};

export type HydeGenerationOutcome = "success" | "timeout" | "error" | "empty";
export interface HydeGenerationResult {
  retrievalId: string;
  text: string | null;
  outcome: HydeGenerationOutcome;
}

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
  return (await generateHypotheticalMemoryDetailed(userMessage)).text;
}

/**
 * Same generator as generateHypotheticalMemory, with a truthful outcome for
 * telemetry. Keeping the compatibility wrapper above avoids changing callers
 * that only need the hypothetical text.
 */
export async function generateHypotheticalMemoryDetailed(
  userMessage: string,
): Promise<HydeGenerationResult> {
  const retrievalId = randomUUID();
  if (!userMessage?.trim()) return { retrievalId, text: null, outcome: "empty" };
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
        // gpt-5-mini otherwise spends the tiny budget on hidden reasoning and
        // can return an empty completion.
        reasoning_effort: "minimal",
      } as any,
      { signal: abortController.signal },
    );
    const text = resp.choices[0]?.message?.content?.trim();
    if (text && text.length > 5) {
      _stats.successes++;
      return { retrievalId, text, outcome: "success" };
    }
    _stats.failures++;
    return { retrievalId, text: null, outcome: "empty" };
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      _stats.timeouts++;
    } else {
      _stats.failures++;
      // Unexpected error (not a timeout) — log but still fail open.
      logSilentCatch("server/lib/hyde.ts", err);
    }
    return { retrievalId, text: null, outcome: abortController.signal.aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

function persistObservation(data: Record<string, unknown>, tenantId: number): void {
  // Shadow/attempt rows are inert event-log observations, not work for the
  // event-bus drainer. Never let telemetry affect the retrieval hot path.
  try {
    void db
      .execute(sql`
        INSERT INTO event_log (tenant_id, event_type, source, data, status)
        VALUES (${tenantId}, 'memory_hyde_observation', 'hyde', ${JSON.stringify(data)}::jsonb, 'shadow')
      `)
      .catch((err) => reportPersistenceFailure(err));
  } catch (err) {
    reportPersistenceFailure(err);
  }
}

function reportPersistenceFailure(err: unknown): void {
  const now = Date.now();
  if (now - lastPersistenceErrorAt > 60_000) {
    lastPersistenceErrorAt = now;
    console.error("[hyde] observation persistence failed; weekly metrics may be incomplete", err);
  }
  logSilentCatch("server/lib/hyde.ts", err);
}

/** Persist one generation attempt, including timeouts that have no shadow pair. */
export function recordHydeAttempt(args: {
  tenantId: number;
  category: HydeQueryCategory;
  outcome: HydeGenerationOutcome;
  surface: HydeRetrievalSurface;
  retrievalId: string;
}): void {
  persistObservation(
    {
      kind: "attempt",
      retrievalId: args.retrievalId,
      category: args.category,
      outcome: args.outcome,
      timedOut: args.outcome === "timeout",
      surface: args.surface,
    },
    args.tenantId,
  );
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
export function recordHydeShadow(args: {
  tenantId: number;
  personaId?: number | null;
  category: HydeQueryCategory;
  comparison: HydeResultComparison;
  surface: HydeRetrievalSurface;
  retrievalId: string;
}): void {
  const { comparison } = args;
  _stats.shadowCount++;
  _stats.totalDeltaTop5 += comparison.differentTop5;
  if (comparison.rankDisplacement !== null) {
    _stats.totalRankDisplacement += comparison.rankDisplacement;
    _stats.rankDisplacementCount++;
  }

  const now = Date.now();
  const shouldLog =
    _stats.shadowCount % 50 === 0 ||
    (now - _stats.lastLogAt > 60_000 && _stats.shadowCount > 0);

  if (shouldLog) {
    _stats.lastLogAt = now;
    const timeoutPct = ((_stats.timeouts / Math.max(1, _stats.attempts)) * 100).toFixed(1);
    const avgDelta = (_stats.totalDeltaTop5 / Math.max(1, _stats.shadowCount)).toFixed(2);
    const avgMovement = _stats.rankDisplacementCount
      ? (_stats.totalRankDisplacement / _stats.rankDisplacementCount).toFixed(2)
      : "n/a";
    console.log(
      `[hyde:stats] attempts=${_stats.attempts} timeout_rate=${timeoutPct}% ` +
      `shadows=${_stats.shadowCount} avg_delta_top5=${avgDelta} avg_rank_displacement=${avgMovement} ` +
      `(0=HyDE+raw identical top-5, 5=fully different — higher delta = HyDE finding different memories)`,
    );
  }

  if (process.env.MEMORY_HYDE_LOG === "1") {
    console.log(
      `[hyde:shadow] category=${args.category} overlap=${comparison.overlapCount} ` +
      `delta_top5=${comparison.differentTop5} rank_displacement=${comparison.rankDisplacement ?? "n/a"}`,
    );
  }

  persistObservation(
    {
      kind: "shadow",
      retrievalId: args.retrievalId,
      category: args.category,
      personaId: args.personaId ?? null,
      surface: args.surface,
      overlapCount: comparison.overlapCount,
      deltaTop5: comparison.differentTop5,
      rankDisplacement: comparison.rankDisplacement,
    },
    args.tenantId,
  );
}

export function recordHydeComparisonFailure(args: {
  tenantId: number;
  category: HydeQueryCategory;
  surface: HydeRetrievalSurface;
  retrievalId: string;
  reason: HydeComparisonFailureReason;
}): void {
  persistObservation(
    {
      kind: "comparison_failure",
      retrievalId: args.retrievalId,
      category: args.category,
      surface: args.surface,
      reason: args.reason,
    },
    args.tenantId,
  );
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
    failures: _stats.failures,
    timeoutRatePct: _stats.attempts > 0
      ? Number(((_stats.timeouts / _stats.attempts) * 100).toFixed(1))
      : 0,
    shadowCount: _stats.shadowCount,
    avgDeltaTop5: _stats.shadowCount > 0
      ? Number((_stats.totalDeltaTop5 / _stats.shadowCount).toFixed(2))
      : null,
    avgRankDisplacement: _stats.rankDisplacementCount > 0
      ? Number((_stats.totalRankDisplacement / _stats.rankDisplacementCount).toFixed(2))
      : null,
  };
}

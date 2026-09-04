/**
 * Tool-Output Compressor telemetry — persistent daily rollup.
 *
 * The pure compressor (`tool-output-compressor.ts`) keeps a process-lifetime
 * in-memory tally, but that resets on every restart/deploy. To actually answer
 * "is this making a dent in the Anthropic bill?" we need the numbers to survive
 * restarts, so this module flushes them into a per-(tenant, day) rollup row.
 *
 * Design invariants (mirrors orchestration-efficiency.ts):
 *  - Fire-and-forget: `recordToolCompression` never blocks, slows, or throws into
 *    the chat hot path. It accumulates in memory and a debounced timer flushes.
 *  - HONEST headline metric: `tokensSavedVsBaseline` = savings vs the dumb
 *    head-slice this compressor REPLACED (both cap at maxChars). We never sent the
 *    raw payload, so "vs raw" is kept too but labelled as the (larger) gross figure.
 *  - Conservative on flush failure: a failed UPSERT DROPS its batch rather than
 *    re-merging it. A commit-then-ack-loss failure is indistinguishable here, and
 *    re-merging it would double-count and INFLATE the savings headline. We bias
 *    toward UNDER-counting (lose ≤15s of one tenant's data) so the honest
 *    bill-impact number can never be overstated.
 */

import { db } from "../db";
import { logSilentCatch } from "./silent-catch";
import { sql } from "drizzle-orm";

const tok = (chars: number) => Math.ceil(chars / 3.5); // lockstep with the compressor

interface Accum {
  calls: number;
  compressedCalls: number;
  originalChars: number;
  outputChars: number;
  baselineChars: number;
  tokensVsRaw: number;
  tokensVsBaseline: number;
}

function emptyAccum(): Accum {
  return { calls: 0, compressedCalls: 0, originalChars: 0, outputChars: 0, baselineChars: 0, tokensVsRaw: 0, tokensVsBaseline: 0 };
}

/**
 * Pure per-event delta computation (no DB, no side effects — unit-testable).
 * Passthrough (already-small) results count toward `calls` only.
 */
export function compressionEventDeltas(input: {
  originalChars: number;
  outputChars: number;
  maxChars: number;
  compressed: boolean;
}): Accum {
  const d = emptyAccum();
  d.calls = 1;
  if (input.compressed) {
    // What the OLD dumb head-slice would have sent for this same payload.
    const baseline = Math.min(input.originalChars, input.maxChars);
    d.compressedCalls = 1;
    d.originalChars = input.originalChars;
    d.outputChars = input.outputChars;
    d.baselineChars = baseline;
    d.tokensVsRaw = Math.max(0, tok(input.originalChars) - tok(input.outputChars));
    d.tokensVsBaseline = Math.max(0, tok(baseline) - tok(input.outputChars));
  }
  return d;
}

const buffers = new Map<number, Accum>(); // tenantId -> pending deltas
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 15000;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushToolCompression();
  }, FLUSH_MS);
  // never keep the process alive just to flush telemetry
  if (typeof (flushTimer as any).unref === "function") (flushTimer as any).unref();
}

/**
 * Fire-and-forget. Accumulates one compression event into the per-tenant buffer.
 * `compressed` is false for passthrough (already-small) results so they don't
 * inflate the savings denominator.
 */
export function recordToolCompression(input: {
  tenantId: number;
  originalChars: number;
  outputChars: number;
  maxChars: number;
  compressed: boolean;
}): void {
  try {
    if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) return;
    const b = buffers.get(input.tenantId) ?? emptyAccum();
    const d = compressionEventDeltas(input);
    b.calls += d.calls;
    b.compressedCalls += d.compressedCalls;
    b.originalChars += d.originalChars;
    b.outputChars += d.outputChars;
    b.baselineChars += d.baselineChars;
    b.tokensVsRaw += d.tokensVsRaw;
    b.tokensVsBaseline += d.tokensVsBaseline;
    buffers.set(input.tenantId, b);
    scheduleFlush();
  } catch (_silentErr) { logSilentCatch("server/lib/tool-compression-stats.ts", _silentErr); }
}

/** Flush pending per-tenant deltas to the daily rollup. Safe to call anytime. */
export async function flushToolCompression(): Promise<void> {
  const entries = Array.from(buffers.entries());
  buffers.clear();
  for (const [tenantId, b] of entries) {
    if (b.calls === 0) continue;
    try {
      await db.execute(sql`
        INSERT INTO tool_compression_stats
          (tenant_id, day, calls, compressed_calls, original_chars, output_chars,
           baseline_chars, tokens_saved_vs_raw, tokens_saved_vs_baseline, updated_at)
        VALUES (
          ${tenantId}, CURRENT_DATE, ${b.calls}, ${b.compressedCalls}, ${b.originalChars},
          ${b.outputChars}, ${b.baselineChars}, ${b.tokensVsRaw}, ${b.tokensVsBaseline}, CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id, day) DO UPDATE SET
          calls = tool_compression_stats.calls + EXCLUDED.calls,
          compressed_calls = tool_compression_stats.compressed_calls + EXCLUDED.compressed_calls,
          original_chars = tool_compression_stats.original_chars + EXCLUDED.original_chars,
          output_chars = tool_compression_stats.output_chars + EXCLUDED.output_chars,
          baseline_chars = tool_compression_stats.baseline_chars + EXCLUDED.baseline_chars,
          tokens_saved_vs_raw = tool_compression_stats.tokens_saved_vs_raw + EXCLUDED.tokens_saved_vs_raw,
          tokens_saved_vs_baseline = tool_compression_stats.tokens_saved_vs_baseline + EXCLUDED.tokens_saved_vs_baseline,
          updated_at = CURRENT_TIMESTAMP
      `);
    } catch (_silentErr) {
      // DELIBERATELY conservative: drop the failed batch instead of re-merging it.
      //
      // A thrown UPSERT error is usually pre-commit (safe to retry), but an
      // ambiguous failure — commit landed, then the connection dropped before the
      // ack — is indistinguishable at this layer. Re-merging in that case would
      // apply the same deltas twice and INFLATE the savings headline. Since the
      // entire point of this telemetry is an HONEST bill-impact number, we bias
      // toward UNDER-counting (lose a batch) over OVER-counting (overstate the win).
      // The lost batch is at most ~15s of one tenant's tool calls.
      logSilentCatch("server/lib/tool-compression-stats.ts", _silentErr);
    }
  }
}

export interface ToolCompressionSummary {
  /** rollup window in days */
  windowDays: number;
  calls: number;
  compressedCalls: number;
  /** HONEST headline: input tokens saved vs the old head-slice (real bill impact). */
  tokensSavedVsBaseline: number;
  /** gross figure vs sending the raw uncompressed payload (we never did — context only). */
  tokensSavedVsRaw: number;
  /** 0..1 — output/original size reduction on compressed calls. */
  savingsRatio: number;
  /** rough USD estimate from tokensSavedVsBaseline at a conservative input rate. */
  estCostSavedUsd: number;
  inputUsdPerMTok: number;
  degraded: boolean;
}

// Conservative blended input price for the est-savings figure. Override with
// TOOL_COMPRESSION_INPUT_USD_PER_MTOK (e.g. Opus 4 input ≈ $15/M, Sonnet ≈ $3/M).
const DEFAULT_INPUT_USD_PER_MTOK = 5;

/**
 * Read-only dashboard summary over the last `windowDays` (default 30) for a tenant.
 * Degraded-safe: returns `degraded: true` on query failure rather than faking zeros.
 */
export async function summarizeToolCompression(tenantId: number, windowDays = 30): Promise<ToolCompressionSummary> {
  const rate = Number(process.env.TOOL_COMPRESSION_INPUT_USD_PER_MTOK) || DEFAULT_INPUT_USD_PER_MTOK;
  const empty: ToolCompressionSummary = {
    windowDays,
    calls: 0,
    compressedCalls: 0,
    tokensSavedVsBaseline: 0,
    tokensSavedVsRaw: 0,
    savingsRatio: 0,
    estCostSavedUsd: 0,
    inputUsdPerMTok: rate,
    degraded: false,
  };
  if (!Number.isInteger(tenantId) || tenantId <= 0) return empty;

  try {
    const res = await db.execute(sql`
      SELECT
        COALESCE(SUM(calls), 0)::bigint AS calls,
        COALESCE(SUM(compressed_calls), 0)::bigint AS compressed_calls,
        COALESCE(SUM(original_chars), 0)::bigint AS original_chars,
        COALESCE(SUM(output_chars), 0)::bigint AS output_chars,
        COALESCE(SUM(tokens_saved_vs_raw), 0)::bigint AS vs_raw,
        COALESCE(SUM(tokens_saved_vs_baseline), 0)::bigint AS vs_baseline
      FROM tool_compression_stats
      WHERE tenant_id = ${tenantId}
        AND day >= (CURRENT_DATE - ${windowDays - 1} * INTERVAL '1 day')
    `);
    const row = (((res as any).rows || res) as any[])[0] || {};
    const originalChars = Number(row.original_chars) || 0;
    const outputChars = Number(row.output_chars) || 0;
    const vsBaseline = Number(row.vs_baseline) || 0;
    const ratio = originalChars > 0 ? 1 - outputChars / originalChars : 0;
    return {
      windowDays,
      calls: Number(row.calls) || 0,
      compressedCalls: Number(row.compressed_calls) || 0,
      tokensSavedVsBaseline: vsBaseline,
      tokensSavedVsRaw: Number(row.vs_raw) || 0,
      savingsRatio: Math.round(ratio * 1000) / 1000,
      estCostSavedUsd: Math.round((vsBaseline / 1_000_000) * rate * 100) / 100,
      inputUsdPerMTok: rate,
      degraded: false,
    };
  } catch (_silentErr) {
    logSilentCatch("server/lib/tool-compression-stats.ts", _silentErr);
    return { ...empty, degraded: true };
  }
}

// R98.19 — Memory v2: debounced async update queue
//
// Lifted from bytedance/deer-flow's queue.py + updater.py pattern.
// Solves three things at once:
//   1. Memory writes don't block the chat thread (debounced flush).
//   2. Per-(tenant, normalizedFact) dedup BEFORE the DB insert (apply-time
//      whitespace-normalized dedup, matches deer-flow's updater.py behavior).
//   3. Confidence-threshold gate at write time — facts below threshold are
//      dropped before they pollute the store.
//
// Configuration via env:
//   MEMORY_DEBOUNCE_MS              (default 30000 = 30s)
//   MEMORY_FACT_CONFIDENCE_THRESHOLD (default 0.7, 0..1 float)
//   MEMORY_QUEUE_MAX_PENDING         (default 500 — back-pressure cap)
//
// All inserts go through storage.createMemoryEntry so existing
// embedding/dedup/contradiction logic still applies after the queue flush.

import { storage } from "../storage";
import { logSilentCatch } from "./silent-catch";
import { computeQualityScore, QUALITY_REVIEW_THRESHOLD } from "./quality-score";

export interface MemoryQueueItem {
  tenantId: number;
  personaId: number | null;
  fact: string;
  category: string;
  source: string;
  confidence: number;
  confidenceSource?: string;
  wing?: string | null;
  room?: string | null;
}

const DEBOUNCE_MS = Math.max(1000, Number(process.env.MEMORY_DEBOUNCE_MS) || 30_000);
const CONFIDENCE_THRESHOLD = (() => {
  const v = Number(process.env.MEMORY_FACT_CONFIDENCE_THRESHOLD);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
})();
const MAX_PENDING = Math.max(50, Number(process.env.MEMORY_QUEUE_MAX_PENDING) || 500);

// Per-(tenantId|normalizedFact) dedup map. Holds the highest-confidence
// pending version of a fact until the flush window elapses.
const pending = new Map<string, MemoryQueueItem>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

// Statistics for the heartbeat / dashboards.
const stats = {
  enqueued: 0,
  written: 0,
  dropped_below_threshold: 0,
  deduped_in_queue: 0,
  flush_runs: 0,
  back_pressured: 0,
  errors: 0,
  // R116 — agentmemory N7
  flagged_for_review: 0,
};

/** Whitespace-normalize a fact for dedup: lowercase, collapse whitespace, trim. */
export function normalizeFact(fact: string): string {
  return String(fact || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dedupKey(tenantId: number, fact: string): string {
  return `${tenantId}|${normalizeFact(fact)}`;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow().catch((e) => logSilentCatch("server/lib/memory-queue.ts", e));
  }, DEBOUNCE_MS);
  // Don't keep the event loop alive solely on this timer.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/**
 * Enqueue a memory fact for asynchronous, debounced writing.
 * Returns an object describing what the queue did so callers can log it.
 *
 * Behavior:
 *  - confidence < threshold → dropped immediately, returns { ok:false, reason:'below_threshold' }
 *  - duplicate of an in-flight item → keeps the higher-confidence version, returns { ok:true, status:'deduped' }
 *  - new item → buffered, returns { ok:true, status:'enqueued' }
 *  - back-pressure (MAX_PENDING reached) → forces an immediate flush before buffering
 */
export function enqueueMemoryFact(item: MemoryQueueItem): {
  ok: boolean;
  status?: "enqueued" | "deduped" | "flushed_immediately";
  reason?: string;
  threshold?: number;
} {
  // Defensive normalize — callers may pass any shape.
  const conf = Number.isFinite(item.confidence) ? item.confidence : 0;
  if (conf < CONFIDENCE_THRESHOLD) {
    stats.dropped_below_threshold++;
    return { ok: false, reason: "below_threshold", threshold: CONFIDENCE_THRESHOLD };
  }

  const fact = String(item.fact || "").trim();
  if (!fact || fact.length < 4) {
    return { ok: false, reason: "fact_too_short" };
  }

  const key = dedupKey(item.tenantId, fact);
  const existing = pending.get(key);
  if (existing) {
    // Keep the version with the higher confidence; preserve original source if tied.
    if (conf > existing.confidence) {
      pending.set(key, { ...item, fact, confidence: conf });
    }
    stats.deduped_in_queue++;
    scheduleFlush();
    return { ok: true, status: "deduped" };
  }

  pending.set(key, { ...item, fact, confidence: conf });
  stats.enqueued++;

  if (pending.size >= MAX_PENDING) {
    stats.back_pressured++;
    void flushNow().catch((e) => logSilentCatch("server/lib/memory-queue.ts", e));
    return { ok: true, status: "flushed_immediately" };
  }

  scheduleFlush();
  return { ok: true, status: "enqueued" };
}

/** Force-drain the queue right now. Returns the number of items written. */
export async function flushNow(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  stats.flush_runs++;
  let written = 0;
  try {
    if (pending.size === 0) return 0;
    const drained: MemoryQueueItem[] = Array.from(pending.values());
    pending.clear();

    for (const item of drained) {
      try {
        // Final apply-time dedup against the DB (whitespace-normalized).
        // We delegate to existing storage which already runs contradiction
        // resolution; we layer a normalized-LIKE check on top.
        const normalized = normalizeFact(item.fact);
        const dupCheck = await storage.getMemoryEntries(
          item.personaId ?? undefined,
          50,
          0,
          item.tenantId
        ).catch(() => ({ data: [] as any[] }));
        const isDup = (dupCheck.data || []).some(
          (m: any) => normalizeFact(m.fact || "") === normalized
        );
        if (isDup) continue;

        // R116 — agentmemory N7. Compute heuristic quality_score and pass it
        // into the insert. Rows below QUALITY_REVIEW_THRESHOLD are still
        // written (so we don't silently lose data), but land in the partial
        // index idx_memory_entries_quality_below for ops review.
        const qs = computeQualityScore({
          fact: item.fact,
          source: item.source,
          confidence: item.confidence,
          confidenceSource: item.confidenceSource ?? null,
          category: item.category,
        });
        if (qs.score < QUALITY_REVIEW_THRESHOLD) {
          stats.flagged_for_review++;
        }

        await storage.createMemoryEntry({
          fact: item.fact,
          category: item.category,
          source: item.source,
          status: "active",
          personaId: item.personaId,
          tenantId: item.tenantId,
          wing: item.wing ?? null,
          room: item.room ?? null,
          confidence: item.confidence,
          confidenceSource: item.confidenceSource ?? null,
          qualityScore: qs.score,
        } as any);
        written++;
        stats.written++;
      } catch (e: any) {
        stats.errors++;
        console.error("[memory-queue] insert failed:", e?.message || String(e));
      }
    }
  } finally {
    flushing = false;
  }
  return written;
}

export function getMemoryQueueConfig() {
  return {
    debounceMs: DEBOUNCE_MS,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    maxPending: MAX_PENDING,
  };
}

export function getMemoryQueueStats() {
  return { ...stats, pending: pending.size, ...getMemoryQueueConfig() };
}

// On process shutdown, do a best-effort drain so we don't lose buffered facts.
function installShutdownDrain() {
  const drain = () => {
    if (pending.size === 0) return;
    void flushNow().catch(() => {});
  };
  process.once("beforeExit", drain);
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}
installShutdownDrain();

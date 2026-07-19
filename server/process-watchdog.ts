import { logSilentCatch } from "./lib/silent-catch";
/**
 * Round 29 — Real process supervision.
 *
 * Before this module, server/process-governor.ts was policy-only: it could
 * write rules and recommend actions but had no mechanism to actually stop
 * a stuck or runaway in-process operation. server/heartbeat.ts had a
 * Promise.race timeout per task that REJECTED the race after TASK_TIMEOUT_MS,
 * but the underlying promise kept running unsupervised — no AbortController
 * was wired to anything, so the work continued to consume LLM tokens, hold
 * DB connections, and could even resolve LATER and corrupt state we'd
 * already logged as failed.
 *
 * This module provides the missing teeth:
 *  - An in-process registry of running operations keyed by runId, each
 *    holding an AbortController so we can really cancel them.
 *  - A periodic watchdog that scans the registry and the heartbeat
 *    activeTaskTracker; anything past its hard cap is force-cancelled
 *    and a `process.stuck` event is emitted so Felix sees it through
 *    the attention bus.
 *  - Public `register/complete/forceCancel` API for any module to opt in.
 *
 * Single-process for v0 — the registry lives in this Node process. A
 * future multi-worker setup would replace this Map with Redis or a DB
 * row, but the API surface stays the same.
 */

export type WatchdogKind =
  | "heartbeat-task"
  | "plan-step"
  | "tool-call"
  | "research-experiment"
  | "delivery"
  | "other";

export interface InflightEntry {
  runId: string;
  kind: WatchdogKind;
  label: string;
  startedAt: number;
  hardCapMs: number;
  abortCtrl: AbortController;
  cancelled?: boolean;
  cancelReason?: string;
  onTimeout?: () => void | Promise<void>;
  meta?: Record<string, unknown>;
}

const inflight = new Map<string, InflightEntry>();

let watchdogTimer: NodeJS.Timeout | null = null;
let watchdogIntervalMs = 30_000;
const ORPHAN_HEARTBEAT_TASK_MS = 30 * 60_000; // 30 min — anything older in activeTaskTracker is presumed dead

let scanCount = 0;
let cancelCount = 0;
let orphanCount = 0;

/**
 * Register an in-flight operation. Returns the AbortSignal you should
 * pass to fetch / OpenAI / whatever supports it.
 *
 * Always pair with `complete(runId)` in a finally block.
 */
export function register(args: {
  runId: string;
  kind: WatchdogKind;
  label: string;
  hardCapMs: number;
  onTimeout?: () => void | Promise<void>;
  meta?: Record<string, unknown>;
}): AbortSignal {
  if (inflight.has(args.runId)) {
    // Re-registration is a programming error — log loudly but don't throw,
    // because crashing a worker over a duplicate key would be worse than
    // the bookkeeping issue.
    console.warn(`[watchdog] runId="${args.runId}" already registered (kind=${args.kind}); replacing entry`);
  }
  const abortCtrl = new AbortController();
  inflight.set(args.runId, {
    runId: args.runId,
    kind: args.kind,
    label: args.label,
    startedAt: Date.now(),
    hardCapMs: args.hardCapMs,
    abortCtrl,
    onTimeout: args.onTimeout,
    meta: args.meta,
  });
  return abortCtrl.signal;
}

/** Mark an operation finished — remove from registry. Idempotent. */
export function complete(runId: string): void {
  inflight.delete(runId);
}

/**
 * Force-cancel a still-running operation. Calls AbortController.abort()
 * (so HTTP/LLM clients honoring the signal will throw AbortError) and
 * removes the entry from the registry.
 */
export async function forceCancel(runId: string, reason: string): Promise<boolean> {
  const entry = inflight.get(runId);
  if (!entry) return false;
  entry.cancelled = true;
  entry.cancelReason = reason;
  try {
    entry.abortCtrl.abort(reason);
  } catch (e: any) {
    console.warn(`[watchdog] abort() threw for runId=${runId}: ${e?.message}`);
  }
  if (entry.onTimeout) {
    try { await entry.onTimeout(); } catch (e: any) {
      console.warn(`[watchdog] onTimeout callback threw for runId=${runId}: ${e?.message}`);
    }
  }
  cancelCount++;
  inflight.delete(runId);
  console.log(`[watchdog] CANCELLED runId=${runId} kind=${entry.kind} label="${entry.label}" reason="${reason}" elapsed=${Date.now() - entry.startedAt}ms`);
  // Best-effort attention-bus notification so Felix sees the cancellation.
  try {
    const { emitEvent } = await import("./event-bus");
    await emitEvent({
      type: "process.cancelled",
      source: "process-watchdog",
      tenantId: 1,
      data: {
        runId: entry.runId,
        kind: entry.kind,
        label: entry.label,
        reason,
        elapsedMs: Date.now() - entry.startedAt,
      },
    });
  } catch (e) { logSilentCatch("server/process-watchdog.ts", e); }
  return true;
}

export function getInflight(): InflightEntry[] {
  return Array.from(inflight.values()).map(e => ({
    ...e,
    abortCtrl: undefined as any, // don't leak controllers to callers
  }));
}

export function getStats(): { active: number; scans: number; cancelled: number; orphansSeen: number } {
  return { active: inflight.size, scans: scanCount, cancelled: cancelCount, orphansSeen: orphanCount };
}

async function scanOnce(): Promise<void> {
  scanCount++;
  const now = Date.now();

  // Pass 1 — registered inflights past hard cap
  for (const entry of Array.from(inflight.values())) {
    const elapsed = now - entry.startedAt;
    if (elapsed > entry.hardCapMs) {
      console.warn(`[watchdog] runId=${entry.runId} kind=${entry.kind} exceeded hardCap (${elapsed}ms > ${entry.hardCapMs}ms) — force-cancelling`);
      await forceCancel(entry.runId, `exceeded hard cap of ${entry.hardCapMs}ms (elapsed ${elapsed}ms)`);
    }
  }

  // Pass 2 — heartbeat orphans (entries in activeTaskTracker that no
  // running tick will ever clean up, e.g. because the worker that
  // owned them died or restarted mid-task).
  try {
    const { activeTaskTracker } = await import("./heartbeat");
    for (const [taskId, info] of activeTaskTracker.entries()) {
      const elapsed = now - info.startedAt;
      if (elapsed > ORPHAN_HEARTBEAT_TASK_MS) {
        orphanCount++;
        console.warn(`[watchdog] orphan heartbeat task "${info.taskName}" (id=${taskId}, started ${Math.round(elapsed/60_000)}m ago) — clearing tracker entry and emitting process.stuck`);
        activeTaskTracker.delete(taskId);
        try {
          const { emitEvent } = await import("./event-bus");
          await emitEvent({
            type: "process.stuck",
            source: "process-watchdog",
            tenantId: 1,
            data: {
              runId: `heartbeat-task-${taskId}`,
              kind: "heartbeat-task",
              label: info.taskName,
              personaName: info.personaName,
              elapsedMs: elapsed,
              reason: "orphan in activeTaskTracker (likely worker died mid-task)",
            },
          });
        } catch (_silentErr) { logSilentCatch("server/process-watchdog.ts", _silentErr); }
      }
    }
  } catch (e) { logSilentCatch("server/process-watchdog.ts", e); }
}

/**
 * Boot the periodic watchdog. Idempotent; safe to call multiple times
 * (e.g. from boot recovery + a manual restart).
 */
export function startWatchdog(intervalMs: number = 30_000): void {
  if (watchdogTimer) {
    console.log(`[watchdog] already running (interval=${watchdogIntervalMs}ms)`);
    return;
  }
  watchdogIntervalMs = intervalMs;
  watchdogTimer = setInterval(() => {
    scanOnce().catch(e => console.error(`[watchdog] scan failed:`, e));
  }, watchdogIntervalMs);
  // Don't keep the event loop alive solely for the watchdog
  if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();
  console.log(`[watchdog] started — scanning every ${intervalMs}ms (orphan threshold: ${ORPHAN_HEARTBEAT_TASK_MS / 60_000}m for heartbeat tasks)`);
}

export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/** Test hook — force a scan synchronously without waiting for the next tick. */
export async function forceScanForTest(): Promise<void> {
  await scanOnce();
}

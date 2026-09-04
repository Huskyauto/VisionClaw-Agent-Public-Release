/**
 * Shared, lock-coordinated reader/writer for the jury implementer-pickup queue
 * (`data/jury-decisions/queue.json`).
 *
 * WHY (MEDIUM closed 2026-06-10, Bob-approved): the file is written by FOUR
 * processes on independent schedules — `scripts/jury-triage.ts`,
 * `scripts/agentic-ci-self-heal.ts`, `scripts/tenant-isolation-audit.ts` (all
 * APPEND), and `scripts/drain-jury-queue.ts` (read → stamp `_drained` → write).
 * Each previously did its own unlocked read-modify-write with a tmp+rename. The
 * tmp+rename makes a single write atomic (no partial file) but does NOT serialize
 * two overlapping read-modify-writes: producer A reads, producer B reads, A
 * writes, B writes — B's snapshot never saw A's append, so A's entry is silently
 * lost (last-writer-wins). The drainer is the worst offender: its read→write
 * straddles a slow (minutes-long) captureIncident loop, a wide window for a
 * producer append to be clobbered.
 *
 * FIX: a single dependency-free advisory lock (atomic `mkdir`, with stale-lock
 * breaking) guards EVERY read-modify-write. All four writers route through
 * `appendQueueEntries` / `mutateQueue` here. The lock is held only for the
 * read→write critical section (milliseconds), never across the drainer's slow
 * captureIncident work — the drainer does its slow processing lock-free against
 * an in-memory snapshot, then re-reads UNDER the lock and merges its stamps
 * (`mutateQueue`), so producer appends that landed during the drain survive.
 *
 * Dependency-free on purpose: these run as `npx tsx` CLI scripts; `mkdir` is
 * POSIX-atomic and needs no npm package or DB.
 */
import * as fs from "node:fs";
import { logSilentCatch } from "../lib/silent-catch";
import * as path from "node:path";

export const QUEUE_PATH = path.join("data", "jury-decisions", "queue.json");
/** A lock dir older than this is considered abandoned (holder crashed) and broken. */
const STALE_LOCK_MS = 30_000;
/** Max time to wait to acquire the lock before giving up. */
const ACQUIRE_TIMEOUT_MS = 15_000;
/** Backoff between acquire attempts. */
const RETRY_MS = 40;

const lockDirFor = (queuePath: string) => `${queuePath}.lock`;

/** Synchronous sleep without a busy-spin (these are short-lived CLI scripts). */
function syncSleep(ms: number): void {
  // Atomics.wait blocks the thread for up to `ms` without burning CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockDir: string): void {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockDir); // atomic: throws EEXIST if another writer holds it
      return;
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      // Held by someone else — break it if it's stale (holder crashed mid-write).
      try {
        const ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (ageMs > STALE_LOCK_MS) {
          fs.rmdirSync(lockDir);
          continue; // retry the mkdir immediately
        }
      } catch (_silentErr) { logSilentCatch("server/agentic/jury-queue-store.ts", _silentErr); }
      if (Date.now() > deadline) {
        throw new Error(
          `[jury-queue-store] could not acquire lock ${lockDir} within ${ACQUIRE_TIMEOUT_MS}ms`,
        );
      }
      syncSleep(RETRY_MS);
    }
  }
}

function releaseLock(lockDir: string): void {
  try {
    fs.rmdirSync(lockDir);
  } catch (_silentErr) { logSilentCatch("server/agentic/jury-queue-store.ts", _silentErr); }
}

/** Read the queue with NO lock. Safe for a read-only snapshot; for any
 *  read-modify-write use `appendQueueEntries` / `mutateQueue` instead. */
export function readQueueRaw<T = any>(queuePath: string = QUEUE_PATH): T[] {
  try {
    if (!fs.existsSync(queuePath)) return [];
    const raw = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Atomic single write (caller MUST hold the lock). */
function writeQueueUnlocked(entries: any[], queuePath: string): void {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  const tmp = `${queuePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, queuePath);
}

/** Append entries under the lock. Entries should already be signed by the caller
 *  (`signQueueEntry`) — this layer is integrity-agnostic, it only serializes IO.
 *  `queuePath` is injectable for tests; production always uses the default. */
export function appendQueueEntries(newEntries: any[], queuePath: string = QUEUE_PATH): number {
  if (!newEntries || newEntries.length === 0) return 0;
  const lockDir = lockDirFor(queuePath);
  acquireLock(lockDir);
  try {
    const current = readQueueRaw(queuePath);
    current.push(...newEntries);
    writeQueueUnlocked(current, queuePath);
    return newEntries.length;
  } finally {
    releaseLock(lockDir);
  }
}

/** Run `fn` against a FRESHLY-read-under-lock queue, then persist the (possibly
 *  mutated) array atomically. The whole read→mutate→write happens inside the
 *  lock, so it never races a concurrent producer append. `fn` must be fast and
 *  side-effect-free w.r.t. the file (do slow work BEFORE calling this). Returns
 *  whatever `fn` returns. `queuePath` is injectable for tests. */
export function mutateQueue<R>(fn: (entries: any[]) => R, queuePath: string = QUEUE_PATH): R {
  const lockDir = lockDirFor(queuePath);
  acquireLock(lockDir);
  try {
    const entries = readQueueRaw(queuePath);
    const result = fn(entries);
    writeQueueUnlocked(entries, queuePath);
    return result;
  } finally {
    releaseLock(lockDir);
  }
}

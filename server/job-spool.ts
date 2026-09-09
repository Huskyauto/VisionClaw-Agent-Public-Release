// R60.B — Enqueue-failure durability spool.
//
// Background: `enqueueJob` writes to Postgres. If the DB is down at the
// moment a caller tries to schedule work (network blip, failover, brief
// pool exhaustion), the INSERT throws and the work is lost — we logged
// it but never re-tried. That defeats the whole point of the queue.
//
// This spool is a simple filesystem-backed fallback:
//   - Call `enqueueJobDurable(kind, payload, opts)` instead of `enqueueJob`.
//   - If the INSERT succeeds, nothing changes.
//   - If the INSERT throws, we write the payload to `.job-spool/<ts>-<rand>.json`
//     and return a sentinel id of -1 (caller should treat as "queued but
//     not yet durable").
//   - The drainer runs on boot and every 5 min: it reads each spool file,
//     tries `enqueueJob`, and deletes the file on success.
//
// Poison-pill handling: the FIFO drain stops on the first *transient*
// error (DB still down → don't hammer it → retry next pass). But files
// whose content is permanently broken (bad JSON, missing fields) would
// block every newer file forever — classic head-of-line starvation. So
// permanent-content errors quarantine the offending file to
// `.job-spool/.quarantine/` (for manual triage) and the drain continues.
//
// Capacity: bounded at MAX_SPOOL_FILES to prevent runaway disk growth if
// the DB stays down for hours. Writes are serialized through an in-process
// mutex (spoolLock) so the count/write sequence is atomic for this
// process; this closes the TOCTOU race where concurrent callers could
// both pass the cap check.
//
// Security: spooled files contain raw payloads at rest on the container's
// local filesystem. This is acceptable for the current call sites
// (research metadata) but callers spooling PII/secrets/tokens should
// encrypt the payload before enqueueing, OR route around the spool (the
// DB already has retention controls the filesystem does not).
//
// This is deliberately file-based (not in-memory): it must survive a
// process crash that happens during the DB outage.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EnqueueOpts } from "./job-queue";

import { logSilentCatch } from "./lib/silent-catch";
const SPOOL_DIR = path.join(process.cwd(), ".job-spool");
const QUARANTINE_DIR = path.join(SPOOL_DIR, ".quarantine");
const MAX_SPOOL_FILES = 1000;
const DRAIN_INTERVAL_MS = 5 * 60 * 1000;

let drainTimer: NodeJS.Timeout | null = null;
let draining = false;

// Serialize spoolJob calls so countSpoolFiles()→write is atomic per process.
// Node is single-threaded but awaits yield — without this, two in-flight
// spool calls can both observe count=999 and both write, overshooting the cap.
let spoolLock: Promise<void> = Promise.resolve();

interface SpooledJob {
  kind: string;
  payload: Record<string, any>;
  opts: EnqueueOpts;
  spooledAt: string;
}

async function ensureSpoolDir(): Promise<void> {
  try {
    await fs.mkdir(SPOOL_DIR, { recursive: true });
  } catch (_silentErr) { logSilentCatch("server/job-spool.ts", _silentErr); }
}

async function ensureQuarantineDir(): Promise<void> {
  try {
    await fs.mkdir(QUARANTINE_DIR, { recursive: true });
  } catch (_silentErr) { logSilentCatch("server/job-spool.ts", _silentErr); }
}

/** Count current spool files (bounded enumeration for the MAX_SPOOL_FILES check). */
async function countSpoolFiles(): Promise<number> {
  try {
    const entries = await fs.readdir(SPOOL_DIR);
    return entries.filter((e) => e.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Move a permanently-unprocessable file out of the drain path so it
 * doesn't block every newer file in FIFO order. Kept on disk (not
 * deleted) so an operator can inspect and, if desired, hand-repair.
 */
async function quarantineFile(filename: string, reason: string): Promise<void> {
  await ensureQuarantineDir();
  const src = path.join(SPOOL_DIR, filename);
  const dst = path.join(QUARANTINE_DIR, filename);
  try {
    await fs.rename(src, dst);
    // Drop a breadcrumb next to it explaining why.
    await fs.writeFile(`${dst}.reason.txt`, reason, "utf8").catch(() => {});
    console.error(`[job-spool] QUARANTINED ${filename}: ${reason}`);
  } catch (err) {
    console.error(
      `[job-spool] Failed to quarantine ${filename}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Write a job to the filesystem spool. Called only by `enqueueJobDurable`
 * on DB-enqueue failure. Throws if the spool is at capacity so the caller
 * learns about the problem rather than silently dropping.
 */
export async function spoolJob(
  kind: string,
  payload: Record<string, any>,
  opts: EnqueueOpts = {},
): Promise<string> {
  // Serialize through the in-process mutex so the count check and the
  // rename-into-place are atomic w.r.t. other spool calls in this process.
  // Without this, concurrent callers can both observe count < cap and both
  // land, overshooting the bound.
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const prev = spoolLock;
  spoolLock = next;
  await prev;
  try {
    await ensureSpoolDir();
    const count = await countSpoolFiles();
    if (count >= MAX_SPOOL_FILES) {
      throw new Error(
        `[job-spool] Spool full (${count}/${MAX_SPOOL_FILES}) — DB appears down for an extended period; refusing to spool new job kind=${kind}`,
      );
    }
    const record: SpooledJob = {
      kind,
      payload,
      opts,
      spooledAt: new Date().toISOString(),
    };
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.json`;
    const full = path.join(SPOOL_DIR, filename);
    // Atomic write: write to .tmp, fsync, then rename, so a crash mid-write
    // never leaves a half-written JSON file for the drainer to choke on.
    // R98.16 #6 — fsync the .tmp before rename so a power loss between rename
    // and pagecache-flush can't leave an empty file.
    const tmp = `${full}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record), "utf8");
    try {
      const fh = await fs.open(tmp, "r+");
      try { await fh.sync(); } finally { await fh.close(); }
    } catch (_silentErr) { logSilentCatch("server/job-spool.ts", _silentErr); }
    await fs.rename(tmp, full);
    return filename;
  } finally {
    release();
  }
}

/**
 * Drain the spool: for each file, try to enqueue it via the real queue.
 * On success, delete the file. On failure, leave it for the next pass.
 *
 * Exposed with an injectable `enqueueFn` so tests can exercise the drainer
 * without a real database.
 */
export async function drainSpool(
  enqueueFn?: (kind: string, payload: Record<string, any>, opts?: EnqueueOpts) => Promise<number>,
): Promise<{ drained: number; remaining: number; errors: number }> {
  if (draining) return { drained: 0, remaining: 0, errors: 0 };
  draining = true;
  try {
    await ensureSpoolDir();
    const entries = await fs.readdir(SPOOL_DIR);
    const files = entries.filter((e) => e.endsWith(".json")).sort(); // FIFO by name (timestamp prefix)
    if (files.length === 0) return { drained: 0, remaining: 0, errors: 0 };

    // Lazy-resolve the real enqueue function. Dynamic import avoids pulling
    // the DB module into contexts that only need spooling (tests).
    let realEnqueue = enqueueFn;
    if (!realEnqueue) {
      const mod = await import("./job-queue");
      realEnqueue = mod.enqueueJob;
    }

    let drained = 0;
    let errors = 0;
    let quarantined = 0;
    for (const f of files) {
      const full = path.join(SPOOL_DIR, f);

      // Phase 1: read + parse. Failure here is PERMANENT (content-level):
      // the file will never successfully drain, so quarantine it and move
      // on. This prevents head-of-line starvation by a poison-pill file.
      let rec: SpooledJob;
      try {
        const raw = await fs.readFile(full, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
          throw new Error("missing required field 'kind'");
        }
        rec = parsed as SpooledJob;
      } catch (parseErr) {
        await quarantineFile(
          f,
          `unparseable spool file: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
        quarantined++;
        continue; // keep draining newer files
      }

      // Phase 2: enqueue. Failure here is TRANSIENT (DB down): stop the
      // whole drain and retry next pass, to avoid hammering an outage.
      try {
        await realEnqueue(rec.kind, rec.payload, rec.opts);
        await fs.unlink(full);
        drained++;
      } catch (err) {
        errors++;
        console.error(
          `[job-spool] Drain of ${f} failed (will retry next pass):`,
          err instanceof Error ? err.message : String(err),
        );
        break;
      }
    }
    const remaining = files.length - drained - quarantined;
    if (drained > 0 || quarantined > 0) {
      console.log(
        `[job-spool] Drained ${drained}, quarantined ${quarantined}, ${remaining} remaining`,
      );
    }
    return { drained, remaining, errors };
  } finally {
    draining = false;
  }
}

/**
 * Wrap `enqueueJob` with filesystem fallback. Caller gets a best-effort
 * guarantee: either the job is in the DB (real id returned) or in the
 * on-disk spool (returns -1). Only a double failure (DB down AND spool
 * full/unwritable) throws.
 */
export async function enqueueJobDurable(
  kind: string,
  payload: Record<string, any>,
  opts: EnqueueOpts = {},
): Promise<number> {
  try {
    const { enqueueJob } = await import("./job-queue");
    return await enqueueJob(kind, payload, opts);
  } catch (dbErr) {
    console.warn(
      `[job-spool] DB enqueue failed for kind=${kind}, spooling to disk:`,
      dbErr instanceof Error ? dbErr.message : String(dbErr),
    );
    await spoolJob(kind, payload, opts);
    return -1;
  }
}

/** Idempotently start the background drainer (boot + every 5 min). */
export function startSpoolDrainer(): void {
  if (drainTimer) return;
  // Boot pass: drain anything left from the previous process.
  drainSpool().catch((e) =>
    console.error("[job-spool] Boot drain failed:", e instanceof Error ? e.message : String(e)),
  );
  drainTimer = setInterval(() => {
    drainSpool().catch((e) =>
      console.error("[job-spool] Periodic drain failed:", e instanceof Error ? e.message : String(e)),
    );
  }, DRAIN_INTERVAL_MS);
  if ((drainTimer as any).unref) (drainTimer as any).unref();
  console.log(`[job-spool] Drainer started (interval=${DRAIN_INTERVAL_MS}ms, max=${MAX_SPOOL_FILES} files)`);
}

/** For tests / graceful shutdown. */
export function stopSpoolDrainer(): void {
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

/** For tests — expose dir so cleanup can wipe it. */
export function getSpoolDir(): string {
  return SPOOL_DIR;
}

// R98.16 #6 — Atomic write helpers that actually deliver on their durability
// promise. Many of our atomic-write call sites had the .tmp + rename pattern
// (which protects against partial reads) but no fsync (which means a power
// loss / kernel panic between rename and disk-flush can still leave you with
// an empty file because the rename hit the directory inode but the data
// blocks for the .tmp file never made it out of pagecache).
//
// Inspired by an IJFW commit that fixed the same gap. Reference impl already
// lived in server/compaction.ts; this file just makes it reusable.
//
// Use these wherever you persist crash-critical state to disk:
//   - job spool (server/job-spool.ts)
//   - dormant-tools state (server/dormant-deprecation.ts)
//   - code-health checkpoint (server/code-health.ts)
//   - video-job state (server/video-job-runner.ts)
//   - skills manifest + installed-skill files (scripts/skills-registry.ts)
//   - research-engine code-proposal applies (server/research-engine.ts)

import * as fs from "node:fs";
import { logSilentCatch } from "./silent-catch";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

export interface AtomicWriteOpts {
  mode?: number;          // file mode (e.g. 0o600)
  fsyncDir?: boolean;     // also fsync the parent dir (default: true on POSIX)
}

/**
 * Synchronous atomic write: write to .tmp, fsync, rename, optionally fsync dir.
 * After this returns, the file is guaranteed to be on disk (modulo hardware
 * write caches) — no partial-content window, no rename-without-data window.
 */
export function atomicWriteFileSync(
  targetPath: string,
  data: string | Buffer,
  opts: AtomicWriteOpts = {},
): void {
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const writeFlags = opts.mode != null ? { mode: opts.mode } : {};
  fs.writeFileSync(tmp, data, writeFlags);
  // fsync the .tmp file before rename so the data is durable.
  try {
    const fd = fs.openSync(tmp, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, targetPath);
  } catch (e) {
    // R98.16+sec — architect LOW fix: best-effort tmp cleanup so a failed
    // rename / fsync doesn't leak .tmp.<pid>.<ts>.<rand> turds into the
    // target dir. Re-throw the original error so callers see the failure.
    try { fs.unlinkSync(tmp); } catch (_silentErr) { logSilentCatch("server/lib/atomic-write.ts", _silentErr); }
    throw e;
  }
  // fsync the parent dir so the rename itself is durable. Best-effort —
  // some filesystems (or Windows) don't allow fsync on a dir fd.
  if (opts.fsyncDir !== false && process.platform !== "win32") {
    try {
      const dirFd = fs.openSync(path.dirname(targetPath), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_silentErr) { logSilentCatch("server/lib/atomic-write.ts", _silentErr); }
  }
}

/**
 * Async variant. Same semantics, uses fs.promises throughout.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Buffer,
  opts: AtomicWriteOpts = {},
): Promise<void> {
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const writeFlags = opts.mode != null ? { mode: opts.mode } : {};
  await fsp.writeFile(tmp, data, writeFlags);
  try {
    const fh = await fsp.open(tmp, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, targetPath);
  } catch (e) {
    // R98.16+sec — best-effort tmp cleanup; re-throw the original error.
    try { await fsp.unlink(tmp); } catch (_silentErr) { logSilentCatch("server/lib/atomic-write.ts", _silentErr); }
    throw e;
  }
  if (opts.fsyncDir !== false && process.platform !== "win32") {
    try {
      const dh = await fsp.open(path.dirname(targetPath), "r");
      try { await dh.sync(); } finally { await dh.close(); }
    } catch (_silentErr) { logSilentCatch("server/lib/atomic-write.ts", _silentErr); }
  }
}

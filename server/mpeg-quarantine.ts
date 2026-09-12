/**
 * mpeg-quarantine.ts — extracted from mpeg-engine.ts (Task 104 girth split,
 * 2026-07-31; mechanical move, zero behavior change). The failed-job
 * quarantine + retention sweeper: failed render dirs are moved (not deleted)
 * to data/video-jobs-failed for post-mortem, then pruned by age + total-bytes
 * caps. mpeg-engine.ts re-exports the public names so importers are unchanged.
 */

import * as fs from "fs";
import * as path from "path";
import { logSilentCatch } from "./lib/silent-catch";

const FAILED_ROOT = path.resolve(process.cwd(), "data", "video-jobs-failed");
const FAILED_RETAIN_MS = (parseInt(process.env.VIDEO_FAILED_RETAIN_DAYS || "14", 10) || 14) * 24 * 3600 * 1000;
const FAILED_RETAIN_BYTES = parseInt(process.env.VIDEO_FAILED_RETAIN_BYTES || "", 10) || (5 * 1024 * 1024 * 1024);

export function quarantineJobDir(jobDir: string, reason: string): void {
  try {
    if (!fs.existsSync(FAILED_ROOT)) fs.mkdirSync(FAILED_ROOT, { recursive: true });
    const safe = (reason || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
    // R111.2 architect fix — EEXIST retry. Append a random suffix so the
    // (vanishingly unlikely) ms-collision case still preserves forensics
    // instead of falling back to rm.
    let dest = path.join(FAILED_ROOT, `${path.basename(jobDir)}__${safe}__${Date.now()}`);
    if (fs.existsSync(dest)) {
      dest = `${dest}_${Math.random().toString(36).slice(2, 8)}`;
    }
    fs.renameSync(jobDir, dest);
    console.log(`[mpeg-engine] quarantined failed job: ${jobDir} → ${dest}`);
  } catch (renameErr: any) {
    console.warn(`[mpeg-engine] quarantine failed (${renameErr?.message?.slice(0, 80)}); falling back to rm`);
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_e) { logSilentCatch("server/mpeg-engine.ts:quarantine-fallback", _e); }
  }
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      try {
        const st = fs.statSync(p);
        total += ent.isDirectory() ? dirSizeBytes(p) : st.size;
      } catch (_e) { logSilentCatch("server/mpeg-engine.ts", _e); }
    }
  } catch (_e) { logSilentCatch("server/mpeg-engine.ts", _e); }
  return total;
}

// Periodic retention sweep over data/video-jobs-failed/. Prunes by age (>14d
// default) AND by total bytes (>5GiB default), oldest first. Best-effort:
// never throws. Logs counts so disk-growth pressure is visible before outage.
export function pruneQuarantinedJobs(): { deleted: number; bytesFreed: number; remaining: number; remainingBytes: number } {
  if (!fs.existsSync(FAILED_ROOT)) return { deleted: 0, bytesFreed: 0, remaining: 0, remainingBytes: 0 };
  let entries: { path: string; mtimeMs: number; size: number }[] = [];
  try {
    for (const name of fs.readdirSync(FAILED_ROOT)) {
      const p = path.join(FAILED_ROOT, name);
      try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) continue;
        entries.push({ path: p, mtimeMs: st.mtimeMs, size: dirSizeBytes(p) });
      } catch (_e) { logSilentCatch("server/mpeg-engine.ts", _e); }
    }
  } catch (_e) { return { deleted: 0, bytesFreed: 0, remaining: 0, remainingBytes: 0 }; }
  const now = Date.now();
  let deleted = 0, bytesFreed = 0;
  // Phase 1: age-based eviction
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const survivors: typeof entries = [];
  for (const e of entries) {
    if ((now - e.mtimeMs) > FAILED_RETAIN_MS) {
      try { fs.rmSync(e.path, { recursive: true, force: true }); deleted++; bytesFreed += e.size; }
      catch (err: any) { console.warn(`[mpeg-engine] quarantine prune (age) failed for ${e.path}: ${err?.message?.slice(0, 80)}`); survivors.push(e); }
    } else {
      survivors.push(e);
    }
  }
  // Phase 2: total-bytes eviction (oldest-first)
  let totalBytes = survivors.reduce((s, e) => s + e.size, 0);
  while (totalBytes > FAILED_RETAIN_BYTES && survivors.length > 0) {
    const e = survivors.shift()!;
    try { fs.rmSync(e.path, { recursive: true, force: true }); deleted++; bytesFreed += e.size; totalBytes -= e.size; }
    catch (err: any) { console.warn(`[mpeg-engine] quarantine prune (size) failed for ${e.path}: ${err?.message?.slice(0, 80)}`); break; }
  }
  if (deleted > 0) console.log(`[mpeg-engine] quarantine prune: deleted ${deleted} dir(s), freed ${(bytesFreed / 1024 / 1024).toFixed(1)}MB; ${survivors.length} remaining (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
  return { deleted, bytesFreed, remaining: survivors.length, remainingBytes: totalBytes };
}

let quarantineSweeperArmed = false;
export function armQuarantineRetentionSweeper(): void {
  if (quarantineSweeperArmed) return;
  quarantineSweeperArmed = true;
  // Run once at boot so a long-overdue prune doesn't wait 6h after deploy.
  try { pruneQuarantinedJobs(); } catch (_e) { logSilentCatch("server/mpeg-engine.ts:initial-prune", _e); }
  setInterval(() => { try { pruneQuarantinedJobs(); } catch (_e) { logSilentCatch("server/mpeg-engine.ts:periodic-prune", _e); } }, 6 * 3600 * 1000).unref();
}

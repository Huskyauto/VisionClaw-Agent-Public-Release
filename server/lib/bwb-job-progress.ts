// Built With Bob — weekly-recap live progress writer for the video_jobs table.
//
// The weekly recap (`bwb_weekly_build`) is fire-and-forget AND renders on the
// GitHub Actions farm, so it historically never wrote a `video_jobs` row — which
// meant /api/video-jobs/active returned nothing and the chat heartbeat banner +
// /jobs popup stayed empty for the whole multi-minute build. This module is the
// fix: a tiny DB-only writer the tool (server process) and the build/render
// subprocesses all call to keep ONE row live with a phase line + per-chapter
// glyphs.
//
// HARD RULES baked in here:
//   - Every write is NEVER-THROW (logSilentCatch). Progress reporting must never
//     break the actual video build.
//   - Every write bumps updated_at = a heartbeat against the 20-min stale-job
//     reaper in video-job-runner.ts (recoverStaleVideoJobs). The pre-dispatch
//     image-bake + audio loops can run many minutes with no other DB write, so
//     the farm calls setBwbPhase on each scene to keep the row warm.
//   - Subprocess callers (build-bwb-weekly.ts, bwb-render-github.ts) read the job
//     id from BWB_JOB_ID and the tenant from BWB_TENANT_ID (threaded through the
//     spawn chain). When BWB_JOB_ID is unset every call is a safe no-op, so the
//     scripts can call these unconditionally.
import crypto from "node:crypto";
import { db } from "../db";
import { videoJobs } from "@shared/schema";
import { and, eq, ne } from "drizzle-orm";
import { logSilentCatch } from "./silent-catch";

const JOB_ID_RE = /^vj_[a-z0-9_]{8,80}$/;

// Hard cap on every DB call below so a slow/hung pool can never stall the actual
// video build (the writes are advisory progress, not the deliverable). The query
// keeps running server-side after the race resolves, so a slightly-slow write
// still usually lands; we just stop AWAITING it past the cap.
const DB_TIMEOUT_MS = 6000;

export interface BwbChapterRow {
  idx: number; // 0-based
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
}

/** Mint a job id in the exact format the video-job-runner uses (vj_<base36>_<hex>). */
export function newBwbJobId(): string {
  return `vj_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function envJobId(explicit?: string): string | null {
  const id = explicit || process.env.BWB_JOB_ID;
  return id && JOB_ID_RE.test(id) ? id : null;
}

/** Tenant from BWB_TENANT_ID (threaded through the spawn chain). null = unknown. */
function envTenantId(explicit?: number): number | null {
  const raw = typeof explicit === "number" ? explicit : Number(process.env.BWB_TENANT_ID);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Race any DB promise against DB_TIMEOUT_MS so a hung pool can't block the build. */
function raceDb<T>(p: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    p,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), DB_TIMEOUT_MS).unref?.()),
  ]);
}

/**
 * Build the live-row WHERE: always pin jobId; additionally pin tenantId when it is
 * known (defense-in-depth tenant scoping — a progress write must only ever touch
 * its own tenant's row). `notDone`/`notFailed` keep late writes from resurrecting
 * a finished row.
 */
let warnedMissingTenant = false;
function scope(jobId: string, opts?: { notDone?: boolean; notFailed?: boolean; tenantId?: number }) {
  const clauses = [eq(videoJobs.jobId, jobId)];
  const tid = envTenantId(opts?.tenantId);
  if (tid) clauses.push(eq(videoJobs.tenantId, tid));
  else if (!warnedMissingTenant) {
    // Defense-in-depth: writes are already pinned to an unguessable random jobId
    // (vj_<base36>_<6-byte-hex>), so a cross-tenant write is practically
    // impossible — but the tenant predicate is dropped here, so make the missing
    // BWB_TENANT_ID threading observable instead of silently fail-open. Warn once.
    warnedMissingTenant = true;
    console.warn("[bwb-job-progress] BWB_TENANT_ID missing — progress writes pinned to jobId only (no tenant predicate). Thread BWB_TENANT_ID through the spawn chain to restore tenant-scoped writes.");
  }
  if (opts?.notDone) clauses.push(ne(videoJobs.status, "done"));
  if (opts?.notFailed) clauses.push(ne(videoJobs.status, "failed"));
  return and(...clauses);
}

/**
 * Create the live row BEFORE the build is spawned. Idempotent (onConflictDoNothing)
 * so a retry can't duplicate. tenantId is required (no default per the hard rule).
 */
export async function createBwbJob(args: {
  jobId: string;
  tenantId: number;
  title?: string;
  phase?: string;
}): Promise<void> {
  try {
    if (!envJobId(args.jobId)) return;
    if (!Number.isFinite(args.tenantId) || args.tenantId <= 0) return;
    const now = new Date();
    await raceDb(db
      .insert(videoJobs)
      .values({
        jobId: args.jobId,
        tenantId: args.tenantId,
        title: args.title || "Built With Bob — Weekly Recap",
        status: "rendering",
        phase: args.phase || "Starting weekly recap build…",
        totalChapters: 0,
        chapters: [],
        spec: { kind: "bwb_weekly_recap" },
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing());
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:createBwbJob", e);
  }
}

/**
 * Update the phase line (and optionally title / status / total-chapter count).
 * Always bumps updated_at = heartbeat. No-op if the job is already finished, so a
 * late progress write can't resurrect a done/failed row.
 */
export async function setBwbPhase(
  phase: string,
  extra?: { jobId?: string; title?: string; status?: string; totalChapters?: number },
): Promise<void> {
  try {
    const jobId = envJobId(extra?.jobId);
    if (!jobId) return;
    const set: Record<string, unknown> = { phase, updatedAt: new Date() };
    if (extra?.title) set.title = extra.title;
    if (extra?.status) set.status = extra.status;
    if (typeof extra?.totalChapters === "number") set.totalChapters = extra.totalChapters;
    await raceDb(db
      .update(videoJobs)
      .set(set)
      .where(scope(jobId, { notDone: true, notFailed: true })));
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:setBwbPhase", e);
  }
}

/**
 * Replace the per-chapter glyph array (optionally also phase + total). Bumps
 * updated_at. No-op once the job is finished.
 */
export async function updateBwbChapters(
  chapters: BwbChapterRow[],
  extra?: { jobId?: string; phase?: string; totalChapters?: number },
): Promise<void> {
  try {
    const jobId = envJobId(extra?.jobId);
    if (!jobId) return;
    if (!Array.isArray(chapters)) return;
    const set: Record<string, unknown> = { chapters, updatedAt: new Date() };
    if (extra?.phase) set.phase = extra.phase;
    if (typeof extra?.totalChapters === "number") set.totalChapters = extra.totalChapters;
    else set.totalChapters = chapters.length;
    await raceDb(db
      .update(videoJobs)
      .set(set)
      .where(scope(jobId, { notDone: true, notFailed: true })));
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:updateBwbChapters", e);
  }
}

/**
 * Mark the job done. Sets final file/Drive links so the banner's "ready to watch"
 * tile can sign a self-hosted Watch/Download URL from finalFilePath and surface
 * the Drive link. Marks every chapter done for a clean glyph row.
 */
export async function completeBwbJob(args: {
  jobId?: string;
  filePath?: string | null;
  finalDriveUrl?: string | null;
  title?: string;
}): Promise<void> {
  try {
    const jobId = envJobId(args.jobId);
    if (!jobId) return;
    const now = new Date();
    const set: Record<string, unknown> = {
      status: "done",
      phase: "Done — ready to watch",
      updatedAt: now,
      completedAt: now,
    };
    if (args.filePath) set.finalFilePath = args.filePath;
    if (args.finalDriveUrl) set.finalDriveUrl = args.finalDriveUrl;
    if (args.title) set.title = args.title;
    // Flip all chapter glyphs to done for a clean finished row.
    const rows = (await raceDb(db
      .select({ chapters: videoJobs.chapters })
      .from(videoJobs)
      .where(scope(jobId))
      .limit(1))) || [];
    const cur = (rows[0]?.chapters as BwbChapterRow[] | undefined) || [];
    if (Array.isArray(cur) && cur.length) {
      set.chapters = cur.map((c) => ({ ...c, status: "done" as const }));
    }
    // No notDone/notFailed guard here: a genuine successful build must be able to
    // flip a row the 20-min reaper prematurely marked "failed" back to done.
    await raceDb(db.update(videoJobs).set(set).where(scope(jobId)));
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:completeBwbJob", e);
  }
}

/**
 * Bump updated_at only (no phase/chapter change) so a long phase that has no other
 * DB write — e.g. multi-clip transcription or LLM script-writing — keeps the row
 * warm against the 20-min stale-job reaper. No-op once the job is finished.
 * Intended to be driven on a timer by the build subprocess; see build-bwb-weekly.
 */
export async function bumpBwbHeartbeat(jobIdArg?: string): Promise<void> {
  try {
    const jobId = envJobId(jobIdArg);
    if (!jobId) return;
    await raceDb(db
      .update(videoJobs)
      .set({ updatedAt: new Date() })
      .where(scope(jobId, { notDone: true, notFailed: true })));
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:bumpBwbHeartbeat", e);
  }
}

/**
 * Mark the job failed. Never clobbers a row that already reached done — a build
 * that delivered then hit a non-fatal post-step shouldn't show as failed.
 */
export async function failBwbJob(errorMessage: string, jobIdArg?: string): Promise<void> {
  try {
    const jobId = envJobId(jobIdArg);
    if (!jobId) return;
    const now = new Date();
    await raceDb(db
      .update(videoJobs)
      .set({
        status: "failed",
        phase: "Failed",
        errorMessage: (errorMessage || "weekly recap build failed").slice(0, 2000),
        updatedAt: now,
        completedAt: now,
      })
      .where(scope(jobId, { notDone: true })));
  } catch (e) {
    logSilentCatch("server/lib/bwb-job-progress.ts:failBwbJob", e);
  }
}

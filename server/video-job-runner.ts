// R98.14 W1.3+W1.4 — Background per-chapter video jobs with resumable concat.
// The fix for "Felix kicks off a 12-min video, the chat turn ends after 10 min,
// the render dies half-done." Each video is now a long-lived JOB on disk:
// chapters render in the background, state is persisted to disk, and the final
// concat is a separate idempotent step Felix can re-run if it fails.
//
// Lifecycle:
//   start_video_job   → returns {job_id} immediately; renders chapters in BG
//   check_video_job   → poll-able status with per-chapter progress
//   finalize_video    → concat completed chapter files into final MP4 (idempotent;
//                       re-running just re-concats — chapters already on disk)

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logSilentCatch } from "./lib/silent-catch";
import { produceVideo, concatenateClips, type MpegScene, type ChapterSpec } from "./mpeg-engine";
import { db } from "./db";
import { videoJobs } from "@shared/schema";
import { eq, and, inArray, lt, sql as dsql } from "drizzle-orm";

// R111 architect fix — process-unique instance marker. Generated once at module
// load. Every DB mirror write stamps this; boot recovery + periodic sweeper
// fail any active row carrying a DIFFERENT instance_id, deterministically
// catching restart-orphans regardless of how recently they were updated.
const RUNNER_INSTANCE_ID = `${process.pid}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

const JOBS_ROOT = path.resolve(process.cwd(), "data", "video-jobs");
// R112.4 — was 5min. Real-world measurement on prod Autoscale: a 5-scene
// chapter with sequential gpt-image-2 bakes (~25s each = 125s) + parallel
// TTS (~30s for 5 voices) + ffmpeg encode (~60s) + crossfade (~30s) lands
// around 4-5min on a good run, but spikes to 6-7min when image-gen rate
// limits hit. 300s budget tripped Bob's R112.3 video on chapter 1. Bumped
// to 8min — comfortably above p95 measured render time, still well below
// the 10min stale-job recovery cutoff in recoverStaleVideoJobs (so a
// genuinely hung chapter still gets killed).
const PER_CHAPTER_TIMEOUT_MS = 15 * 60 * 1000;    // 15 min per chapter (R112.12 — OpenAI TTS is meaningfully slower than Fish; dense narration + image gen + encode needs the headroom)
// R110.22 INCIDENT FIX: dropped 2 → 1 default after prod hung mid-render
// on Bob's first 3-chapter / 12-scene video. Even with R110.21's async
// ffmpeg spawn, 2 in-flight chapters multiplied per-chapter parallelism
// (4-wide TTS + 4-wide image gen + ffmpeg encode) into 8+8+ffmpeg of
// concurrent work, which pegged the Reserved VM until HTTP stopped
// answering. With 1 chapter at a time, the VM still does 4-wide TTS
// inside a chapter (well inside Fish/OpenAI tolerance) and one ffmpeg
// at a time. A 3-chapter video is now ~3× wall-clock vs the old 1.5×,
// but it actually FINISHES instead of hanging the whole app.
// Override via env (VIDEO_MAX_PARALLEL_CHAPTERS=2) if a beefier
// deployment can take it; cap is still 8.
const MAX_PARALLEL_CHAPTERS = Math.max(1, Math.min(8, Number(process.env.VIDEO_MAX_PARALLEL_CHAPTERS) || 1));
// Architect CRITICAL fix: job_id is caller-controlled in check_video_job /
// finalize_video. We MUST validate it against a strict regex before letting it
// touch path.join — otherwise ".." segments escape JOBS_ROOT and the caller
// could read or concat arbitrary files. Format matches what newJobId() emits.
const JOB_ID_RE = /^vj_[a-z0-9_]{8,80}$/;
function isValidJobId(jobId: string): boolean { return typeof jobId === "string" && JOB_ID_RE.test(jobId); }
// Architect CRITICAL fix: jobs (especially failed ones with chapter MP4s on
// disk) accumulate forever without a sweeper. Sweep on every startVideoJob
// call (cheap; runs at most once per job creation) — delete job dirs older
// than this TTL regardless of status. Successful jobs keep the final concat
// in project-assets, not in the job dir, so this is safe.
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days

export type VideoJobStatus = "queued" | "rendering" | "ready_to_concat" | "concating" | "done" | "failed";

export interface VideoJobChapterState {
  idx: number;                    // 0-based
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
  file_path?: string;             // on-disk MP4 once done
  duration_sec?: number;
  error?: string;
  started_at?: number;
  completed_at?: number;
  attempts: number;
}

export interface VideoJobState {
  job_id: string;
  tenant_id: number;
  title: string;
  status: VideoJobStatus;
  total_chapters: number;
  chapters: VideoJobChapterState[];
  spec: {
    voice?: string;
    voiceProvider?: string;
    strictVoice?: boolean;
    resolution?: string;
    fps?: number;
    transition?: string;
    crossfadeMs?: number;
    kenBurns?: boolean;
    kenBurnsIntensity?: number;
    backgroundMusicPath?: string;
    uploadToDrive?: boolean;
    emailTo?: string;
    projectId?: number;
    _projectDriveFolderId?: string;
    // R112 — auto-finalize + auto-deliver hooks. Set by build_video_from_brief
    // and (R112.16) by the start_video_job tool dispatch when persona forwards
    // them. autoDeliveryAttempted is a one-shot guard against double-delivery.
    autoFinalize?: boolean;
    autoDeliver?: boolean;
    customerName?: string;
    customerEmail?: string;
    autoDeliveryAttempted?: boolean;
  };
  created_at: number;
  updated_at: number;
  final_file_path?: string;
  final_drive_url?: string;
  final_size_bytes?: number;
  final_duration_sec?: number;
  concat_attempts: number;
  last_concat_error?: string;
}

function ensureDir(p: string): void { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function jobDir(jobId: string): string { return path.join(JOBS_ROOT, jobId); }
function statePath(jobId: string): string { return path.join(jobDir(jobId), "state.json"); }
function chapterPath(jobId: string, idx: number): string { return path.join(jobDir(jobId), "chapters", `chapter_${String(idx + 1).padStart(3, "0")}.mp4`); }

// Atomic write — write to .tmp then rename, so a crashed write never leaves a
// partial JSON that corrupts the job state.
function writeStateAtomic(state: VideoJobState): void {
  ensureDir(jobDir(state.job_id));
  const tmp = statePath(state.job_id) + ".tmp";
  state.updated_at = Date.now();
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  // R98.16 #6 — fsync before rename so a crash during a long video render
  // can't leave an empty job-state file (which would orphan the chapter MP4s).
  try {
    const fd = fs.openSync(tmp, "r+");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (_silentErr) { logSilentCatch("server/video-job-runner.ts", _silentErr); }
  fs.renameSync(tmp, statePath(state.job_id));
  // R111 — mirror to DB so /jobs dashboard + heartbeat banner can query it
  // without touching disk, AND so a process restart can mark the job failed
  // instead of silently orphaning it. Fire-and-forget; disk remains source
  // of truth for the binaries.
  void mirrorStateToDb(state).catch((_e) => logSilentCatch("video-job-runner:db-mirror", _e));
}

// R111 — DB mirror. Upsert the job-state row keyed on jobId. Spec is sliced
// (drop _projectDriveFolderId — purely internal) and chapters are stored as
// jsonb. Cancel flag is read separately so we DON'T overwrite it from a stale
// in-memory state.
async function mirrorStateToDb(state: VideoJobState): Promise<void> {
  const completedAt = (state.status === "done" || state.status === "failed") ? new Date(state.updated_at) : null;
  const errMsg = state.last_concat_error || state.chapters.find((c) => c.status === "failed")?.error || null;
  const row = {
    jobId: state.job_id,
    tenantId: state.tenant_id,
    title: state.title,
    status: state.status,
    totalChapters: state.total_chapters,
    chapters: state.chapters as any,
    spec: state.spec as any,
    finalFilePath: state.final_file_path || null,
    finalDriveUrl: state.final_drive_url || null,
    finalWatchUrl: null as string | null,
    finalDurationSec: state.final_duration_sec ?? null,
    finalSizeBytes: state.final_size_bytes ?? null,
    errorMessage: errMsg,
    concatAttempts: state.concat_attempts,
    instanceId: RUNNER_INSTANCE_ID,
    createdAt: new Date(state.created_at),
    updatedAt: new Date(state.updated_at),
    completedAt,
  };
  // R111 architect fix — monotonic guard: only update when incoming updatedAt
  // is >= existing. Drizzle's onConflictDoUpdate `where` clause filters on the
  // existing row, preventing out-of-order fire-and-forget mirrors from
  // regressing the DB to stale state. (Disk state.json is already monotonic
  // because writeStateAtomic is synchronous in the runner; the race is only
  // between the async DB mirrors that follow it.)
  await db.insert(videoJobs).values(row).onConflictDoUpdate({
    target: videoJobs.jobId,
    set: {
      status: row.status,
      totalChapters: row.totalChapters,
      chapters: row.chapters,
      spec: row.spec,
      finalFilePath: row.finalFilePath,
      finalDriveUrl: row.finalDriveUrl,
      finalDurationSec: row.finalDurationSec,
      finalSizeBytes: row.finalSizeBytes,
      errorMessage: row.errorMessage,
      concatAttempts: row.concatAttempts,
      instanceId: row.instanceId,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    },
    where: lt(videoJobs.updatedAt, row.updatedAt),
  });
}

// R111 — Read cancel flag from DB (caller-set via POST /api/video-jobs/:id/cancel).
// Checked at chapter boundaries so an in-flight chapter completes cleanly but
// queued chapters skip and the job lands as 'failed' with errorMessage='cancelled'.
async function isCancelRequested(jobId: string): Promise<boolean> {
  try {
    const rows = await db.select({ c: videoJobs.cancelRequested }).from(videoJobs).where(eq(videoJobs.jobId, jobId)).limit(1);
    return !!rows[0]?.c;
  } catch (_e) { logSilentCatch("video-job-runner:cancel-read", _e); return false; }
}

// R112.1 INCIDENT FIX — Strategy: liveness is determined SOLELY by
// updatedAt heartbeat, NOT by instance_id. The previous OR-clause
// `ne(instanceId, RUNNER_INSTANCE_ID)` killed actively-rendering jobs the
// moment Replit Autoscale spun up a second container — container B's sweep
// matched on instance mismatch and marked container A's live job failed
// even though A was bumping updatedAt every few seconds. Bob lost a real
// customer-facing video to this on the post-R112 deploy (job
// vj_mp4ruk23_5398cd17c2fd, killed at 00:52:56 mid-encode of chapter 1).
// Stale cutoff is 10min — deliberately ABOVE PER_CHAPTER_TIMEOUT_MS (5min)
// so a chapter running near its timeout cannot be falsely flagged stale at
// the boundary (architect R112.1 review finding). writeStateAtomic only
// bumps updatedAt at chapter boundaries / state transitions, not mid-encode,
// so the gap during a long ffmpeg+TTS+image-gen chapter can approach the
// chapter timeout itself. finalizeVideoJob is idempotent at L583, so even
// if two containers race the sweep, only one UPDATE wins and the
// consequence is harmless.
export async function recoverStaleVideoJobs(): Promise<{ recovered: number }> {
  try {
    const staleCutoff = new Date(Date.now() - 20 * 60 * 1000); // R112.12 — must stay > PER_CHAPTER_TIMEOUT_MS (15 min)
    const result = await db.update(videoJobs).set({
      status: "failed",
      errorMessage: "no heartbeat for >20min — runner presumed dead. Chapter MP4s on disk preserved; you can manually retry from the dashboard.",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      inArray(videoJobs.status, ["queued", "rendering", "ready_to_concat", "concating"]),
      lt(videoJobs.updatedAt, staleCutoff),
    )).returning({ jobId: videoJobs.jobId });
    if (result.length > 0) console.log(`[video-job-runner] recovered ${result.length} stale jobs (instance=${RUNNER_INSTANCE_ID.slice(0, 16)}...):`, result.map((r) => r.jobId).join(", "));
    return { recovered: result.length };
  } catch (e: any) {
    console.warn(`[video-job-runner] recoverStaleVideoJobs failed: ${e?.message || e}`);
    return { recovered: 0 };
  }
}

// R111 architect fix — periodic sweeper. Called once from server/index.ts
// startup to arm a 60s loop. Catches the case where this process's runner
// silently died mid-job but the HTTP server kept running.
let sweeperArmed = false;
export function armPeriodicRecoverySweeper(): void {
  if (sweeperArmed) return;
  sweeperArmed = true;
  setInterval(() => { void recoverStaleVideoJobs(); }, 60 * 1000).unref();
}

// R111 — Caller (POST /api/video-jobs/:id/cancel) sets the flag; the runner
// observes it at the next chapter boundary. Returns true if the flag was set
// (which means the job is owned by this tenant AND was in an active state).
export async function requestCancel(jobId: string, tenantId: number): Promise<boolean> {
  if (!isValidJobId(jobId)) return false;
  // R111 architect fix — include 'ready_to_concat' so the cancelable status
  // set matches the frontend's ACTIVE_STATUSES (no UI/backend mismatch where
  // the cancel button shows but POST returns 404).
  const result = await db.update(videoJobs).set({ cancelRequested: true, updatedAt: new Date() }).where(and(
    eq(videoJobs.jobId, jobId),
    eq(videoJobs.tenantId, tenantId),
    inArray(videoJobs.status, ["queued", "rendering", "ready_to_concat", "concating"]),
  )).returning({ jobId: videoJobs.jobId });
  return result.length > 0;
}

export function readJobState(jobId: string): VideoJobState | null {
  if (!isValidJobId(jobId)) return null;     // path-traversal jail
  const sp = statePath(jobId);
  if (!fs.existsSync(sp)) return null;       // genuine "not found"
  // R110.11 — distinguish corrupt from not-found. Silent `return null` hid
  // partial-write corruption that orphaned chapter MP4s; agent reported
  // "job not found" while files still on disk.
  try {
    return JSON.parse(fs.readFileSync(sp, "utf8")) as VideoJobState;
  } catch (e: any) {
    console.error(`[video-job-runner] readJobState CORRUPT jobId=${jobId} path=${sp} err=${e?.message || e}`);
    return null;
  }
}

// TTL sweeper — wipes job directories older than JOB_TTL_MS. Called on every
// startVideoJob (cheap; bounded by jobs-on-disk count). Survives crashes mid-
// sweep; next call resumes deleting whatever's left.
function sweepOldJobs(): void {
  try {
    if (!fs.existsSync(JOBS_ROOT)) return;
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const entry of fs.readdirSync(JOBS_ROOT)) {
      if (!isValidJobId(entry)) continue;     // skip anything that doesn't match our pattern
      const dir = path.join(JOBS_ROOT, entry);
      try {
        const st = fs.statSync(dir);
        if (!st.isDirectory()) continue;
        if (st.mtimeMs > cutoff) continue;
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_e) { logSilentCatch("video-job-runner:sweep-entry", _e); }
    }
  } catch (_e) { logSilentCatch("video-job-runner:sweep", _e); }
}

// Owner-tenant scoping: any caller asking for a job they don't own gets a 404.
function ownedBy(state: VideoJobState | null, tenantId: number): VideoJobState | null {
  if (!state) return null;
  if (state.tenant_id !== tenantId) return null;
  return state;
}

function newJobId(): string { return `vj_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`; }

async function renderOneChapter(state: VideoJobState, chapter: ChapterSpec, chapterIdx: number): Promise<void> {
  const ch = state.chapters[chapterIdx];
  ch.status = "rendering";
  ch.started_at = Date.now();
  ch.attempts += 1;
  writeStateAtomic(state);

  // Wrap produceVideo in a per-chapter timeout. The render is async; we race a
  // timeout promise so a hung TTS or ffmpeg spawn can't pin the chapter forever.
  const renderPromise = produceVideo({
    title: `${state.title}_ch${chapterIdx + 1}`,
    scenes: chapter.scenes,
    voice: state.spec.voice,
    voiceProvider: state.spec.voiceProvider as "fish" | "openai" | "elevenlabs" | "edge" | undefined,
    strictVoice: state.spec.strictVoice === true,
    resolution: state.spec.resolution as "1080p" | "720p" | "4k" | undefined,
    fps: state.spec.fps,
    transition: state.spec.transition,
    crossfadeMs: state.spec.crossfadeMs,
    kenBurns: state.spec.kenBurns,
    kenBurnsIntensity: state.spec.kenBurnsIntensity,
    tenantId: state.tenant_id,
    uploadToDrive: false,
  });
  const timeoutPromise = new Promise<{ success: false; error: string; scenesProcessed: number; steps: string[] }>((resolve) => {
    setTimeout(() => resolve({ success: false, error: `Per-chapter timeout after ${Math.round(PER_CHAPTER_TIMEOUT_MS / 1000)}s`, scenesProcessed: 0, steps: [] }), PER_CHAPTER_TIMEOUT_MS);
  });
  const result = await Promise.race([renderPromise, timeoutPromise]);

  if (!result.success || !(result as any).filePath) {
    ch.status = "failed";
    ch.error = String((result as any).error || "unknown render failure").slice(0, 500);
    // R110.17 — preserve the rich error envelope from mpeg-engine preflight
    // (error_type=container_environment_corrupted + suggested_action="bounce
    // the deployment"). Without this, check_video_job collapsed it to the
    // short error string and Felix confabulated a generic "needs maintenance"
    // reply instead of telling Bob the actionable next step.
    const env = (result as any).error_envelope;
    if (env && typeof env === "object") (ch as any).error_envelope = env;
    ch.completed_at = Date.now();
    writeStateAtomic(state);
    return;
  }

  // Move the rendered file into the job's chapter slot (stable path) so concat
  // can find it even if the temp project-assets file gets cleaned up.
  ensureDir(path.join(jobDir(state.job_id), "chapters"));
  const dest = chapterPath(state.job_id, chapterIdx);
  try {
    fs.copyFileSync((result as any).filePath, dest);
    try { fs.unlinkSync((result as any).filePath); } catch (_e) { logSilentCatch("video-job-runner:unlink-tmp", _e); }
  } catch (e: any) {
    ch.status = "failed";
    ch.error = `chapter-file-move failed: ${e?.message || String(e)}`.slice(0, 500);
    ch.completed_at = Date.now();
    writeStateAtomic(state);
    return;
  }

  ch.status = "done";
  ch.file_path = dest;
  ch.duration_sec = (result as any).durationSeconds;
  ch.completed_at = Date.now();
  writeStateAtomic(state);
}

// Background scheduler: runs MAX_PARALLEL_CHAPTERS at a time using a worker
// pool that pulls the next queued chapter when one finishes. Fire-and-forget;
// updates state file as it goes.
async function runChaptersInBackground(state: VideoJobState, chapters: ChapterSpec[]): Promise<void> {
  const queue: number[] = chapters.map((_, i) => i);
  const inFlight: Set<Promise<void>> = new Set();

  const tick = async (): Promise<void> => {
    // R111 — check cancel flag at chapter boundary. If set, drain queue
    // (mark remaining chapters skipped) and let in-flight finish naturally.
    if (await isCancelRequested(state.job_id)) {
      while (queue.length > 0) {
        const idx = queue.shift()!;
        const ch = state.chapters[idx];
        if (ch.status === "queued") { ch.status = "failed"; ch.error = "cancelled by user"; ch.completed_at = Date.now(); }
      }
      writeStateAtomic(state);
      return;
    }
    while (queue.length > 0 && inFlight.size < MAX_PARALLEL_CHAPTERS) {
      // R111 architect fix — re-check cancel right before dispatching each
      // chapter (not just at tick start), so a cancel arriving mid-loop can't
      // be raced by a chapter that's about to spawn.
      if (await isCancelRequested(state.job_id)) {
        while (queue.length > 0) {
          const idx = queue.shift()!;
          const ch = state.chapters[idx];
          if (ch.status === "queued") { ch.status = "failed"; ch.error = "cancelled by user"; ch.completed_at = Date.now(); }
        }
        writeStateAtomic(state);
        break;
      }
      const idx = queue.shift()!;
      const p = renderOneChapter(state, chapters[idx], idx).catch((e) => {
        // Defense in depth: produceVideo throws shouldn't kill the whole job.
        const ch = state.chapters[idx];
        ch.status = "failed";
        ch.error = `unhandled: ${(e?.message || String(e)).slice(0, 400)}`;
        ch.completed_at = Date.now();
        writeStateAtomic(state);
      }).finally(() => { inFlight.delete(p); });
      inFlight.add(p);
    }
  };

  await tick();
  while (inFlight.size > 0) {
    await Promise.race(Array.from(inFlight));
    await tick();
  }

  // Done — update final job status.
  const fresh = readJobState(state.job_id) || state;
  const allDone = fresh.chapters.every((c) => c.status === "done" || c.status === "failed");
  const anySuccess = fresh.chapters.some((c) => c.status === "done");
  if (allDone) {
    fresh.status = anySuccess ? "ready_to_concat" : "failed";
    writeStateAtomic(fresh);
  }

  // R112 — auto-finalize + auto-deliver hooks. When build_video_from_brief
  // started this job, it asked the runner to own the entire pipeline so Felix
  // doesn't have to make 3 more tool calls (poll → finalize → deliver). If
  // ready_to_concat AND autoFinalize, call finalizeVideoJob inline; if
  // autoDeliver AND finalize succeeded, fire deliverDigitalProduct so the
  // user gets the streaming URL + email automatically. Errors are persisted
  // to state.last_concat_error so the /jobs page surfaces them.
  if (fresh.status === "ready_to_concat" && (fresh.spec as any)?.autoFinalize) {
    try {
      const finRes = await finalizeVideoJob({ jobId: fresh.job_id, tenantId: fresh.tenant_id });
      // R112 architect-fix — guard against re-fire. Even though
      // recoverStaleVideoJobs marks stale jobs "failed" (doesn't re-enter
      // runChaptersInBackground), set a one-shot marker so any future
      // re-run path (manual retry, future recovery enhancement) can't
      // double-deliver. finalizeVideoJob is already idempotent (L583), but
      // deliverDigitalProduct is NOT — it would create a second Drive
      // folder and email.
      const alreadyDelivered = (fresh.spec as any)?.autoDeliveryAttempted === true;
      if (finRes.success && finRes.file_path && (fresh.spec as any)?.autoDeliver && !alreadyDelivered) {
        const after0 = readJobState(fresh.job_id);
        if (after0) {
          (after0.spec as any).autoDeliveryAttempted = true;
          writeStateAtomic(after0);
        }
        try {
          const { deliverDigitalProduct } = await import("./delivery-pipeline");
          const customerName = (fresh.spec as any)?.customerName || "Bob";
          // R112.16 — prefer explicit customerEmail; fall back to legacy emailTo.
          const customerEmail = (fresh.spec as any)?.customerEmail || (fresh.spec as any)?.emailTo;
          const safeFileName = `${fresh.title.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 50)}.mp4`;
          // DeliveryRequest interface is strict: no productType/description/
          // tenantId fields. productType + description ride in metadata so
          // they survive into the delivery_logs row. Tenant scope is
          // enforced via the file-row attachment + the per-customer email
          // ACL inside deliverDigitalProduct (no AsyncLocalStorage gate).
          await deliverDigitalProduct({
            customerName,
            customerEmail,
            productName: fresh.title,
            filePath: finRes.file_path,
            fileName: safeFileName,
            sendEmail: !!customerEmail,
            metadata: {
              productType: "video",
              tenantId: fresh.tenant_id,
              jobId: fresh.job_id,
              chapters: fresh.total_chapters,
              durationSec: finRes.duration_sec,
              source: "build_video_from_brief",
              description: `Auto-delivered by build_video_from_brief (${fresh.total_chapters} chapters, ${finRes.duration_sec?.toFixed(1)}s)`,
            },
          });
          console.log(`[video-job-runner] R112 auto-delivered ${fresh.job_id} to ${customerEmail || customerName}`);
        } catch (e: any) {
          const after = readJobState(fresh.job_id);
          if (after) {
            after.last_concat_error = `auto_deliver_failed: ${(e?.message || String(e)).slice(0, 400)}`;
            writeStateAtomic(after);
          }
          logSilentCatch("video-job-runner:auto-deliver", e);
        }
      }
    } catch (e: any) {
      const after = readJobState(fresh.job_id);
      if (after) {
        after.last_concat_error = `auto_finalize_failed: ${(e?.message || String(e)).slice(0, 400)}`;
        writeStateAtomic(after);
      }
      logSilentCatch("video-job-runner:auto-finalize", e);
    }
  }
}

export interface StartVideoJobInput {
  tenantId: number;
  title: string;
  chapters: ChapterSpec[];
  voice?: string;
  voiceProvider?: string;
  strictVoice?: boolean;
  resolution?: string;
  fps?: number;
  transition?: string;
  crossfadeMs?: number;
  kenBurns?: boolean;
  kenBurnsIntensity?: number;
  backgroundMusicPath?: string;
  uploadToDrive?: boolean;
  emailTo?: string;
  projectId?: number;
  _projectDriveFolderId?: string;
  // R112 — auto-finalize + auto-deliver. Set by build_video_from_brief so the
  // background runner owns the entire pipeline (render → concat → upload →
  // deliver) without Felix needing to invoke check_video_job / finalize_video
  // / deliver_product manually. Felix's chat turn closes after one tool call.
  autoFinalize?: boolean;
  autoDeliver?: boolean;
  customerName?: string;
  customerEmail?: string;
}

export function startVideoJob(input: StartVideoJobInput): { job_id: string; status: VideoJobStatus; total_chapters: number; total_scenes: number } {
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) throw new Error("tenantId required");
  if (!input.title || !input.title.trim()) throw new Error("title required");
  if (!Array.isArray(input.chapters) || input.chapters.length === 0) throw new Error("at least one chapter required");
  for (const ch of input.chapters) {
    if (!ch.chapterTitle || !Array.isArray(ch.scenes) || ch.scenes.length === 0) throw new Error("each chapter needs chapterTitle + scenes[]");
  }

  ensureDir(JOBS_ROOT);
  sweepOldJobs();                              // architect CRITICAL fix: TTL on every new job
  const jobId = newJobId();
  const state: VideoJobState = {
    job_id: jobId,
    tenant_id: input.tenantId,
    title: input.title.slice(0, 200),
    status: "rendering",
    total_chapters: input.chapters.length,
    chapters: input.chapters.map((ch, i) => ({
      idx: i,
      title: ch.chapterTitle.slice(0, 200),
      scene_count: ch.scenes.length,
      status: "queued",
      attempts: 0,
    })),
    spec: {
      voice: input.voice,
      voiceProvider: input.voiceProvider,
      strictVoice: input.strictVoice,
      resolution: input.resolution,
      fps: input.fps,
      transition: input.transition,
      crossfadeMs: input.crossfadeMs,
      kenBurns: input.kenBurns,
      kenBurnsIntensity: input.kenBurnsIntensity,
      backgroundMusicPath: input.backgroundMusicPath,
      uploadToDrive: input.uploadToDrive,
      emailTo: input.emailTo,
      projectId: input.projectId,
      _projectDriveFolderId: input._projectDriveFolderId,
      autoFinalize: input.autoFinalize,           // R112
      autoDeliver: input.autoDeliver,             // R112
      customerName: input.customerName,           // R112
      customerEmail: input.customerEmail,         // R112.16
    },
    created_at: Date.now(),
    updated_at: Date.now(),
    concat_attempts: 0,
  };
  writeStateAtomic(state);

  // Fire-and-forget — the chat turn returns immediately with the job_id while
  // chapters render in the background. Errors land in state.json.
  setImmediate(() => {
    runChaptersInBackground(state, input.chapters).catch((e) => {
      try {
        const fresh = readJobState(jobId);
        if (fresh) { fresh.status = "failed"; fresh.last_concat_error = `bg-scheduler: ${(e?.message || String(e)).slice(0, 400)}`; writeStateAtomic(fresh); }
      } catch (_e) { logSilentCatch("video-job-runner:bg-error-state", _e); }
    });
  });

  const totalScenes = input.chapters.reduce((s, c) => s + c.scenes.length, 0);
  return { job_id: jobId, status: state.status, total_chapters: state.total_chapters, total_scenes: totalScenes };
}

export function getVideoJob(jobId: string, tenantId: number): VideoJobState | null {
  return ownedBy(readJobState(jobId), tenantId);
}

export interface FinalizeVideoInput {
  tenantId: number;
  jobId: string;
}

export interface FinalizeVideoResult {
  success: boolean;
  job_id: string;
  status: VideoJobStatus;
  file_path?: string;
  drive_url?: string;
  duration_sec?: number;
  size_bytes?: number;
  error?: string;
  message: string;
}

export async function finalizeVideoJob(input: FinalizeVideoInput): Promise<FinalizeVideoResult> {
  // Architect CRITICAL fix: validate job_id format before any path operation.
  if (!isValidJobId(input.jobId)) return { success: false, job_id: String(input.jobId).slice(0, 80), status: "failed", message: "Invalid job_id format. Expected vj_<id>.", error: "invalid_job_id" };
  const state = ownedBy(readJobState(input.jobId), input.tenantId);
  if (!state) return { success: false, job_id: input.jobId, status: "failed", message: "Job not found or not owned by this tenant.", error: "not_found" };

  // If already done, return cached result (idempotent).
  if (state.status === "done" && state.final_file_path && fs.existsSync(state.final_file_path)) {
    return { success: true, job_id: input.jobId, status: "done", file_path: state.final_file_path, drive_url: state.final_drive_url, duration_sec: state.final_duration_sec, size_bytes: state.final_size_bytes, message: "Already finalized — returning cached result. (W1.4 idempotent.)" };
  }

  // Wait for chapters to be ready. We do NOT block forever — the caller is
  // expected to poll. If still rendering, return a clear status without erroring.
  if (state.status === "rendering") {
    const done = state.chapters.filter((c) => c.status === "done").length;
    const failed = state.chapters.filter((c) => c.status === "failed").length;
    return { success: false, job_id: input.jobId, status: "rendering", message: `Still rendering: ${done}/${state.total_chapters} done, ${failed} failed. Poll check_video_job and call finalize_video when status='ready_to_concat'.` };
  }

  if (state.status === "concating") {
    return { success: false, job_id: input.jobId, status: "concating", message: "A concat is already in progress — wait then poll check_video_job." };
  }

  // Gather successful chapter files (in order).
  const successChapters = state.chapters.filter((c) => c.status === "done" && c.file_path && fs.existsSync(c.file_path)).sort((a, b) => a.idx - b.idx);
  if (successChapters.length === 0) {
    state.status = "failed";
    state.last_concat_error = "No successful chapters to concat.";
    writeStateAtomic(state);
    return { success: false, job_id: input.jobId, status: "failed", message: "No successful chapters to concat — every chapter failed during render. Inspect chapters[].error.", error: "no_chapters" };
  }

  state.status = "concating";
  state.concat_attempts += 1;
  writeStateAtomic(state);

  try {
    const safeTitle = state.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const concatRes = await concatenateClips(
      successChapters.map((c) => c.file_path!),
      safeTitle,
      state.spec.transition || "fade",
      state.spec.crossfadeMs ?? 400,
    );
    if (!concatRes.success || !concatRes.filePath) {
      state.status = "ready_to_concat";   // back to retry-able state, NOT failed
      state.last_concat_error = String(concatRes.error || "concat returned no filePath").slice(0, 500);
      writeStateAtomic(state);
      return { success: false, job_id: input.jobId, status: "ready_to_concat", message: `Concat failed: ${state.last_concat_error}. Chapter files preserved on disk — call finalize_video again to retry concat only (W1.4 resumable).`, error: state.last_concat_error };
    }

    let driveUrl: string | undefined;
    if (state.spec.uploadToDrive !== false) {
      try {
        const { uploadAndShare } = await import("./google-drive");
        const ur = await uploadAndShare({
          filePath: concatRes.filePath,
          fileName: `${safeTitle}.mp4`,
          mimeType: "video/mp4",
          description: state.title,
          folderLabel: "VisionClaw Media/Videos",
          parentFolderId: state.spec._projectDriveFolderId || undefined,
        });
        if (ur.success && ur.viewUrl) driveUrl = ur.viewUrl;
      } catch (_e) { logSilentCatch("video-job-runner:drive-upload", _e); }
    }

    state.status = "done";
    state.final_file_path = concatRes.filePath;
    state.final_drive_url = driveUrl;
    state.final_duration_sec = concatRes.durationSeconds;
    state.final_size_bytes = concatRes.sizeBytes;
    state.last_concat_error = undefined;
    writeStateAtomic(state);

    return {
      success: true,
      job_id: input.jobId,
      status: "done",
      file_path: concatRes.filePath,
      drive_url: driveUrl,
      duration_sec: concatRes.durationSeconds,
      size_bytes: concatRes.sizeBytes,
      message: `Finalized: ${successChapters.length}/${state.total_chapters} chapters concatenated into ${concatRes.durationSeconds?.toFixed(1)}s video${driveUrl ? ` (Drive: ${driveUrl})` : ""}.`,
    };
  } catch (e: any) {
    state.status = "ready_to_concat";
    state.last_concat_error = (e?.message || String(e)).slice(0, 500);
    writeStateAtomic(state);
    return { success: false, job_id: input.jobId, status: "ready_to_concat", message: `Concat threw: ${state.last_concat_error}. Chapter files preserved — retry by calling finalize_video again.`, error: state.last_concat_error };
  }
}

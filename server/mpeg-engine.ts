import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { logSilentCatch } from "./lib/silent-catch";
import { runFfmpegAsync } from "./lib/ffmpeg-async";
import { generateOmniFlashClip, isOmniFlashEnabled } from "./video/gemini-omni-flash";
const OUTPUT_DIR = path.resolve(process.cwd(), "project-assets");
const MAX_PARALLEL_TTS = 4;
// W1.1+W1.2 (Felix Deliverable Reliability Plan): audio dropout was caused by
// silent TTS-failure swallowing — one transient ElevenLabs blip would ship a
// video with a silent scene mid-render. We now retry, verify chunk duration,
// and refuse to declare success if any narration-bearing scene ended up silent
// or if the final mux's audio duration drifts >250 ms from the sum-of-chunks.
const MAX_TTS_RETRIES = 3;
const TTS_RETRY_BACKOFF_MS = [1000, 4000, 12000];
const TTS_DURATION_LOWER_RATIO = 0.5;  // < 50% of expected = corrupt chunk
const TTS_DURATION_UPPER_RATIO = 3.0;  // > 3x expected = runaway chunk
const AUDIO_COMPLETENESS_TOLERANCE_SEC = 0.25;

function expectedTTSDurationSec(text: string): number {
  // ~150 wpm conversational pace = 2.5 words/sec. Calibrated for Bob's Fish
  // voice clone; keep in lockstep with scripts/lib/bwb-narration-timing.ts
  // (BWB_NARRATION_WPS overrides both render paths' word-count estimate).
  let wps = 2.5;
  const raw = process.env.BWB_NARRATION_WPS;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) wps = n;
  }
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.0, words / wps);
}

function probeAudioStreamDuration(filePath: string): number | null {
  try {
    const raw = execFileSync(getFFprobePath(), [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=duration",
      "-of", "csv=p=0",
      filePath,
    ], { encoding: "utf-8", timeout: 10000 }).trim();
    const n = parseFloat(raw);
    // R110.11.5 (silent-failure-hunter): non-finite parse must NOT return 0 —
    // downstream `audio_completeness` gate at L712-725 treats 0 as a real measurement
    // and fails with the misleading message "muxed video has no audio stream",
    // hiding the true root cause (ffprobe parse/format failure). Match the catch
    // contract: return null so the caller distinguishes "unknown" from "verified zero".
    if (!isFinite(n)) {
      console.error(`[mpeg-engine] probeAudioStreamDuration NON-NUMERIC on ${filePath}: ffprobe returned "${raw.slice(0,120)}"`);
      return null;
    }
    return n;
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() || err?.message || String(err);
    console.error(`[mpeg-engine] probeAudioStreamDuration FAILED on ${filePath}: ${stderr.slice(0, 300)}`);
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// R110.20 — delegate to shared helper so dev + prod use the same bundled
// ffmpeg-static binary (no more Nix-store GC class of failures).
import { getFfmpegPath as _resolvedFfmpeg, getFfprobePath as _resolvedFfprobe } from "./lib/ffmpeg-paths";
function getFFmpegPath(): string { return _resolvedFfmpeg(); }
function getFFprobePath(): string { return _resolvedFfprobe(); }

// R125+13.16 — Veo / "Gemini Omni Flash" per-scene helper. Generates an 8s-max
// clip via the adapter, then ffmpeg-transcodes it to the job's resolution/fps
// and muxes the scene's audio. Video is loop-extended with -stream_loop -1 so
// audio always drives final length. Returns true on success (segPath written),
// false on any failure (caller falls back to still-image path).
async function tryRenderVeoSegment(opts: {
  prompt: string;
  sceneDur: number;
  audioPath: string | null;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  label: string;
}): Promise<boolean> {
  try {
    const veoDur = Math.max(2, Math.min(8, Math.round(opts.sceneDur)));
    const aspect: "16:9" | "9:16" | "1:1" =
      opts.width === opts.height ? "1:1" : opts.height > opts.width ? "9:16" : "16:9";
    const clip = await generateOmniFlashClip({
      prompt: opts.prompt,
      durationSec: veoDur,
      aspectRatio: aspect,
      outDir: path.dirname(opts.outPath),
    });
    // R125+13.16+sec — architect LOW: wrap mux in try/finally so a synchronous
    // throw between the download and the unlink line doesn't leak the raw Veo
    // clip into jobDir. Finally runs even on thrown exceptions, not just on
    // the !res.ok branch.
    try {
      const hasAudio = !!opts.audioPath && fs.existsSync(opts.audioPath);
      const audioDur = hasAudio ? (probeAudioDurationAuthoritative(opts.audioPath!) ?? probeDuration(opts.audioPath!)) : opts.sceneDur;
      // R125+13.16+sec — pad bumped 0.25 → 2.5s to match the still-image path
      // (architect MEDIUM). Fish Audio VBR MP3s under-report by 2-4s; the larger
      // pad prevents -shortest from clipping audio mid-narration and tripping
      // the audio-completeness gate (R111.1 incident class).
      const targetDur = hasAudio ? audioDur + 2.5 : opts.sceneDur;

      const ffArgs: string[] = ["-y", "-stream_loop", "-1", "-i", clip.videoPath, "-t", String(targetDur)];
      if (hasAudio) {
        ffArgs.push("-i", opts.audioPath!, "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest");
      } else {
        ffArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest", "-c:a", "aac");
      }
      const vf = `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.height},fps=${opts.fps}`;
      ffArgs.push("-vf", vf, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-movflags", "+faststart", "-r", String(opts.fps), opts.outPath);

      const res = await runFfmpegAsync(_resolvedFfmpeg(), ffArgs, {
        timeoutMs: 120_000,
        label: `${opts.label} veo-mux`,
        forwardStderrToConsole: true,
      });
      if (!res.ok) {
        console.error(`[mpeg-engine] Veo ffmpeg mux failed (exit=${res.exitCode}): ${res.stderrTail.slice(-400)}`);
        return false;
      }
      console.log(`[mpeg-engine] ${opts.label}: Veo segment OK (${(clip.latencyMs / 1000).toFixed(1)}s gen, ${clip.modelUsed})`);
      return true;
    } finally {
      try { fs.unlinkSync(clip.videoPath); } catch (_e) { logSilentCatch("server/mpeg-engine.ts", _e); }
    }
  } catch (e: any) {
    console.warn(`[mpeg-engine] tryRenderVeoSegment threw: ${(e?.message || String(e)).slice(0, 240)}`);
    return false;
  }
}

function probeDurationStrict(filePath: string): { duration: number | null; error?: string } {
  if (!fs.existsSync(filePath)) {
    console.error(`[mpeg-engine] probeDurationStrict INPUT_MISSING on ${filePath}`);
    return { duration: null, error: `input file does not exist: ${filePath} (upstream orchestration / TTS path-mismatch — NOT an ffmpeg/ffprobe problem; verify the audio generation step produced this exact path)` };
  }
  try {
    const out = execFileSync(getFFprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath], { encoding: "utf-8", timeout: 10000 }).trim();
    const n = parseFloat(out);
    if (!isFinite(n) || n <= 0) return { duration: null, error: `ffprobe returned non-numeric: "${out}"` };
    return { duration: n };
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() || err?.message || String(err);
    console.error(`[mpeg-engine] ffprobe FAILED on ${filePath}: ${stderr.slice(0, 300)}`);
    return { duration: null, error: stderr.slice(0, 300) };
  }
}

function probeDuration(filePath: string): number {
  const r = probeDurationStrict(filePath);
  if (r.duration == null) {
    throw new Error(`probeDuration FAILED on ${filePath}: ${r.error || "ffprobe returned no duration"}`);
  }
  return r.duration;
}

// R111.1 incident fix — INC vj_mp4fgc7f Ch2 audio-completeness gate failure.
// `probeDuration` reads the container header; `probeAudioStreamDuration` reads
// the actual a:0 stream sample-data length. Fish Audio (R110.6 primary TTS)
// returns VBR MP3s where the container header sometimes UNDER-reports the true
// audio length by 2-4 seconds per chunk. The per-segment encoder used the
// container value to size the looped image input (`-loop 1 ... -t dur`), then
// `-shortest` clipped the audio at the image's end — so the muxed file shipped
// less audio than was generated. The audio-completeness gate (which uses the
// stream value) then failed with drift = (true_audio_len - container_len) ×
// scenes_per_chapter. Fix: use the LARGER of both probes everywhere we
// reason about audio duration, so the encoder reserves enough image runtime
// for the full audio AND the gate's "expected" matches what's truly in the
// audio file. Returns null only if both probes fail (caller falls through).
function probeAudioDurationAuthoritative(filePath: string): number | null {
  const stream = probeAudioStreamDuration(filePath);
  const container = probeDurationStrict(filePath).duration;
  if (stream == null && container == null) return null;
  return Math.max(stream ?? 0, container ?? 0);
}

// R111.2 — Soften failure cleanup. Was `fs.rmSync(jobDir, ...)` — every gate
// failure shredded its own evidence (audio chunks, segment MP4s, ffmpeg
// stderr capture), making post-mortem on Felix renders impossible. Now we
// MOVE the dir to `data/video-jobs-failed/<basename>__<reason>__<ts>/` so
// Bob (or a future agent) can `ls` and inspect what actually shipped.
// Best-effort: never throws — the failure path is already failing. The
// destination root is auto-created. If the move fails (cross-device, permission,
// already exists), we fall back to the old rm. Successful renders still rm
// their jobDir at the bottom of produceVideo (those are clean cleanups).
// R111.2 architect fix — bound failed-job retention so the quarantine dir
// can't fill the disk over time. Defaults: 14 days OR 5GB total, whichever
// hits first; oldest-first eviction. Env overrides:
//   VIDEO_FAILED_RETAIN_DAYS  (default 14)
//   VIDEO_FAILED_RETAIN_BYTES (default 5_368_709_120 = 5GiB)
// Sweeper is armed once from server/index.ts startup; runs every 6h.
const FAILED_ROOT = path.resolve(process.cwd(), "data", "video-jobs-failed");
const FAILED_RETAIN_MS = (parseInt(process.env.VIDEO_FAILED_RETAIN_DAYS || "14", 10) || 14) * 24 * 3600 * 1000;
const FAILED_RETAIN_BYTES = parseInt(process.env.VIDEO_FAILED_RETAIN_BYTES || "", 10) || (5 * 1024 * 1024 * 1024);

function quarantineJobDir(jobDir: string, reason: string): void {
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

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeFFmpegText(s: string): string {
  return s.replace(/[\\':;\[\]{}()%#=@&!<>^~`|"]/g, " ").replace(/\s+/g, " ").trim();
}

export interface MpegScene {
  narration?: string;
  title?: string;
  imagePath?: string;
  imagePrompt?: string;
  durationOverride?: number;
  // R99 — Felix Visual Continuity. 'hero' = best-of-N (3 candidates by default,
  // env VIDEO_HERO_CANDIDATES); 'broll' = single-shot. Omit → first scene per
  // job auto-promoted to hero, rest are broll.
  qualityTier?: "hero" | "broll";
  // R125+13.16 — Optional Veo / "Gemini Omni Flash" path. When set AND
  // GEMINI_OMNI_FLASH_ENABLED=true, the per-scene segment is built from a real
  // generated video clip (Veo 3.1 fast by default) instead of a Ken Burns
  // pan/zoom over the still image. Veo caps at 8s; longer scenes loop the clip
  // under the audio via -stream_loop -1. ANY adapter failure falls back to the
  // existing still-image + Ken Burns path so a transient Veo error never bricks
  // a render. imagePath is still required as the fallback.
  videoClipPrompt?: string;
}

export interface MpegJobOptions {
  title: string;
  scenes: MpegScene[];
  voice?: string;
  voiceProvider?: "fish" | "openai" | "elevenlabs" | "edge";
  // R125+14+sec3 — brand-voice lock. When true, generate_audio fails instead of
  // cascading to a different provider's (non-brand) voice. Used by Built With Bob
  // so a transient Fish failure blocks the render rather than shipping wrong voice.
  strictVoice?: boolean;
  resolution?: "1080p" | "720p" | "4k";
  fps?: number;
  transition?: string;
  crossfadeMs?: number;
  kenBurns?: boolean;
  kenBurnsIntensity?: number;
  backgroundMusicPath?: string;
  musicVolume?: number;
  introText?: string;
  outroText?: string;
  tenantId?: number;
  projectId?: number;
  uploadToDrive?: boolean;
  emailTo?: string;
  _projectDriveFolderId?: string;
}

export interface MpegJobResult {
  success: boolean;
  filePath?: string;
  driveUrl?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  scenesProcessed: number;
  steps: string[];
  error?: string;
  // R110.8/R110.10 — structured error envelope so callers (chat-engine,
  // delivery-pipeline, agent prompts) can branch on machine-readable
  // error_type instead of regexing the free-text `error` field. Missing
  // this declaration was failing the TypeScript hard gate on every CI run
  // since R110.8 (R110.11.1 fix).
  error_envelope?: {
    error_type: string;
    failed_scene_count?: number;
    total_scene_count?: number;
    retry_in_seconds?: number | null;
    suggested_action?: string;
    failed_scenes?: Array<{ index: number; narration_preview?: string; reason?: string }>;
    [key: string]: any;
  };
}

export async function produceVideo(options: MpegJobOptions): Promise<MpegJobResult> {
  const startTime = Date.now();
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  const jobId = `mpeg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const jobDir = path.join(OUTPUT_DIR, jobId);
  ensureDir(jobDir);
  ensureDir(OUTPUT_DIR);

  const res = options.resolution || "1080p";
  const [width, height] = res === "4k" ? [3840, 2160] : res === "720p" ? [1280, 720] : [1920, 1080];
  const fps = options.fps || 30;
  const crossfadeMs = options.crossfadeMs ?? 500;
  const crossfadeSec = crossfadeMs / 1000;
  const transition = options.transition || "fade";
  const kenBurns = options.kenBurns ?? false;
  const kenBurnsIntensity = Math.min(1.5, Math.max(1.0, options.kenBurnsIntensity || 1.15));
  const musicVolume = Math.min(1.0, Math.max(0.0, options.musicVolume ?? 0.12));
  const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);

  let scenes = [...options.scenes];

  if (options.introText) {
    scenes.unshift({ title: options.introText, durationOverride: 4 });
  }
  if (options.outroText) {
    scenes.push({ title: options.outroText, durationOverride: 4 });
  }

  console.log(`[mpeg-engine] Job ${jobId}: ${scenes.length} scenes, ${res}, ${fps}fps, transition=${transition}`);
  steps.push(`Starting MPEG production: ${scenes.length} scenes @ ${res}`);

  // R110.8 / R110.18 — Preflight via shared helper (server/lib/ffmpeg-preflight).
  // Helper has 30s timeout + retry-once on ETIMEDOUT + 5min in-process cache,
  // so 12 parallel chapters in mpeg_produce_parallel only do real preflight
  // work ONCE — the other 11 calls are 0ms cache hits, eliminating the
  // cold-start page-fault thrash that caused R110.17.1 prod failures.
  const { ffmpegPreflight } = await import("./lib/ffmpeg-preflight");
  const pf = ffmpegPreflight(ffmpeg, "mpeg-engine");
  if (!pf.ok) {
    return {
      success: false,
      scenesProcessed: 0,
      steps: [...steps, `❌ ${pf.errMsg}`],
      error: pf.errMsg,
      error_envelope: {
        error_type: pf.errorType,
        retry_in_seconds: pf.errorType === "preflight_timeout" ? 30 : null,
        suggested_action: pf.suggestedAction,
        ffmpeg_stderr: pf.ffmpegStderr,
      },
    } as any;
  }

  let executeTool: any;
  try {
    const toolsMod = await import("./tools");
    executeTool = toolsMod.executeTool;
  } catch (err: any) {
    return { success: false, scenesProcessed: 0, steps: [`Failed to load tools: ${err.message}`], error: err.message };
  }

  const sceneData: { imagePath: string; audioPath: string; duration: number }[] = [];

  // W1.1+W1.2: TTS with retry + per-chunk duration verification. A scene that
  // ASKED for narration and ended up silent after retries is a fatal error,
  // not a soft fall-through. The render must fail loudly so the deliverable
  // contract gate can refuse to ship a half-audio video.
  const ttsFailures: { index: number; reason: string; narrationPreview: string }[] = [];

  const generateTTSForScene = async (scene: MpegScene, index: number): Promise<{ audioPath: string; duration: number; failed: boolean; reason?: string }> => {
    if (!scene.narration?.trim()) {
      return { audioPath: "", duration: scene.durationOverride || 3, failed: false };
    }
    const expected = expectedTTSDurationSec(scene.narration);
    let lastReason = "no attempts made";
    for (let attempt = 0; attempt < MAX_TTS_RETRIES; attempt++) {
      try {
        const audioResult = await executeTool("generate_audio", {
          text: scene.narration,
          provider: options.voiceProvider || "fish",
          // Under strictVoice, do NOT default a lost/empty voice to onyx — pass it
          // through so generate_audio/Fish fail loud instead of silently switching
          // mid-narration to the generic onyx clone. Non-strict keeps the default.
          voice: options.strictVoice === true ? (options.voice as string) : (options.voice || "onyx"),
          strictVoice: options.strictVoice === true,
          filename: `${safeTitle}_scene_${index + 1}_a${attempt + 1}`,
          _tenantId: options.tenantId,
        }, options.tenantId);

        if (audioResult?.file_path && fs.existsSync(audioResult.file_path)) {
          const probe = probeDurationStrict(audioResult.file_path);
          const minOk = expected * TTS_DURATION_LOWER_RATIO;
          const maxOk = expected * TTS_DURATION_UPPER_RATIO;
          if (probe.duration === null) {
            // R110.8 — ffprobe itself is broken (e.g. corrupted libdrm.so.2 in
            // Nix store). Do NOT fail a perfectly good audio file because we
            // can't measure it. Fall back to file-size heuristic: Fish s2-pro
            // ≈ 12-16 KB/sec, OpenAI TTS-1 ≈ 4 KB/sec. Accept any file whose
            // size implies at least minOk seconds at the lowest plausible
            // bitrate (4 KB/sec). Log loud so this doesn't silently mask real
            // short-audio bugs.
            const sizeBytes = fs.statSync(audioResult.file_path).size;
            const minBytesForLowerBound = Math.max(8000, minOk * 4000);
            if (sizeBytes >= minBytesForLowerBound) {
              console.warn(`[mpeg-engine] TTS scene ${index + 1} attempt ${attempt + 1}: ffprobe broken (${probe.error?.slice(0, 80)}), accepting on file-size fallback (${sizeBytes} bytes >= ${Math.round(minBytesForLowerBound)} threshold for ${minOk.toFixed(1)}s @ 4KB/s)`);
              return { audioPath: audioResult.file_path, duration: expected + 0.3, failed: false };
            }
            lastReason = `ffprobe failed AND file-size fallback failed (${sizeBytes} bytes < ${Math.round(minBytesForLowerBound)} threshold). ffprobe error: ${probe.error?.slice(0, 120)}`;
            console.warn(`[mpeg-engine] TTS scene ${index + 1} attempt ${attempt + 1}: ${lastReason}`);
          } else {
            const dur = probe.duration;
            if (dur >= minOk && dur <= maxOk) {
              if (attempt > 0) {
                console.log(`[mpeg-engine] TTS scene ${index + 1} succeeded on attempt ${attempt + 1} (dur=${dur.toFixed(2)}s, expected=${expected.toFixed(2)}s)`);
              }
              // The slide is timed to the ACTUAL probed audio (exact); flag if the
              // word-count estimate is off by >2s (a sign the Fish voice rate
              // shifted and BWB_NARRATION_WPS needs retuning).
              const timingDelta = dur - expected;
              if (Math.abs(timingDelta) > 2.0) {
                console.warn(`[mpeg-engine] scene ${index + 1} narration timing drift: actual ${dur.toFixed(1)}s vs estimate ${expected.toFixed(1)}s (Δ${timingDelta >= 0 ? "+" : ""}${timingDelta.toFixed(1)}s) — slide still timed to the real audio.`);
              }
              return { audioPath: audioResult.file_path, duration: dur + 0.3, failed: false };
            }
            lastReason = `duration sanity-check failed: got ${dur.toFixed(2)}s, expected ${expected.toFixed(2)}s (range ${minOk.toFixed(2)}-${maxOk.toFixed(2)}s)`;
            console.warn(`[mpeg-engine] TTS scene ${index + 1} attempt ${attempt + 1}: ${lastReason}`);
          }
        } else {
          lastReason = `tool returned no file_path or file missing (got: ${JSON.stringify(audioResult)?.slice(0, 120)})`;
          console.warn(`[mpeg-engine] TTS scene ${index + 1} attempt ${attempt + 1}: ${lastReason}`);
        }
      } catch (err: any) {
        lastReason = `tool threw: ${err.message?.slice(0, 150)}`;
        console.warn(`[mpeg-engine] TTS scene ${index + 1} attempt ${attempt + 1}: ${lastReason}`);
      }
      if (attempt < MAX_TTS_RETRIES - 1) {
        await sleep(TTS_RETRY_BACKOFF_MS[attempt] || 12000);
      }
    }
    const preview = scene.narration.slice(0, 60).replace(/\s+/g, " ");
    ttsFailures.push({ index: index + 1, reason: lastReason, narrationPreview: preview });
    console.error(`[mpeg-engine] TTS scene ${index + 1} FAILED after ${MAX_TTS_RETRIES} attempts: ${lastReason}`);
    return { audioPath: "", duration: expected, failed: true, reason: lastReason };
  };

  console.log(`[mpeg-engine] Phase 1: Parallel TTS generation (${MAX_PARALLEL_TTS} concurrent)...`);
  steps.push(`Phase 1: Generating narration audio (parallel batches of ${MAX_PARALLEL_TTS})...`);
  const ttsStartTime = Date.now();

  const ttsResults: { audioPath: string; duration: number; failed: boolean; reason?: string }[] = new Array(scenes.length);
  for (let batch = 0; batch < scenes.length; batch += MAX_PARALLEL_TTS) {
    const batchSlice = scenes.slice(batch, batch + MAX_PARALLEL_TTS);
    const batchPromises = batchSlice.map((scene, i) => generateTTSForScene(scene, batch + i));
    const results = await Promise.all(batchPromises);
    results.forEach((r, i) => {
      ttsResults[batch + i] = r;
    });
  }

  const ttsTime = ((Date.now() - ttsStartTime) / 1000).toFixed(1);
  const audioCount = ttsResults.filter(r => r.audioPath).length;
  steps.push(`Phase 1 complete: ${audioCount}/${scenes.length} audio tracks in ${ttsTime}s`);

  // W1.2 FAIL LOUD: if any scene that requested narration ended up silent after
  // retries, refuse to ship the video. Better to surface a clear error than
  // silently send a customer a video with missing audio mid-render.
  if (ttsFailures.length > 0) {
    const summary = ttsFailures.map(f => `scene ${f.index}: "${f.narrationPreview}…" — ${f.reason}`).join("; ");
    // R110.7 — sniff the most-common reason so the agent can route (was
    // free-text only, agent hallucinated "all providers rate-limited").
    const allReasons = ttsFailures.map(f => f.reason).join(" ");
    const internalQuotaHit = /Rate limit:\s*"?generate_audio/i.test(allReasons);
    const upstreamQuotaHit = /429|rate.?limit|quota/i.test(allReasons) && !internalQuotaHit;
    const retryMatch = allReasons.match(/Wait\s+(\d+)s/i);
    const retryInSec = retryMatch ? parseInt(retryMatch[1], 10) : null;
    const errorType = internalQuotaHit ? "internal_quota_exceeded"
                    : upstreamQuotaHit ? "upstream_provider_rate_limit"
                    : "tts_generation_failed";
    const suggestedAction = internalQuotaHit
      ? "INTERNAL throttle (server/tool-rate-limiter.ts) rejected generate_audio before it reached any provider. The provider itself was NOT rate-limited. Either wait the suggested seconds and retry, OR ask owner to bump the generate_audio per-tenant limit. Do NOT report 'all providers rate-limited' — that is false."
      : upstreamQuotaHit
      ? `Upstream TTS provider returned 429/rate-limit. Cascade (Fish → OpenAI → Edge) was exhausted. ${retryInSec ? `Retry after ${retryInSec}s.` : 'Wait 60s and retry.'}`
      : "TTS generation failed for non-rate-limit reason. Check the per-scene reasons in failed_scenes for specific cause (network/auth/empty-narration/etc).";
    const errMsg = `Audio reliability gate blocked render: ${ttsFailures.length} of ${scenes.length} scene(s) failed TTS after ${MAX_TTS_RETRIES} retries. ${summary}`;
    console.error(`[mpeg-engine] ${errMsg}`);
    quarantineJobDir(jobDir, "tts_gate");
    return {
      success: false,
      scenesProcessed: 0,
      steps: [...steps, `❌ ${errMsg}`],
      error: errMsg,
      error_envelope: {
        error_type: errorType,
        failed_scene_count: ttsFailures.length,
        total_scene_count: scenes.length,
        retry_in_seconds: retryInSec,
        suggested_action: suggestedAction,
        failed_scenes: ttsFailures.map(f => ({ index: f.index, narration_preview: f.narrationPreview, reason: f.reason })),
      },
    };
  }

  console.log(`[mpeg-engine] Phase 2: Generating scene images (parallel, 4 concurrent)...`);
  steps.push(`Phase 2: Generating scene images (parallel)...`);
  const imageStartTime = Date.now();
  const MAX_PARALLEL_IMAGES = 4;

  // R99 helper: invoke generate_social_image once + materialize a local file
  // (downloads SSRF-jailed remote URLs to disk so best-of-N can grade them).
  const generateOneImageCandidate = async (prompt: string, sceneIdx: number, candIdx: number, refPathsForCall: string[] = []): Promise<string | null> => {
    try {
      const imgResult = await executeTool("generate_social_image", {
        prompt,
        style: "cinematic",
        aspect_ratio: "16:9",
        purpose: "customer_video_scene", // R74.11 — video scenes are customer deliverables
        // R99.1 — Pass real reference image bytes through to gpt-image-2's
        // edits endpoint. Cap at 4 (gpt-image-2 multi-image limit) to bound
        // cost; references already pre-ranked by select_references_for_frame.
        ...(refPathsForCall.length > 0 ? { reference_image_paths: refPathsForCall.slice(0, 4) } : {}),
        _tenantId: options.tenantId,
      }, options.tenantId);
      const localFile = imgResult?.file_path || imgResult?.local_path;
      if (localFile && fs.existsSync(localFile)) return localFile;
      const remoteUrl = imgResult?.imageUrl || imgResult?.drive_url || imgResult?.url;
      if (remoteUrl) {
        // R98.14 +sec-2 — SSRF jail (https-only, private-IP blocklist, DNS
        // rebinding recheck, redirect:error, body cap, 15s timeout). Same
        // posture as the original single-shot path.
        try {
          const { ssrfSafeFetchBytes } = await import("./lib/ssrf-jail");
          const dlPath = path.join(jobDir, `scene_img_${String(sceneIdx + 1).padStart(3, "0")}_c${candIdx}.png`);
          const r = await ssrfSafeFetchBytes(remoteUrl, { timeoutMs: 15000, maxBytes: 16 * 1024 * 1024, userAgent: "VisionClaw-MpegEngine/1.0" });
          if (r.ok) {
            fs.writeFileSync(dlPath, r.bytes);
            if (fs.existsSync(dlPath) && fs.statSync(dlPath).size > 1000) return dlPath;
          } else {
            console.warn(`[mpeg-engine] Scene ${sceneIdx + 1} c${candIdx}: SSRF jail rejected URL (${String(r.reason).slice(0, 100)})`);
          }
        } catch (dlErr: any) {
          console.warn(`[mpeg-engine] Scene ${sceneIdx + 1} c${candIdx}: failed to download URL: ${dlErr.message?.slice(0, 80)}`);
        }
      }
    } catch (err: any) {
      console.warn(`[mpeg-engine] Scene ${sceneIdx + 1} c${candIdx}: generate_social_image failed: ${err.message?.slice(0, 80)}`);
    }
    return null;
  };

  const generateImageForScene = async (scene: MpegScene, i: number): Promise<string> => {
    // R99 — log pre-supplied imagePath into the frame pool so later scenes can
    // reference it (continuity). Best-effort, never blocks.
    if (scene.imagePath && fs.existsSync(scene.imagePath)) {
      if (typeof options.tenantId === "number") {
        try {
          const { logFrame } = await import("./video/reference-selector");
          await logFrame({
            tenantId: options.tenantId,
            jobId,
            frameIdx: i,
            imagePath: scene.imagePath,
            description: scene.imagePrompt || scene.title || `scene ${i + 1}`,
          });
        } catch (e: any) {
          // R99 architect MEDIUM fix: surface non-fatal pool writes via
          // logSilentCatch so a failing frame_pool insert is observable
          // (silent-catch baseline + future debugging hook). The video
          // continues either way — pool writes are continuity-only, not
          // render-critical.
          const { logSilentCatch } = await import("./lib/silent-catch");
          logSilentCatch("server/mpeg-engine.ts:generateImageForScene:logFrame:preSupplied", e);
        }
      }
      return scene.imagePath;
    }
    if (scene.imagePrompt) {
      // R99 — pull most-relevant references (registry portraits + recent frames
      // from this job) and prepend their textual descriptions so gpt-image-2
      // gets richer character/environment context. Non-fatal on any failure.
      let promptPrefix = "";
      let refPaths: string[] = [];
      if (typeof options.tenantId === "number") {
        try {
          const { selectReferencesForFrame } = await import("./video/reference-selector");
          const sel = await selectReferencesForFrame({
            tenantId: options.tenantId,
            jobId,
            frameDescription: scene.imagePrompt,
            maxReferences: Math.max(1, Math.min(8, Number(process.env.VIDEO_REFERENCE_MAX) || 8)),
          });
          promptPrefix = sel?.promptPrefix || "";
          refPaths = Array.isArray(sel?.imagePaths) ? sel.imagePaths : [];
        } catch (e: any) {
          console.warn(`[mpeg-engine] R99 reference selection failed for scene ${i + 1} (non-fatal): ${e?.message?.slice(0, 80)}`);
        }
      }
      const finalPrompt = promptPrefix ? `${promptPrefix}\n\n${scene.imagePrompt}` : scene.imagePrompt;

      // R99 — hero scenes get best-of-N; first scene per job auto-promoted.
      const isHero = scene.qualityTier === "hero" || (scene.qualityTier !== "broll" && i === 0);
      const heroN = Math.max(1, Math.min(6, Number(process.env.VIDEO_HERO_CANDIDATES) || 3));
      const candidatesToGen = isHero ? heroN : 1;

      const candResults = await Promise.allSettled(
        Array.from({ length: candidatesToGen }, (_, c) => generateOneImageCandidate(finalPrompt, i, c, refPaths))
      );
      const candidatePaths: string[] = [];
      for (const r of candResults) {
        if (r.status === "fulfilled" && r.value) candidatePaths.push(r.value);
      }

      let winnerPath = "";
      if (candidatePaths.length === 1) {
        winnerPath = candidatePaths[0];
      } else if (candidatePaths.length >= 2) {
        if (typeof options.tenantId !== "number" || options.tenantId <= 0) {
          console.warn(`[mpeg-engine] Scene ${i + 1}: best-of-N grading skipped (no tenantId on job); using candidate 0`);
          winnerPath = candidatePaths[0];
        } else {
          try {
            const { selectBestImage } = await import("./video/best-image-selector");
            const sel = await selectBestImage({
              candidates: candidatePaths,
              references: refPaths.slice(0, 4),
              targetDescription: scene.imagePrompt,
              tenantId: options.tenantId,
            });
            winnerPath = sel?.winnerPath || candidatePaths[0];
            console.log(`[mpeg-engine] Scene ${i + 1}: best-of-${candidatePaths.length} winner=${path.basename(winnerPath)} reason="${(sel?.reason || "").slice(0, 60)}"`);
          } catch (e: any) {
            console.warn(`[mpeg-engine] Scene ${i + 1}: best-of-N grading failed (${e?.message?.slice(0, 60)}); using candidate 0`);
            winnerPath = candidatePaths[0];
          }
        }
      }

      if (winnerPath) {
        // R99 — log winner to frame pool for downstream scene continuity.
        if (typeof options.tenantId === "number") {
          try {
            const { logFrame } = await import("./video/reference-selector");
            await logFrame({
              tenantId: options.tenantId,
              jobId,
              frameIdx: i,
              imagePath: winnerPath,
              description: scene.imagePrompt,
            });
          } catch (e: any) {
            // R99 architect MEDIUM fix: see logFrame:preSupplied above.
            const { logSilentCatch } = await import("./lib/silent-catch");
            logSilentCatch("server/mpeg-engine.ts:generateImageForScene:logFrame:winner", e);
          }
        }
        return winnerPath;
      }
    }
    const slideFile = path.join(jobDir, `scene_${String(i + 1).padStart(3, "0")}.png`);
    const colors = ["#0f172a", "#1e1b4b", "#172554", "#1a1a2e", "#0c4a6e", "#1e3a5f", "#2c1654", "#164e63", "#1b263b", "#0d1b2a"];
    const bgColor = colors[i % colors.length];
    const displayTitle = escapeFFmpegText(scene.title || `Scene ${i + 1}`).slice(0, 50);
    const subtitle = scene.narration ? escapeFFmpegText(scene.narration).slice(0, 100) : "";
    const drawFilters: string[] = [];
    if (i === 0 && options.introText) {
      drawFilters.push(`drawtext=text='${escapeFFmpegText(options.title).slice(0, 40)}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=h/3`);
      if (subtitle) drawFilters.push(`drawtext=text='${subtitle.slice(0, 80)}':fontsize=28:fontcolor=#aaaaaa:x=(w-text_w)/2:y=h/2+60`);
    } else {
      drawFilters.push(`drawtext=text='${displayTitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h/3`);
      if (subtitle) drawFilters.push(`drawtext=text='${subtitle.slice(0, 80)}':fontsize=24:fontcolor=#cccccc:x=(w-text_w)/2:y=h/2+50`);
    }
    try {
      execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${width}x${height}:d=1`, "-vf", drawFilters.join(","), "-frames:v", "1", "-update", "1", slideFile], { timeout: 10000, stdio: "pipe" });
    } catch (drawErr: any) {
      console.warn(`[mpeg-engine] Scene ${i + 1} drawtext failed (${drawErr.message?.slice(0, 60)}), trying plain color`);
      try {
        execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${bgColor}:s=${width}x${height}:d=1`, "-frames:v", "1", "-update", "1", slideFile], { timeout: 5000, stdio: "pipe" });
      } catch (plainErr: any) {
        console.error(`[mpeg-engine] Scene ${i + 1} plain color fallback also failed: ${plainErr.message?.slice(0, 80)}`);
      }
    }
    return fs.existsSync(slideFile) ? slideFile : "";
  };

  const imageResults: string[] = new Array(scenes.length).fill("");
  for (let batch = 0; batch < scenes.length; batch += MAX_PARALLEL_IMAGES) {
    const batchSlice = scenes.slice(batch, batch + MAX_PARALLEL_IMAGES);
    const batchResults = await Promise.allSettled(
      batchSlice.map((scene, i) => generateImageForScene(scene, batch + i))
    );
    batchResults.forEach((r, i) => {
      imageResults[batch + i] = r.status === "fulfilled" ? r.value : "";
    });
  }

  for (let i = 0; i < scenes.length; i++) {
    const tts = ttsResults[i];
    sceneData.push({
      imagePath: imageResults[i] || "",
      audioPath: tts.audioPath,
      duration: scenes[i].durationOverride || tts.duration,
    });
  }

  const imageTime = ((Date.now() - imageStartTime) / 1000).toFixed(1);
  steps.push(`Phase 2 complete: ${sceneData.filter(s => s.imagePath).length} images in ${imageTime}s`);

  console.log(`[mpeg-engine] Phase 3: FFmpeg assembly...`);
  steps.push(`Phase 3: FFmpeg video assembly...`);
  const assemblyStart = Date.now();

  const segmentPaths: string[] = [];
  const tempFiles: string[] = [];

  // R110.19: Try Railway render worker first. Pure-ffmpeg microservice with
  // hot ffmpeg cache (Docker, not Nix) — eliminates the cold-start thrash
  // and Nix-snapshot corruption class permanently. Falls back to in-process
  // pipeline below if worker is unconfigured, unhealthy, or errors mid-job.
  //
  // R125+13.16 architect MAJOR fix: the render worker is a pure-ffmpeg
  // microservice that knows nothing about Veo / "Gemini Omni Flash" prompts.
  // If ANY scene requests Veo AND the global enable flag is on, force the
  // in-process path so videoClipPrompt is honored. Otherwise the worker
  // silently ignores it and ships a still-image-only render (silent feature
  // drop on the common hot path).
  let workerOutPath: string | null = null;
  const anyVeoRequested = isOmniFlashEnabled() && scenes.some(s => !!s?.videoClipPrompt);
  if (anyVeoRequested) {
    steps.push(`Render worker skipped — ${scenes.filter(s => s?.videoClipPrompt).length} scene(s) requested Veo (worker doesn't support videoClipPrompt yet)`);
    console.log(`[mpeg-engine] R125+13.16 forcing in-process render path: Veo requested on ≥1 scene`);
  }
  try {
    const renderClient = await import("./render-client");
    if (!anyVeoRequested && await renderClient.isRenderWorkerHealthy()) {
      const validScenes = sceneData.filter(s => s.imagePath && fs.existsSync(s.imagePath));
      if (validScenes.length > 0) {
        const workerStart = Date.now();
        const result = await renderClient.submitRenderJob({
          scenes: validScenes.map(s => ({
            imagePath: s.imagePath,
            audioPath: s.audioPath && fs.existsSync(s.audioPath) ? s.audioPath : undefined,
            durationSec: s.duration,
          })),
          resolution: `${width}x${height}`,
          fps,
          transition: (transition as any) || "fade",
          crossfadeMs: Math.round(crossfadeSec * 1000),
          outputName: `${safeTitle}_${Date.now()}.mp4`,
        }, OUTPUT_DIR);
        workerOutPath = result.outputPath;
        const workerSec = ((Date.now() - workerStart) / 1000).toFixed(1);
        steps.push(`Phase 3 (render worker): ${(((result.sizeBytes || 0)) / 1024 / 1024).toFixed(1)}MB in ${workerSec}s`);
        console.log(`[mpeg-engine] R110.19 render worker succeeded: ${workerSec}s, ${result.sizeBytes} bytes`);
      }
    }
  } catch (workerErr: any) {
    const errMsg = workerErr?.message?.slice(0, 200) || String(workerErr);
    console.warn(`[mpeg-engine] R110.19 render worker failed, falling back to in-process: ${errMsg}`);
    steps.push(`Render worker errored → in-process fallback: ${errMsg}`);
    workerOutPath = null;
  }

  // R125+13.16+sec — replace stringly-typed cap counter with a real integer.
  // Architect HIGH: filtering steps[] by message substring made the cost cap
  // silently fragile — any future reword of the success step would disable
  // the budget guard and let Veo fire unlimited scenes. Now: integer counter
  // declared once, incremented only on actual Veo success.
  // Also: NaN-guard the env-parsed cap (parseInt("abc") → NaN → cap silently
  // disabled). Negative or zero → cap kicks immediately (all scenes fallback).
  // Also: per-job wall-time budget. Veo per-scene latency is 30-90s typical
  // but can tail past 5 min; an 8-scene chapter sequential could exceed the
  // Replit Temporal StartToClose (~10-15 min). Once wall budget is exhausted,
  // remaining Veo-requested scenes fall through to still-image instead of
  // burning the whole activity timeout.
  let veoScenesUsed = 0;
  const veoMaxRaw = parseInt(process.env.GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB || "12", 10);
  const veoMaxPerJob = Number.isFinite(veoMaxRaw) ? veoMaxRaw : 12;
  const veoWallBudgetMs = (() => {
    const raw = parseInt(process.env.GEMINI_OMNI_FLASH_MAX_JOB_WALL_MS || "480000", 10);
    return Number.isFinite(raw) ? raw : 480_000; // 8 min default — keeps under Temporal 10-15 min
  })();
  const veoJobStart = Date.now();

  if (workerOutPath) {
    // Skip the in-process encoding+concat phases entirely; worker produced
    // a complete MP4. Continue at the bgmusic mixing + audio gate below.
  } else for (let i = 0; i < sceneData.length; i++) {
    const s = sceneData[i];
    if (!s.imagePath || !fs.existsSync(s.imagePath)) {
      steps.push(`⚠️ Scene ${i + 1} skipped — no image`);
      continue;
    }

    const segPath = path.join(jobDir, `seg_${String(i + 1).padStart(3, "0")}.mp4`);
    tempFiles.push(segPath);

    const hasRealAudio = s.audioPath && fs.existsSync(s.audioPath);

    // R125+13.16 — Optional Veo / "Gemini Omni Flash" path. Per-scene
    // videoClipPrompt + global enable flag opts in; ANY failure falls through
    // to the still-image + Ken Burns path so a transient Veo error or quota
    // hit never bricks a render.
    //
    // Architect MEDIUM fix: per-job Veo scene cap (env GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB,
    // default 12). Veo 3.1 fast runs ~$0.40-0.75/sec * 8s ≈ $3-6 per scene, so
    // a runaway caller marking every scene as Veo on a long video could rack up
    // real money. Cap is loud (logged in steps) so the operator sees it.
    const sceneVeoPrompt = scenes[i]?.videoClipPrompt;
    const veoWallElapsed = Date.now() - veoJobStart;
    const veoWallExceeded = veoWallElapsed >= veoWallBudgetMs;
    if (sceneVeoPrompt && isOmniFlashEnabled() && veoScenesUsed >= veoMaxPerJob) {
      console.warn(`[mpeg-engine] Scene ${i + 1}: Veo cap reached (${veoScenesUsed}/${veoMaxPerJob}) — falling back to still-image`);
      steps.push(`Scene ${i + 1}: Veo budget cap hit (${veoMaxPerJob}/job) → still-image fallback`);
    } else if (sceneVeoPrompt && isOmniFlashEnabled() && veoWallExceeded) {
      console.warn(`[mpeg-engine] Scene ${i + 1}: Veo wall-time budget exhausted (${(veoWallElapsed/1000).toFixed(1)}s/${(veoWallBudgetMs/1000).toFixed(0)}s) — falling back to still-image to protect Temporal timeout`);
      steps.push(`Scene ${i + 1}: Veo wall budget hit (${(veoWallBudgetMs/1000).toFixed(0)}s/job) → still-image fallback`);
    } else if (sceneVeoPrompt && isOmniFlashEnabled()) {
      const veoOk = await tryRenderVeoSegment({
        prompt: sceneVeoPrompt,
        sceneDur: s.duration,
        audioPath: hasRealAudio ? s.audioPath : null,
        outPath: segPath,
        width, height, fps,
        label: `${safeTitle} seg ${i + 1}/${sceneData.length}`,
      });
      if (veoOk) {
        veoScenesUsed++;
        segmentPaths.push(segPath);
        steps.push(`Scene ${i + 1}: rendered via Veo (${process.env.GEMINI_OMNI_FLASH_MODEL || "veo-3.1-fast-generate-preview"})`);
        continue;
      }
      console.warn(`[mpeg-engine] Scene ${i + 1} Veo path failed — falling back to still+kenBurns`);
      steps.push(`Scene ${i + 1}: Veo failed → still-image fallback`);
    }

    // R111.1 incident fix — was `probeDuration(s.audioPath)` (container header).
    // Fish Audio MP3s VBR-under-report by 2-4s; `probeAudioDurationAuthoritative`
    // takes the larger of stream + container probes so the looped image's `-t`
    // is always >= the true audio sample-data length. Without this, `-shortest`
    // clipped audio mid-narration and the audio-completeness gate (which uses
    // the stream probe) rejected the chapter. Pad bumped 1.5 → 2.5s belt &
    // suspenders. Falls back to old container probe if both new probes failed
    // (preserves old behavior on truly broken files).
    const audioDurAuth = hasRealAudio ? probeAudioDurationAuthoritative(s.audioPath) : null;
    const audioDur = hasRealAudio ? (audioDurAuth ?? probeDuration(s.audioPath)) : 0;
    const dur = hasRealAudio ? Math.max(s.duration, audioDur + 2.5) : s.duration;
    const usedProvidedImage = scenes[i]?.imagePath && fs.existsSync(scenes[i].imagePath!);

    const ffArgs = ["-y", "-loop", "1", "-i", s.imagePath, "-t", String(dur)];

    if (hasRealAudio) {
      ffArgs.push("-i", s.audioPath, "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest");
    } else {
      ffArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", String(dur), "-c:a", "aac");
    }

    let vf = usedProvidedImage
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    if (kenBurns && !usedProvidedImage) {
      const totalFrames = Math.ceil(dur * fps);
      const directions = ["zoom-in", "zoom-out", "pan-left", "pan-right"];
      const direction = directions[i % directions.length];
      const zoomStart = direction === "zoom-out" ? kenBurnsIntensity : 1.0;
      const zoomEnd = direction === "zoom-out" ? 1.0 : kenBurnsIntensity;
      const superW = Math.ceil(width * 1.33);
      const superH = Math.ceil(height * 1.33);
      const panX = direction === "pan-left" ? `iw/2-(iw/zoom/2)+((iw/zoom)*on/${totalFrames})`
        : direction === "pan-right" ? `iw/2-(iw/zoom/2)-((iw/zoom)*0.1*on/${totalFrames})`
        : "iw/2-(iw/zoom/2)";
      vf = `scale=${superW}:${superH}:force_original_aspect_ratio=increase,crop=${superW}:${superH},zoompan=z='${zoomStart}+(${zoomEnd}-${zoomStart})*on/${totalFrames}':x='${panX}':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
    }

    ffArgs.push("-vf", vf, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-movflags", "+faststart", "-r", String(fps), segPath);

    // R110.21: was execFileSync — blocked the Node event loop, which made
    // other chapters' Phase 3 ffmpeg calls run serial under a "parallel"
    // banner. Async spawn lets up to MAX_PARALLEL_CHAPTERS chapters' ffmpeg
    // processes ACTUALLY run at the same time.
    const segRes = await runFfmpegAsync(ffmpeg, ffArgs, {
      timeoutMs: 90_000,
      label: `${safeTitle} seg ${i + 1}/${sceneData.length}`,
      forwardStderrToConsole: true,
    });
    if (segRes.ok) {
      segmentPaths.push(segPath);
      console.log(`[mpeg-engine] ${safeTitle} seg ${i + 1}/${sceneData.length} encoded in ${(segRes.durationMs / 1000).toFixed(1)}s`);
    } else {
      console.error(`[mpeg-engine] Segment ${i + 1} failed (exit=${segRes.exitCode} timedOut=${segRes.timedOut}).\n  CMD: ffmpeg ${ffArgs.join(" ").slice(0, 200)}\n  STDERR: ${segRes.stderrTail.slice(-500)}`);
      steps.push(`⚠️ Scene ${i + 1} encoding failed — skipped`);
    }
  }

  if (!workerOutPath && segmentPaths.length === 0) {
    for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); } }
    quarantineJobDir(jobDir, "no_segments_encoded");
    return { success: false, scenesProcessed: 0, steps: [...steps, "No segments were successfully encoded"], error: "All scene encodings failed" };
  }

  // R110.19: outPath is the worker's output if the worker handled this job;
  // otherwise the in-process concat/xfade chain below builds it.
  const outPath = workerOutPath || path.join(OUTPUT_DIR, `${safeTitle}_${Date.now()}.mp4`);

  if (workerOutPath) {
    // Worker already produced the full MP4 — skip in-process stitching.
  } else if (segmentPaths.length < 2 || crossfadeSec <= 0) {
    const concatFile = path.join(jobDir, "concat.txt");
    tempFiles.push(concatFile);
    fs.writeFileSync(concatFile, segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    // R110.21: async spawn (was execFileSync — see seg encode above for why).
    const concatRes = await runFfmpegAsync(ffmpeg, [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(fps),
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      outPath
    ], { timeoutMs: 300_000, label: `${safeTitle} concat ${segmentPaths.length} segs`, forwardStderrToConsole: true });
    if (!concatRes.ok) {
      for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); } }
      quarantineJobDir(jobDir, "concat_failed");
      const errMsg = concatRes.timedOut ? `concat timed out after 300s` : `concat exit=${concatRes.exitCode}: ${concatRes.stderrTail.slice(-200)}`;
      return { success: false, scenesProcessed: segmentPaths.length, steps: [...steps, `Concat failed: ${errMsg.slice(0, 200)}`], error: errMsg };
    }
  } else {
    let currentPath = segmentPaths[0];
    for (let i = 1; i < segmentPaths.length; i++) {
      const fadedPath = path.join(jobDir, `faded_${i}.mp4`);
      tempFiles.push(fadedPath);
      const dur0 = probeDuration(currentPath);
      const offset = Math.max(0, dur0 - crossfadeSec);
      // R110.21: async spawn (was execFileSync — see seg encode above for why).
      const xfadeRes = await runFfmpegAsync(ffmpeg, [
        "-y", "-i", currentPath, "-i", segmentPaths[i],
        "-filter_complex", `[0:v][1:v]xfade=transition=${transition}:duration=${crossfadeSec}:offset=${offset}[vout];[0:a][1:a]acrossfade=d=${crossfadeSec}[aout]`,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(fps), "-c:a", "aac", fadedPath
      ], { timeoutMs: 300_000, label: `${safeTitle} xfade ${i}/${segmentPaths.length - 1}`, forwardStderrToConsole: true });
      if (xfadeRes.ok) {
        currentPath = fadedPath;
      } else {
        const xfadeStderr = xfadeRes.stderrTail.slice(-300) || "(no stderr)";
        console.warn(`[mpeg-engine] xfade transition at scene ${i + 1} failed: ${xfadeStderr}`);
        const concatFb = path.join(jobDir, `concat_fb_${i}.txt`);
        tempFiles.push(concatFb);
        fs.writeFileSync(concatFb, [currentPath, segmentPaths[i]].map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
        const fbPath = path.join(jobDir, `fb_${i}.mp4`);
        tempFiles.push(fbPath);
        const fbRes = await runFfmpegAsync(ffmpeg, [
          "-y", "-f", "concat", "-safe", "0", "-i", concatFb,
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(fps),
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          fbPath
        ], { timeoutMs: 300_000, label: `${safeTitle} xfade-fallback-concat ${i}`, forwardStderrToConsole: true });
        if (fbRes.ok) {
          currentPath = fbPath;
        } else {
          const concatStderr = fbRes.stderrTail.slice(-300) || "(no stderr)";
          console.error(`[mpeg-engine] concat fallback at scene ${i + 1} ALSO failed: ${concatStderr}`);
          steps.push(`⚠️ Transition at scene ${i + 1} failed, using hard cut (xfade: ${xfadeStderr.slice(-100)} | concat: ${concatStderr.slice(-100)})`);
        }
      }
    }
    if (currentPath !== outPath) {
      fs.copyFileSync(currentPath, outPath);
    }
  }

  if (options.backgroundMusicPath && fs.existsSync(options.backgroundMusicPath)) {
    const mixedPath = path.join(jobDir, `mixed_final.mp4`);
    tempFiles.push(mixedPath);
    // R110.21: async spawn (was execFileSync — see seg encode above for why).
    const bgRes = await runFfmpegAsync(ffmpeg, [
      "-y", "-i", outPath, "-i", options.backgroundMusicPath,
      "-filter_complex", `[1:a]volume=${musicVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
      // R74.13z-quint+10: faststart on the bg-music remux output. Without it,
      // -c:v copy preserves whatever moov layout the source had AND ffmpeg
      // writes a fresh container with moov-at-end by default. Drive's HTML5
      // preview then shows "still processing" forever.
      "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "-shortest", mixedPath
    ], { timeoutMs: 120_000, label: `${safeTitle} bgmusic mix`, forwardStderrToConsole: true });
    if (bgRes.ok) {
      fs.copyFileSync(mixedPath, outPath);
      steps.push(`Background music mixed at ${(musicVolume * 100).toFixed(0)}% volume`);
    } else {
      steps.push(`⚠️ Music mixing failed (video still OK): ${bgRes.stderrTail.slice(-80)}`);
    }
  }

  const assemblyTime = ((Date.now() - assemblyStart) / 1000).toFixed(1);
  const stats = fs.statSync(outPath);
  const totalDuration = probeDuration(outPath);
  steps.push(`Phase 3 complete: ${(stats.size / 1024 / 1024).toFixed(1)}MB video in ${assemblyTime}s`);

  // W1.1 AUDIO COMPLETENESS GATE: verify the muxed video's audio stream
  // duration is within ±250 ms of the sum of chunk durations. Catches the
  // ffmpeg "audio truncated to image length" / "concat dropped a stream"
  // class of bugs that would otherwise ship a video with a clean opening
  // and silent ending.
  // R111.1 incident fix — was `probeDuration` (container header). Match the
  // per-segment encoder's authoritative probe so "expected" equals what we
  // actually reserved runtime for. Otherwise the gate measures stream-duration
  // from the muxed file but compares against a container-duration sum and
  // false-fails by exactly the VBR header skew × scene count.
  const expectedAudioSec = sceneData.reduce((sum, s) => {
    const hasAudio = s.audioPath && fs.existsSync(s.audioPath);
    if (!hasAudio) return sum;
    const auth = probeAudioDurationAuthoritative(s.audioPath);
    return sum + (auth ?? probeDuration(s.audioPath));
  }, 0);
  if (expectedAudioSec > 0) {
    const measuredAudioSec = probeAudioStreamDuration(outPath);
    if (measuredAudioSec === null) {
      const errMsg = `Audio completeness gate FAILED: ffprobe could not read audio stream from muxed video (expected ${expectedAudioSec.toFixed(2)}s of narration). Likely environment corruption — see prior [mpeg-engine] probeAudioStreamDuration FAILED log line for stderr. If this fires repeatedly in prod, redeploy to a fresh VM (R110.8 libdrm-class incident).`;
      console.error(`[mpeg-engine] ${errMsg}`);
      try { fs.unlinkSync(outPath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
      quarantineJobDir(jobDir, "audio_gate_probe_failed");
      return { success: false, scenesProcessed: segmentPaths.length, steps: [...steps, `❌ ${errMsg}`], error: errMsg };
    }
    // R112.9: one-sided gate. Only TRUNCATED narration (measured < expected) is a real
    // defect — trailing silence (measured > expected) happens normally when Ken Burns
    // image-pan duration exceeds TTS duration and ffmpeg pads with silence at the end.
    const shortfall = expectedAudioSec - measuredAudioSec; // positive = truncated, negative = trailing silence
    const drift = Math.abs(measuredAudioSec - expectedAudioSec);
    const driftTolerance = Math.max(AUDIO_COMPLETENESS_TOLERANCE_SEC, expectedAudioSec * 0.04);
    console.log(`[mpeg-engine] Audio completeness: measured=${measuredAudioSec.toFixed(2)}s, expected=${expectedAudioSec.toFixed(2)}s, shortfall=${shortfall.toFixed(2)}s, tolerance=${driftTolerance.toFixed(2)}s`);
    if (measuredAudioSec <= 0) {
      const errMsg = `Audio completeness gate FAILED: muxed video has no audio stream (expected ${expectedAudioSec.toFixed(2)}s of narration)`;
      console.error(`[mpeg-engine] ${errMsg}`);
      try { fs.unlinkSync(outPath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
      quarantineJobDir(jobDir, "audio_gate_no_stream");
      return { success: false, scenesProcessed: segmentPaths.length, steps: [...steps, `❌ ${errMsg}`], error: errMsg };
    }
    if (shortfall > driftTolerance) {
      const errMsg = `Audio completeness gate FAILED: audio stream is ${measuredAudioSec.toFixed(2)}s but narration totalled ${expectedAudioSec.toFixed(2)}s (drift ${drift.toFixed(2)}s exceeds tolerance ${driftTolerance.toFixed(2)}s). Render rejected to prevent shipping a video with truncated audio.`;
      console.error(`[mpeg-engine] ${errMsg}`);
      try { fs.unlinkSync(outPath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
      quarantineJobDir(jobDir, "audio_gate_drift");
      return { success: false, scenesProcessed: segmentPaths.length, steps: [...steps, `❌ ${errMsg}`], error: errMsg };
    }
    steps.push(`✓ Audio completeness verified: ${measuredAudioSec.toFixed(2)}s audio matches ${expectedAudioSec.toFixed(2)}s narration (drift ${drift.toFixed(2)}s)`);
  }

  let driveUrl: string | undefined;
  if (options.uploadToDrive !== false) {
    try {
      const { uploadAndShare } = await import("./google-drive");
      const driveResult = await uploadAndShare({
        filePath: outPath,
        fileName: `${safeTitle}.mp4`,
        mimeType: "video/mp4",
        description: options.title,
        folderLabel: "VisionClaw Media/Videos",
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (driveResult.success && driveResult.viewUrl) {
        driveUrl = driveResult.viewUrl;
        steps.push(`Uploaded to Google Drive: ${driveUrl}`);
      }
    } catch (err: any) {
      steps.push(`⚠️ Drive upload failed: ${err.message?.slice(0, 80)}`);
    }
  }

  if (options.projectId) {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { assertProjectInTenant } = await import("./storage-helpers/project-tenant-guard");
      if (await assertProjectInTenant(options.projectId, options.tenantId)) {
        await db.execute(sql`INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by) VALUES (${options.projectId}, ${safeTitle + ".mp4"}, ${outPath}, ${driveUrl || null}, ${"video"}, ${stats.size}, ${"mpeg-engine"})`);
      } else {
        steps.push(`⚠️ project_files insert skipped — project #${options.projectId} not owned by tenant ${options.tenantId}`);
      }
    } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
  }

  if (options.emailTo && driveUrl) {
    try {
      await executeTool("send_email", {
        to: options.emailTo,
        subject: `Your video is ready: ${options.title}`,
        text: `Your video "${options.title}" has been produced.\n\nWatch/download: ${driveUrl}\n\n— VisionClaw MPEG Engine`,
        _tenantId: options.tenantId,
      }, options.tenantId);
      steps.push(`Email sent to ${options.emailTo}`);
    } catch (err: any) {
      steps.push(`⚠️ Email failed: ${err.message?.slice(0, 80)}`);
    }
  }

  for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); } }
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  steps.push(`Total production time: ${totalTime}s`);
  console.log(`[mpeg-engine] Job ${jobId} COMPLETE: ${totalDuration.toFixed(1)}s video, ${(stats.size / 1024 / 1024).toFixed(1)}MB, produced in ${totalTime}s`);

  return {
    success: true,
    filePath: outPath,
    driveUrl,
    durationSeconds: totalDuration,
    sizeBytes: stats.size,
    scenesProcessed: segmentPaths.length,
    steps,
  };
}

export async function concatenateClips(clipPaths: string[], outputName: string, transition?: string, crossfadeMs?: number): Promise<MpegJobResult> {
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  ensureDir(OUTPUT_DIR);

  const validClips = clipPaths.filter(p => fs.existsSync(p));
  if (validClips.length === 0) {
    return { success: false, scenesProcessed: 0, steps: ["No valid clip files found"], error: "No valid clips" };
  }

  const safeOutput = outputName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(OUTPUT_DIR, `${safeOutput}_${Date.now()}.mp4`);
  const crossfadeSec = (crossfadeMs || 0) / 1000;

  if (crossfadeSec > 0 && transition && validClips.length >= 2) {
    let currentPath = validClips[0];
    const tempFiles: string[] = [];
    for (let i = 1; i < validClips.length; i++) {
      const fadedPath = path.join(OUTPUT_DIR, `${safeOutput}_xfade_${i}.mp4`);
      tempFiles.push(fadedPath);
      const dur0 = probeDuration(currentPath);
      const offset = Math.max(0, dur0 - crossfadeSec);
      // R110.21: async spawn (non-blocking).
      const xfadeClipRes = await runFfmpegAsync(ffmpeg, [
        "-y", "-i", currentPath, "-i", validClips[i],
        "-filter_complex", `[0:v][1:v]xfade=transition=${transition}:duration=${crossfadeSec}:offset=${offset}[vout];[0:a][1:a]acrossfade=d=${crossfadeSec}[aout]`,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", fadedPath
      ], { timeoutMs: 120_000, label: `${safeOutput} clip-xfade ${i}/${validClips.length - 1}`, forwardStderrToConsole: true });
      if (xfadeClipRes.ok) {
        currentPath = fadedPath;
      } else {
        const xfadeClipStderr = xfadeClipRes.stderrTail.slice(-300) || "(no stderr)";
        console.warn(`[mpeg-engine] crossfade at clip ${i + 1} failed: ${xfadeClipStderr}`);
        steps.push(`⚠️ Crossfade at clip ${i + 1} failed, using hard concat (${xfadeClipStderr.slice(-120)})`);
      }
    }
    if (currentPath !== outPath) fs.copyFileSync(currentPath, outPath);
    for (const tf of tempFiles) { try { fs.unlinkSync(tf); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); } }
  } else {
    const concatFile = path.join(OUTPUT_DIR, `${safeOutput}_concat.txt`);
    fs.writeFileSync(concatFile, validClips.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    // R112.10: stream-copy concat. All chapter inputs come from the same
    // produceVideo pipeline (identical H.264/AAC/1920x1080/30fps/44.1kHz),
    // so we can remux without re-encoding. Cuts a 5-min video stitch from
    // 300s+ transcode to a few seconds. Fallback to re-encode on failure.
    const fastConcatRes = await runFfmpegAsync(ffmpeg, [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", "-movflags", "+faststart",
      outPath
    ], { timeoutMs: 120_000, label: `${safeOutput} final-concat-copy ${validClips.length} clips`, forwardStderrToConsole: true });
    let finalConcatRes = fastConcatRes;
    if (!fastConcatRes.ok) {
      const fastErr = fastConcatRes.stderrTail.slice(-200);
      console.warn(`[mpeg-engine] stream-copy concat failed (${fastErr.slice(-120)}), falling back to re-encode`);
      steps.push(`⚠️ Stream-copy concat failed, falling back to re-encode`);
      try { fs.unlinkSync(outPath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
      finalConcatRes = await runFfmpegAsync(ffmpeg, [
        "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        outPath
      ], { timeoutMs: 600_000, label: `${safeOutput} final-concat-reencode ${validClips.length} clips`, forwardStderrToConsole: true });
    }
    if (!finalConcatRes.ok) {
      const errMsg = finalConcatRes.timedOut ? `concat timed out after 600s` : `concat exit=${finalConcatRes.exitCode}: ${finalConcatRes.stderrTail.slice(-200)}`;
      return { success: false, scenesProcessed: 0, steps: [`Concat failed: ${errMsg.slice(0, 200)}`], error: errMsg };
    }
    try { fs.unlinkSync(concatFile); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
  }

  const stats = fs.statSync(outPath);
  const duration = probeDuration(outPath);
  steps.push(`Concatenated ${validClips.length} clips: ${duration.toFixed(1)}s, ${(stats.size / 1024 / 1024).toFixed(1)}MB`);

  return { success: true, filePath: outPath, durationSeconds: duration, sizeBytes: stats.size, scenesProcessed: validClips.length, steps };
}

export async function addAudioToVideo(videoPath: string, audioPath: string, outputName?: string, replaceAudio?: boolean): Promise<MpegJobResult> {
  const steps: string[] = [];
  const ffmpeg = getFFmpegPath();
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(videoPath)) return { success: false, scenesProcessed: 0, steps: ["Video file not found"], error: `Not found: ${videoPath}` };
  if (!fs.existsSync(audioPath)) return { success: false, scenesProcessed: 0, steps: ["Audio file not found"], error: `Not found: ${audioPath}` };

  const safeName = (outputName || "video_with_audio").replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(OUTPUT_DIR, `${safeName}_${Date.now()}.mp4`);

  // R110.21: async spawn (non-blocking).
  const audioRes = replaceAudio
    ? await runFfmpegAsync(ffmpeg, ["-y", "-i", videoPath, "-i", audioPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "-shortest", outPath], { timeoutMs: 120_000, label: `${safeName} audio-replace`, forwardStderrToConsole: true })
    : await runFfmpegAsync(ffmpeg, [
        "-y", "-i", videoPath, "-i", audioPath,
        "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3[aout]",
        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "-shortest", outPath
      ], { timeoutMs: 120_000, label: `${safeName} audio-mix`, forwardStderrToConsole: true });
  if (!audioRes.ok) {
    const errMsg = audioRes.timedOut ? `audio merge timed out after 120s` : `audio merge exit=${audioRes.exitCode}: ${audioRes.stderrTail.slice(-200)}`;
    return { success: false, scenesProcessed: 0, steps: [`Audio merge failed: ${errMsg.slice(0, 200)}`], error: errMsg };
  }

  const stats = fs.statSync(outPath);
  steps.push(`Audio ${replaceAudio ? "replaced" : "mixed"}: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  return { success: true, filePath: outPath, sizeBytes: stats.size, scenesProcessed: 1, steps };
}

export interface ChapterSpec {
  chapterTitle: string;
  scenes: MpegScene[];
}

export interface ParallelVideoOptions extends Omit<MpegJobOptions, "scenes"> {
  chapters: ChapterSpec[];
  maxParallelChapters?: number;
}

// Memory-aware adaptive chapter concurrency. True separate-container fan-out
// needs paid infra; within one box the safe free lever is to run as many
// parallel chapter encodes as free RAM allows (then stream-copy concat at the
// end). 6 simultaneous 1080p ffmpeg encodes OOM-recycled the WHOLE container;
// this sizes concurrency to os.freemem() so it never OOMs and auto-scales up
// when more RAM is free (off-hours / lighter load / bigger box). An explicit
// maxParallelChapters (incl. env VIDEO_MAX_PARALLEL_CHAPTERS) still wins.
// Tunable per box via RENDER_PER_CHAPTER_MEM_MB / RENDER_MEM_RESERVE_MB.
// Result always clamped to [1, 6] (the engine's hard ceiling).
async function computeSafeChapterConcurrency(): Promise<number> {
  try {
    const os = await import("os");
    const perChapterMb = Math.max(256, parseInt(process.env.RENDER_PER_CHAPTER_MEM_MB || "700", 10) || 700);
    const reserveMb = Math.max(256, parseInt(process.env.RENDER_MEM_RESERVE_MB || "600", 10) || 600);
    const freeMb = os.freemem() / (1024 * 1024);
    const n = Math.floor((freeMb - reserveMb) / perChapterMb);
    return Math.min(6, Math.max(1, Number.isFinite(n) ? n : 1));
  } catch {
    return 2;
  }
}

export async function produceVideoParallel(options: ParallelVideoOptions): Promise<MpegJobResult> {
  const startTime = Date.now();
  const steps: string[] = [];
  const explicit = typeof options.maxParallelChapters === "number" && options.maxParallelChapters > 0;
  const maxParallel = explicit
    ? Math.min(Math.max(1, options.maxParallelChapters as number), 6)
    : await computeSafeChapterConcurrency();
  const concurrencyMode = explicit
    ? "explicit"
    : `auto (RAM-sized; ${(await import("os")).freemem() / 1024 / 1024 | 0}MB free)`;
  const chapters = options.chapters;

  if (!chapters || chapters.length === 0) {
    return { success: false, scenesProcessed: 0, steps: ["No chapters provided"], error: "No chapters" };
  }

  const totalScenes = chapters.reduce((sum, ch) => sum + ch.scenes.length, 0);
  console.log(`[mpeg-parallel] Starting parallel video: ${chapters.length} chapters, ${totalScenes} scenes, ${maxParallel} concurrent workers [${concurrencyMode}]`);
  steps.push(`Parallel video: ${chapters.length} chapters, ${totalScenes} scenes, ${maxParallel} workers [${concurrencyMode}]`);

  // R110.16 — Preflight at the parallel entry point: if libdrm/ffmpeg is broken
  // we'd otherwise spawn N parallel chapter workers that all fail with the same
  // libdrm error, returning an "all_chapters_failed" envelope that buries the
  // real cause. Single preflight here = fail in <100ms instead of N × ~80s.
  {
    const { ffmpegPreflight } = await import("./lib/ffmpeg-preflight");
    const pre = ffmpegPreflight(getFFmpegPath(), "mpeg-parallel");
    if (!pre.ok) {
      return {
        success: false,
        scenesProcessed: 0,
        steps: [...steps, `❌ ${pre.errMsg}`],
        error: pre.errMsg,
        error_envelope: {
          error_type: pre.errorType,
          retry_in_seconds: null,
          suggested_action: pre.suggestedAction,
          ffmpeg_stderr: pre.ffmpegStderr,
        },
      } as any;
    }
  }

  const chapterResults: { idx: number; result: MpegJobResult }[] = [];
  const cleanupAllChapters = () => {
    for (const cr of chapterResults) {
      try { if (cr.result.filePath && fs.existsSync(cr.result.filePath)) fs.unlinkSync(cr.result.filePath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
    }
  };

  try {

  for (let batch = 0; batch < chapters.length; batch += maxParallel) {
    const batchChapters = chapters.slice(batch, batch + maxParallel);
    const batchLabel = `Batch ${Math.floor(batch / maxParallel) + 1}: chapters ${batch + 1}-${batch + batchChapters.length}`;
    console.log(`[mpeg-parallel] ${batchLabel} — launching ${batchChapters.length} parallel workers`);
    steps.push(`${batchLabel}: launching ${batchChapters.length} workers...`);

    const batchPromises = batchChapters.map(async (chapter, i) => {
      const chapterIdx = batch + i;
      const chapterStart = Date.now();
      console.log(`[mpeg-parallel] Chapter ${chapterIdx + 1}/${chapters.length}: "${chapter.chapterTitle}" (${chapter.scenes.length} scenes) — STARTED`);

      const chapterResult = await produceVideo({
        title: `${options.title}_ch${chapterIdx + 1}_${chapter.chapterTitle}`,
        scenes: chapter.scenes,
        voice: options.voice,
        voiceProvider: options.voiceProvider,
        strictVoice: options.strictVoice,
        resolution: options.resolution,
        fps: options.fps,
        transition: options.transition,
        crossfadeMs: options.crossfadeMs,
        kenBurns: options.kenBurns,
        kenBurnsIntensity: options.kenBurnsIntensity,
        tenantId: options.tenantId,
        uploadToDrive: false,
      });

      const elapsed = ((Date.now() - chapterStart) / 1000).toFixed(1);
      console.log(`[mpeg-parallel] Chapter ${chapterIdx + 1}: ${chapterResult.success ? "SUCCESS" : "FAILED"} in ${elapsed}s (${chapterResult.scenesProcessed} scenes)`);
      return { idx: chapterIdx, result: chapterResult };
    });

    const batchResults = await Promise.allSettled(batchPromises);
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        chapterResults.push(r.value);
        steps.push(`Chapter ${r.value.idx + 1} ("${chapters[r.value.idx].chapterTitle}"): ${r.value.result.success ? "OK" : "FAILED"} — ${r.value.result.scenesProcessed} scenes, ${r.value.result.durationSeconds?.toFixed(1) || 0}s`);
      } else {
        steps.push(`Chapter ${batch + batchResults.indexOf(r) + 1}: FAILED — ${(r as PromiseRejectedResult).reason?.message?.slice(0, 100)}`);
      }
    }
  }

  const successChapters = chapterResults
    .filter(cr => cr.result.success && cr.result.filePath && fs.existsSync(cr.result.filePath!))
    .sort((a, b) => a.idx - b.idx);

  if (successChapters.length === 0) {
    // R110.7 — propagate the FIRST chapter's structured error so the agent
    // doesn't see the bare "All chapters failed" string and hallucinate a cause.
    const firstChapterError = chapterResults.find(cr => !cr.result.success);
    const innerEnvelope = (firstChapterError?.result as any)?.error_envelope;
    const innerError = firstChapterError?.result.error || "no error message returned by chapter worker";
    return {
      success: false,
      scenesProcessed: 0,
      steps: [...steps, "All chapter productions failed"],
      error: `All chapters failed. First chapter error: ${innerError}`,
      error_envelope: {
        error_type: innerEnvelope?.error_type || "all_chapters_failed",
        failed_chapter_count: chapterResults.length,
        first_chapter_envelope: innerEnvelope || null,
        suggested_action: innerEnvelope?.suggested_action || `All ${chapterResults.length} parallel chapter renders failed. Inspect first_chapter_envelope for the underlying cause. Common causes: TTS internal quota (bump generate_audio limit in tool-rate-limiter.ts), upstream provider rate limit (wait + retry), bad ffmpeg arg (check stderr in chapter logs).`,
      },
    } as any;
  }

  console.log(`[mpeg-parallel] Concatenating ${successChapters.length} chapter segments...`);
  steps.push(`Concatenating ${successChapters.length} chapter segments...`);

  const clipPaths = successChapters.map(cr => cr.result.filePath!);
  // Stitch auto-retry. concatenateClips already has a copy→re-encode fallback
  // ladder, but a TRANSIENT infra fault (overlayFS EIO, an ffmpeg spawn glitch,
  // a momentary timeout) would otherwise fail the whole parallel job and strand
  // every completed chapter render, forcing a manual re-trigger. Retry the
  // stitch up to 3x with short linear backoff on a non-success result before
  // giving up — bounded, so a genuinely broken input still fails fast.
  const stitchName = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const stitchTransition = options.transition || "fade";
  const stitchCrossfadeMs = options.crossfadeMs ?? 400;
  let concatResult = await concatenateClips(clipPaths, stitchName, stitchTransition, stitchCrossfadeMs);
  for (let stitchAttempt = 2; (!concatResult.success || !concatResult.filePath) && stitchAttempt <= 3; stitchAttempt++) {
    const waitMs = 1500 * (stitchAttempt - 1);
    console.warn(`[mpeg-parallel] Stitch attempt ${stitchAttempt - 1} failed (${(concatResult.error || "unknown").slice(0, 120)}) — retrying in ${waitMs}ms (attempt ${stitchAttempt}/3)`);
    steps.push(`⚠️ Stitch failed, auto-retrying (attempt ${stitchAttempt}/3)`);
    await new Promise((r) => setTimeout(r, waitMs));
    concatResult = await concatenateClips(clipPaths, stitchName, stitchTransition, stitchCrossfadeMs);
  }

  if (!concatResult.success || !concatResult.filePath) {
    for (const cr of successChapters) {
      try { if (cr.result.filePath) fs.unlinkSync(cr.result.filePath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
    }
    return { success: false, scenesProcessed: successChapters.reduce((s, cr) => s + cr.result.scenesProcessed, 0), steps: [...steps, ...concatResult.steps, "Concatenation failed"], error: concatResult.error };
  }

  steps.push(...concatResult.steps);

  if (options.backgroundMusicPath && fs.existsSync(options.backgroundMusicPath)) {
    const musicResult = await addAudioToVideo(concatResult.filePath, options.backgroundMusicPath, options.title.replace(/[^a-zA-Z0-9_-]/g, "_"), false);
    if (musicResult.success && musicResult.filePath) {
      fs.copyFileSync(musicResult.filePath, concatResult.filePath);
      try { fs.unlinkSync(musicResult.filePath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
      steps.push("Background music added");
    }
  }

  let driveUrl: string | undefined;
  if (options.uploadToDrive !== false) {
    try {
      const { uploadAndShare } = await import("./google-drive");
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      const driveResult = await uploadAndShare({
        filePath: concatResult.filePath,
        fileName: `${safeTitle}.mp4`,
        mimeType: "video/mp4",
        description: options.title,
        folderLabel: "VisionClaw Media/Videos",
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (driveResult.success && driveResult.viewUrl) {
        driveUrl = driveResult.viewUrl;
        steps.push(`Uploaded to Google Drive: ${driveUrl}`);
      }
    } catch (err: any) {
      steps.push(`Drive upload failed: ${err.message?.slice(0, 80)}`);
    }
  }

  if (options.projectId) {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { assertProjectInTenant } = await import("./storage-helpers/project-tenant-guard");
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      if (await assertProjectInTenant(options.projectId, options.tenantId)) {
        await db.execute(sql`INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by) VALUES (${options.projectId}, ${safeTitle + ".mp4"}, ${concatResult.filePath}, ${driveUrl || null}, ${"video"}, ${concatResult.sizeBytes || 0}, ${"mpeg-engine-parallel"})`);
      } else {
        steps.push(`⚠️ project_files insert skipped — project #${options.projectId} not owned by tenant ${options.tenantId}`);
      }
    } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
  }

  if (options.emailTo && driveUrl) {
    try {
      const { executeTool } = await import("./tools");
      await (executeTool as any)("send_email", {
        to: options.emailTo,
        subject: `Your video is ready: ${options.title}`,
        text: `Your video "${options.title}" has been produced using parallel chapter rendering.\n\nChapters: ${chapters.length}\nTotal scenes: ${totalScenes}\n\nWatch/download: ${driveUrl}\n\n— VisionClaw MPEG Engine (Parallel)`,
        _tenantId: options.tenantId,
      }, options.tenantId);
      steps.push(`Email sent to ${options.emailTo}`);
    } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
  }

  for (const cr of successChapters) {
    try { if (cr.result.filePath) fs.unlinkSync(cr.result.filePath); } catch (_silentErr) { logSilentCatch("server/mpeg-engine.ts", _silentErr); }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalDuration = probeDuration(concatResult.filePath);
  const finalSize = fs.statSync(concatResult.filePath).size;
  steps.push(`PARALLEL production complete: ${finalDuration.toFixed(1)}s video in ${totalTime}s (${chapters.length} chapters, ${successChapters.length} succeeded)`);
  console.log(`[mpeg-parallel] DONE: ${finalDuration.toFixed(1)}s video, ${(finalSize / 1024 / 1024).toFixed(1)}MB, ${chapters.length} chapters in ${totalTime}s`);

  return {
    success: true,
    filePath: concatResult.filePath,
    driveUrl,
    durationSeconds: finalDuration,
    sizeBytes: finalSize,
    scenesProcessed: successChapters.reduce((s, cr) => s + cr.result.scenesProcessed, 0),
    steps,
  };

  } catch (unexpectedErr: any) {
    console.error(`[mpeg-parallel] Unexpected error — cleaning up chapter files: ${unexpectedErr.message?.slice(0, 200)}`);
    cleanupAllChapters();
    return { success: false, scenesProcessed: 0, steps: [...steps, `Unexpected error: ${unexpectedErr.message?.slice(0, 150)}`], error: unexpectedErr.message };
  }
}

/**
 * GitHub Actions render farm — shared, BRAND-AGNOSTIC core.
 *
 * FREE true multi-container fan-out: each chapter renders in its OWN
 * GitHub-hosted runner (separate ~7 GB container, ffmpeg preinstalled), then a
 * final job stitches them. No paid infra (no Railway, no deployed worker).
 *
 * Secrets NEVER touch CI: this module pre-renders every scene image + narration
 * audio HERE (where the LLM/TTS/image keys live), ships only static bytes in a
 * bundle, and CI runs pure ffmpeg.
 *
 * This is the ONE source of truth for the render-farm machinery, used by BOTH:
 *   - scripts/bwb-render-github.ts      (Built With Bob — brand-validated, Fish voice)
 *   - scripts/render-github-generic.ts  (generic/customer videos — caller voice)
 *
 * The brand opinions (BWB validation, Bob's Fish voice lock, hardcoded delivery)
 * live in the callers, NOT here. This core only knows: scenes in -> MP4 out, via
 * the GitHub Actions chapter-matrix workflow.
 *
 * Pipeline (renderOnGithubFarm):
 *   1. Pre-bake scene images (reuses on-disk images when present)
 *   2. Generate per-scene narration audio (caller's voice/provider) + probe durations
 *   3. Bundle images+audio+manifest+renderer -> tar.gz
 *   4. Upload bundle as a GitHub Release asset
 *   5. Dispatch the chapter-matrix workflow
 *   6. Poll the run; on success download the final-video artifact
 *   7. Clean up the release; return the on-disk MP4 path (caller handles delivery)
 */
import fs from "node:fs";
import path from "node:path";
import { readFileSyncEIO, copyFileSyncEIO, retryEIOAsync, statSyncEIO, existsSyncEIO, writeFileSyncEIO } from "./eio-read";
import { imageMatchesPrompt, writeScenePromptSidecar, pruneStaleSceneImages } from "./bwb-scene-fingerprint";
import { audioMatchesInputs, writeAudioSidecar } from "./bwb-audio-fingerprint";
import { estimateNarrationSeconds, compareEstimateVsActual, TIMING_TOLERANCE_SEC } from "./bwb-narration-timing";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import { getFfprobePath } from "../../server/lib/ffmpeg-paths";
import { create as tarCreate } from "tar";
import AdmZip from "adm-zip";
import { generateImage } from "../../server/replit_integrations/image/client";
import { executeTool } from "../../server/tools";
import { checkDailyCap, resolveDailyCap, DAILY_CAP_FILE, MAX_CHAPTERS_PER_RENDER } from "./render-farm-cap";

export { MAX_CHAPTERS_PER_RENDER } from "./render-farm-cap";

const API = "https://api.github.com";
export const WORKFLOW_FILE = "bwb-render.yml";
export const DEFAULT_CHAPTER_SIZE = 3;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

export interface FarmScene { narration: string; imagePrompt?: string; imagePath?: string; }

export interface RenderFarmOptions {
  /** Stable id for this video; used for scene dir, job id, output filename. */
  videoId: string;
  /** Ordered scenes (narration + image). At least one required. */
  scenes: FarmScene[];
  /** TTS voice id/name passed to generate_audio. */
  voice: string;
  /** TTS provider passed to generate_audio (default "fish"). */
  voiceProvider?: string;
  /** When true, a TTS voice failure fails the render instead of cascading. */
  strictVoice?: boolean;
  /** Manifest video dims / quality. */
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  /** Scenes per chapter (GitHub matrix job). */
  chapterSize?: number;
  /** Where to write the finished MP4 on the app box. */
  outMp4: string;
  /** owner/repo override; defaults to GH_RENDER_REPO env or Huskyauto/VisionClaw-Agent. */
  repoSpec?: string;
  /** Directory to reuse/persist pre-baked scene images. */
  sceneDir?: string;
  /** Label threaded into generateImage for cost telemetry. */
  callerLabel?: string;
  /** generateImage purpose (cost-aware cascade). */
  imagePurpose?: string;
  /** Whether scene images are customer-facing (cascade leads with gpt-image-2). */
  isCustomerFacing?: boolean;
  /**
   * Fail closed unless the render repo is PRIVATE. Customer media is uploaded as
   * a (prerelease) GitHub Release asset for the CI run; on a public repo that
   * media would be world-readable during the render window. The generic/customer
   * path sets this true so a misconfigured GH_RENDER_REPO can't leak customer
   * content. (BWB content is Bob's own public YouTube material, so it leaves this
   * false.)
   */
  requirePrivateRepo?: boolean;
  /**
   * Skip the daily render-cost cap entirely. The cap exists to stop runaway
   * AUTOMATED / customer render volume from surprise-billing GitHub Actions. Bob's
   * own personal work (e.g. the BWB channel) is content he's deliberately paying
   * for, so those callers set this true and render uncapped. (An operator can also
   * bypass the cap per-run on the generic path with RENDER_FARM_NO_CAP=1.)
   */
  skipDailyCap?: boolean;
  /** Overall poll timeout for the CI run. */
  pollTimeoutMs?: number;
  /** Fail function (callers may inject their own die). */
  fail?: (msg: string) => never;
  /** Log function. */
  log?: (msg: string) => void;
  /**
   * Optional progress sink. Called as the render advances (pre-bake, audio gen,
   * and every poll tick) with a free-text phase line and/or per-chapter status.
   * Best-effort: the core wraps each call in try/catch so a progress write can
   * never break the render. The BWB caller maps this onto the video_jobs row so
   * the chat banner + /jobs popup show live progress; the generic path omits it.
   */
  onProgress?: (p: FarmProgress) => void;
}

export interface FarmProgressChapter {
  idx: number; // 0-based
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
}

export interface FarmProgress {
  phase?: string;
  totalChapters?: number;
  chapters?: FarmProgressChapter[];
}

export interface RenderFarmResult {
  outMp4: string;
  chapters: number;
  runUrl: string;
  jobId: string;
}

function defaultDie(msg: string): never {
  console.error(`\n[gh-render] FAIL: ${msg}\n`);
  process.exit(1);
}

export function ghToken(): string {
  return process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN || "";
}

export function hasGithubFarmToken(): boolean {
  return !!ghToken();
}

export function resolveRepo(fail: (msg: string) => never, repoSpec?: string): { owner: string; repo: string } {
  // Default to the repo that scripts/git-push.sh actually pushes to (origin),
  // since the workflow YAML must already be on that repo's default branch for
  // workflow_dispatch to be available. Override with GH_RENDER_REPO=owner/repo.
  const spec = repoSpec || process.env.GH_RENDER_REPO || "Huskyauto/VisionClaw-Agent";
  const [owner, repo] = spec.split("/");
  if (!owner || !repo) fail(`invalid repo spec "${spec}" (want owner/repo)`);
  return { owner, repo };
}

async function gh(
  token: string,
  method: string,
  url: string,
  body?: any,
  extraHeaders?: Record<string, string>,
  timeoutMs = 120_000,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "render-farm-orchestrator",
    ...(extraHeaders || {}),
  };
  if (body && !extraHeaders?.["Content-Type"]) headers["Content-Type"] = "application/json";
  // Bounded I/O: an unattended cron render must fail LOUD on a stalled socket
  // rather than hang indefinitely. AbortController converts a hung GitHub
  // API/transfer call into a thrown error the caller's die() handles.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url.startsWith("http") ? url : `${API}${url}`, {
      method,
      headers,
      body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function ffprobeDuration(file: string): number {
  const r = spawnSync(getFfprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8", env: sanitizeSpawnEnv(process.env) });
  // NaN (not 0) on probe failure so the caller fails loud instead of silently
  // substituting a fixed fake scene duration when the toolchain is broken.
  if ((r.status ?? 1) !== 0) return NaN;
  const d = parseFloat((r.stdout || "").trim());
  return Number.isFinite(d) && d > 0 ? d : NaN;
}

// Extract one member from a GitHub artifact zip. PRIMARY path is pure-JS,
// in-process (adm-zip) so it depends on NO external binary and NO PATH — the
// failure that stranded a fully-rendered (paid) farm job was the CLI ladder
// below (unzip/python3/bsdtar) ALL reporting "unavailable/failed" on the prod
// Reserved VM, which then re-rendered everything from scratch on retry. adm-zip
// can't ENOENT, removing that entire failure class. The CLI ladder is kept only
// as a defensive fallback. Success = the expected file exists on disk, non-empty.
function extractFromZip(zipPath: string, member: string, destDir: string): boolean {
  fs.mkdirSync(destDir, { recursive: true });
  const target = path.join(destDir, member);

  // PRIMARY: in-process JS extraction — no spawn, no binary, no PATH roulette.
  // Read the zip THROUGH the EIO budget: AdmZip(path) would do its own raw read
  // off the flaky overlayFS, and a prolonged-degraded-FS EIO there silently fell
  // to the CLI ladder below — which doesn't exist on the prod Reserved VM, so a
  // fully-rendered (paid) farm job died at extraction. Feeding AdmZip a Buffer we
  // read with readFileSyncEIO routes the zip read through the same retry budget.
  try {
    const zip = new AdmZip(readFileSyncEIO(zipPath));
    const entry = zip.getEntry(member);
    if (entry && !entry.isDirectory) {
      const data = zip.readFile(entry);
      if (data && data.length > 0) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        writeFileSyncEIO(target, data);
        if (fs.existsSync(target) && fs.statSync(target).size > 0) return true; // eio-safe: inside try (catch falls through to CLI ladder)
      }
    }
  } catch { /* fall through to the CLI ladder */ }

  // FALLBACK ladder: each attempt must exit 0 AND produce the file on disk.
  const attempts: Array<[string, string[]]> = [
    ["unzip", ["-o", "-j", zipPath, member, "-d", destDir]],
    ["python3", ["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[2], sys.argv[3])", zipPath, member, destDir]],
    ["bsdtar", ["-xf", zipPath, "-C", destDir, member]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      const r = spawnSync(cmd, args, { stdio: "inherit", env: sanitizeSpawnEnv(process.env) });
      if (r.status === 0 && fs.existsSync(target) && fs.statSync(target).size > 0) return true; // eio-safe: inside try (catch tries next extractor)
    } catch { /* try next extractor */ }
  }
  return false;
}

// Verify an image decodes to a real video stream with positive dimensions.
// A corrupt/truncated PNG (e.g. a timed-out bake) passes existsSync but makes
// ffmpeg's `-loop 1 -i bad.png` hang FOREVER in CI instead of erroring. Catch
// it here on the box — before bundling — and fail fast with a clear message.
function validImageDims(file: string): boolean {
  const r = spawnSync(
    getFfprobePath(),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8", env: sanitizeSpawnEnv(process.env) },
  );
  const nums = (r.stdout || "").trim().split(/\s+/).map(Number);
  return r.status === 0 && nums.length >= 2 && nums.every((n) => Number.isFinite(n) && n > 0);
}

async function bakeImage(prompt: string, dest: string, opts: { callerLabel: string; purpose: string; isCustomerFacing: boolean }, fail: (msg: string) => never): Promise<void> {
  const result = await generateImage(prompt, { purpose: opts.purpose as any, isCustomerFacing: opts.isCustomerFacing, callerLabel: opts.callerLabel });
  const m = result.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) fail(`generateImage returned non-data-URI (first 80): ${result.slice(0, 80)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSyncEIO(dest, Buffer.from(m![2], "base64"));
}

// Generate narration audio for one scene via the same tool the engine uses.
// Returns the on-disk audio path.
async function genSceneAudio(
  text: string,
  filename: string,
  cfg: { provider: string; voice: string; strictVoice: boolean },
  fail: (msg: string) => never,
): Promise<string> {
  // The handler sanitizes the filename and writes project-assets/<sanitized>.<ext>.
  const sanitized = filename.replace(/[^a-zA-Z0-9_-]/g, "_");
  const mp3 = path.resolve("project-assets", `${sanitized}.mp3`);
  const wav = path.resolve("project-assets", `${sanitized}.wav`);

  // REUSE (Bob 2026-06-21): if a clip for THESE exact inputs (provider+voice+text)
  // already sits on disk from a prior attempt, reuse it and skip the TTS call.
  // The weekly recap videoId is date-stable and survives a same-job resume via the
  // planning checkpoint, so the filename is stable across retries — without this a
  // re-run that only needed the final farm render re-synthesized every line and
  // re-burned Fish/ElevenLabs tokens. Gated on a content fingerprint so a changed
  // narration line (or a voice change) still re-synthesizes only what changed.
  for (const existing of [mp3, wav]) {
    if (audioMatchesInputs(existing, cfg.provider, cfg.voice, text)) {
      console.log(`[gh-render] reusing narration audio (fingerprint match, no TTS spend): ${path.basename(existing)}`);
      return existing;
    }
  }

  const res = await executeTool("generate_audio", { provider: cfg.provider, text, voice: cfg.voice, strictVoice: cfg.strictVoice, filename });
  const candidates = [
    (res && (res.audioPath || res.path || res.filePath || res.file)) as string | undefined,
    mp3,
    wav,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c && existsSyncEIO(c)) {
      // Drop the fingerprint sidecar so the next attempt can reuse this clip.
      writeAudioSidecar(c, cfg.provider, cfg.voice, text);
      return c;
    }
  }
  fail(`generate_audio produced no readable file for "${filename}". tool result: ${JSON.stringify(res).slice(0, 200)}`);
}

// Re-export the pure cap helper so existing importers keep working.
export { checkDailyCap } from "./render-farm-cap";

/** Synchronous sleep (no spawn) so the cap lock can back off without going async. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Daily render-cap guard. Bob's ONE concern with moving all video to the farm is
 * surprise GitHub bills, so this is FAIL-CLOSED on every error path: a counter
 * that can't be read or persisted REFUSES the render rather than silently
 * disabling the budget. The read-modify-write is serialized with an O_EXCL lock
 * file so concurrent detached renders can't all read the same count and overrun
 * the cap (stale lock >60s is reclaimed so a crashed render can't wedge the gate).
 */
function enforceDailyCap(fail: (msg: string) => never, log: (msg: string) => void): void {
  const cap = resolveDailyCap(process.env.RENDER_FARM_DAILY_CAP);
  try {
    fs.mkdirSync(path.dirname(DAILY_CAP_FILE), { recursive: true });
  } catch (e: any) {
    fail(`could not create render-cap dir (${e?.message || e}) — refusing to render (fail-closed) so the GitHub Actions budget guard can't be bypassed.`);
  }
  const lockFile = `${DAILY_CAP_FILE}.lock`;
  let lockFd: number | null = null;
  for (let i = 0; i < 50 && lockFd === null; i++) {
    try {
      lockFd = fs.openSync(lockFile, "wx");
    } catch (e: any) {
      if (e?.code !== "EEXIST") {
        fail(`render-cap lock error (${e?.message || e}) — refusing to render (fail-closed) to avoid uncapped GitHub Actions usage.`);
      }
      try {
        const st = fs.statSync(lockFile); // eio-safe: inside try (catch retries the lock open)
        if (Date.now() - st.mtimeMs > 60_000) { fs.unlinkSync(lockFile); continue; } // reclaim stale lock
      } catch { /* lock vanished — retry the open */ }
      sleepSync(100);
    }
  }
  if (lockFd === null) {
    fail("could not acquire the render-cap lock within ~5s — refusing to render (fail-closed) to avoid uncapped GitHub Actions usage. Another render may be in flight; retry shortly.");
  }
  try {
    let prev: { date?: string; count?: number } | null = null;
    try {
      if (existsSyncEIO(DAILY_CAP_FILE)) prev = JSON.parse(readFileSyncEIO(DAILY_CAP_FILE, "utf8"));
    } catch (e: any) {
      fail(`render-cap counter unreadable/corrupt (${e?.message || e}) — refusing to render (fail-closed) so a bad counter can't disable the budget guard. Inspect or delete ${DAILY_CAP_FILE} to reset.`);
    }
    const { allowed, next, remaining } = checkDailyCap(prev, cap);
    if (!allowed) {
      fail(`daily render cap reached (${cap} renders today). Raise RENDER_FARM_DAILY_CAP to override, or wait until tomorrow (UTC). This guard prevents runaway GitHub Actions usage.`);
    }
    try {
      writeFileSyncEIO(DAILY_CAP_FILE, JSON.stringify(next));
    } catch (e: any) {
      fail(`could not persist render-cap counter (${e?.message || e}) — refusing to render (fail-closed) so an unrecorded render can't let the daily budget be exceeded.`);
    }
    log(`[gh-render] daily render budget: ${next.count}/${cap} used (${remaining} left today)`);
  } finally {
    try { if (lockFd !== null) fs.closeSync(lockFd); } catch { /* ignore */ }
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }
}

/**
 * Fail closed unless the render target repo is private. Customer media rides in a
 * GitHub Release asset; on a public repo it would be world-readable during the
 * render. Only called when opts.requirePrivateRepo is set (generic/customer path).
 */
async function assertPrivateRepo(token: string, owner: string, repo: string, fail: (msg: string) => never, log: (msg: string) => void): Promise<void> {
  let resp: Response;
  try {
    resp = await gh(token, "GET", `/repos/${owner}/${repo}`);
  } catch (e: any) {
    fail(`could not verify ${owner}/${repo} visibility (${e?.message || e}) — refusing to upload customer media to an unverified render repo.`);
  }
  if (!resp.ok) {
    fail(`could not verify ${owner}/${repo} visibility (HTTP ${resp.status}) — refusing to upload customer media to an unverified render repo.`);
  }
  const meta = await resp.json() as { private?: boolean; visibility?: string };
  if (meta.private !== true) {
    fail(`render repo ${owner}/${repo} is NOT private (visibility=${meta.visibility || "public"}) — refusing to upload customer media to a public repo. Point GH_RENDER_REPO at a PRIVATE repo (or make this one private).`);
  }
  log(`[gh-render] verified ${owner}/${repo} is private — safe for customer media`);
}

/**
 * Render a video on the GitHub Actions farm and return the on-disk MP4 path.
 * Brand-agnostic: callers do their own validation + delivery.
 */
export async function renderOnGithubFarm(opts: RenderFarmOptions): Promise<RenderFarmResult> {
  const fail = opts.fail || defaultDie;
  const log = opts.log || ((m: string) => console.log(m));
  // Best-effort progress sink — NEVER let a progress write break the render.
  const report = (p: FarmProgress): void => {
    try { opts.onProgress?.(p); } catch { /* progress is advisory only */ }
  };
  const token = ghToken();
  if (!token) fail("GITHUB_PERSONAL_ACCESS_TOKEN_2 (or GITHUB_TOKEN) is required");
  if (!opts.scenes || opts.scenes.length === 0) fail("renderOnGithubFarm: at least one scene is required");

  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const fps = opts.fps ?? 30;
  const crf = opts.crf ?? 23;
  const chapterSize = Math.max(1, opts.chapterSize ?? DEFAULT_CHAPTER_SIZE);
  const voiceProvider = opts.voiceProvider || "fish";
  const strictVoice = opts.strictVoice ?? false;
  const callerLabel = opts.callerLabel || "github-render-farm";
  const imagePurpose = opts.imagePurpose || "customer_video_scene";
  const isCustomerFacing = opts.isCustomerFacing ?? true;
  const pollTimeout = opts.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const sceneDir = opts.sceneDir || `data/youtube/scenes/${opts.videoId}`;

  const { owner, repo } = resolveRepo(fail, opts.repoSpec);
  // Customer/generic path: refuse to stage customer media on a public repo.
  // Verified BEFORE the cap is incremented so a repo-visibility misconfig fails
  // fast without consuming the day's quota (a failed run shouldn't starve the cap).
  if (opts.requirePrivateRepo) await assertPrivateRepo(token, owner, repo, fail, log);

  // Cost guard BEFORE any paid image/TTS work or CI dispatch. Skipped for Bob's
  // own personal work (skipDailyCap) or a deliberate per-run operator override.
  const capBypassed = opts.skipDailyCap || /^(1|true|yes|on)$/i.test(process.env.RENDER_FARM_NO_CAP || "");
  if (capBypassed) {
    log("[gh-render] daily render cap BYPASSED (personal/owner work — uncapped by request)");
  } else {
    enforceDailyCap(fail, log);
  }
  const jobId = `${opts.videoId}-${Date.now()}`;
  log(`[gh-render] ${opts.videoId} -> ${owner}/${repo} (job ${jobId}), ${opts.scenes.length} scenes`);

  // 1. Images (reuse on-disk ONLY when the fingerprint matches this prompt)
  // The videoId is often date-only (weekly recap = `weekly-YYYY-MM-DD`), so two
  // runs on the same day share this sceneDir. Reusing `scene-N.png` purely because
  // it exists at that POSITION pairs fresh narration with a prior run's images
  // (every slide out of continuity). So reuse only when the sidecar fingerprint
  // proves the on-disk image was baked for THIS exact prompt; otherwise re-bake.
  fs.mkdirSync(sceneDir, { recursive: true });
  // Same-day re-runs share this (date-only) sceneDir; sweep any stale/orphan
  // positional scene-N.png up front so a position-based fallthrough can never
  // pick up a prior run's image. Hygiene only — reuse below is fingerprint-gated.
  pruneStaleSceneImages(sceneDir, opts.scenes);
  for (let i = 0; i < opts.scenes.length; i++) {
    const s = opts.scenes[i];
    if (s.imagePath) {
      // A scene that names a specific imagePath (hero photo, a real photo Bob
      // dropped in Drive) must use THAT file. If it isn't on disk, FAIL LOUD —
      // never silently fall through to a generated image (that shipped a generic
      // AI slide in place of Bob's real photo, 2026-06-14).
      if (!existsSyncEIO(s.imagePath)) {
        fail(`scene ${i + 1}: imagePath "${s.imagePath}" is declared but missing on disk — fetch/place the file before rendering (e.g. PHOTO_NAME=<name> npx tsx scripts/fetch-bwb-photo.ts). Refusing to silently substitute a generated image.`);
      }
      continue;
    }
    const dest = `${sceneDir}/scene-${i + 1}.png`;
    if (existsSyncEIO(dest) && (!s.imagePrompt || imageMatchesPrompt(dest, s.imagePrompt))) { s.imagePath = dest; continue; }
    if (!s.imagePrompt) fail(`scene ${i + 1}: no imagePath and no imagePrompt`);
    report({ phase: `Baking scene images (${i + 1}/${opts.scenes.length})` });
    process.stdout.write(`[gh-render] baking scene ${i + 1}... `);
    await bakeImage(s.imagePrompt!, dest, { callerLabel, purpose: imagePurpose, isCustomerFacing }, fail);
    writeScenePromptSidecar(dest, s.imagePrompt!);
    s.imagePath = dest;
    log("OK");
  }

  // 2. Per-scene audio + durations
  log(`[gh-render] generating narration audio (provider=${voiceProvider}, voice=${opts.voice})...`);
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-bundle-"));
  fs.mkdirSync(path.join(bundleDir, "scenes"));
  fs.mkdirSync(path.join(bundleDir, "audio"));
  const sceneMeta: { image: string; audio: string; duration: number }[] = [];
  for (let i = 0; i < opts.scenes.length; i++) {
    const s = opts.scenes[i];
    report({ phase: `Generating narration (${i + 1}/${opts.scenes.length})` });
    const audioSrc = await genSceneAudio(s.narration, `${opts.videoId}_scene_${i + 1}`, { provider: voiceProvider, voice: opts.voice, strictVoice }, fail);
    const audioDur = ffprobeDuration(audioSrc);
    if (!Number.isFinite(audioDur) || audioDur <= 0) {
      fail(`scene ${i + 1}: could not probe narration audio duration for ${audioSrc} (ffprobe failed or returned 0) — refusing to substitute a fake fixed scene length, which would desync audio/video.`);
    }
    const dur = audioDur + 2.5; // mirror engine: image outlasts audio; -shortest trims to narration
    const imgRel = `scenes/${i}.png`;
    const audRel = `audio/${i}.mp3`;
    if (!validImageDims(s.imagePath!)) {
      fail(`scene ${i + 1}: image is corrupt/undecodable (${s.imagePath}) — ffprobe reports no valid video stream. Delete it and re-bake before rendering (a bad image hangs ffmpeg in CI).`);
    }
    copyFileSyncEIO(s.imagePath!, path.join(bundleDir, imgRel));
    copyFileSyncEIO(audioSrc, path.join(bundleDir, audRel));
    sceneMeta.push({ image: imgRel, audio: audRel, duration: dur });
    // The slide is timed to the ACTUAL probed audio (exact). Also log the
    // up-front word-count estimate + delta so the forecast can be verified and
    // a >2s drift (a sign the voice rate shifted) is visible.
    const est = estimateNarrationSeconds(s.narration);
    const cmp = compareEstimateVsActual(est, audioDur);
    log(
      `  scene ${i + 1}: audio ${audioDur.toFixed(1)}s (est ${est.toFixed(1)}s, ` +
        `Δ${cmp.deltaSec >= 0 ? "+" : ""}${cmp.deltaSec.toFixed(1)}s)` +
        (cmp.withinTolerance ? "" : ` ⚠ narration timing drift > ${TIMING_TOLERANCE_SEC}s`),
    );
  }

  // 3. Manifest + renderer + tarball
  const chapters: { index: number; scenes: typeof sceneMeta }[] = [];
  for (let i = 0; i < sceneMeta.length; i += chapterSize) {
    chapters.push({ index: chapters.length + 1, scenes: sceneMeta.slice(i, i + chapterSize) });
  }
  if (chapters.length > MAX_CHAPTERS_PER_RENDER) {
    fail(`script fans out to ${chapters.length} chapters (> ${MAX_CHAPTERS_PER_RENDER} cap). Split the video or raise the cap deliberately — this guard bounds parallel GitHub runner usage.`);
  }
  const manifest = { width, height, fps, crf, videoId: opts.videoId, chapters };
  writeFileSyncEIO(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  copyFileSyncEIO("scripts/render-chapter-ffmpeg.mjs", path.join(bundleDir, "render-chapter-ffmpeg.mjs"));
  const tarball = path.join(path.dirname(bundleDir), `${jobId}.tar.gz`);
  // Pure-JS tarball (node-tar), NOT a system `tar` spawn. Prod's Reserved-VM
  // overlayFS intermittently corrupts the execve of bare system binaries (the
  // same root cause behind the ffmpeg/ffprobe path resolver). node-tar reads via
  // fs and gzips in-process, so there is no system binary to corrupt — removing
  // this bundling step from the overlayFS execve-failure surface entirely.
  try {
    // node-tar opens and `fs.read`s every bundle file; on the Reserved-VM
    // overlayFS a transient read fault surfaces as `EIO: i/o error, read` and
    // crashed the whole handoff at 0/6 chapters (the recap "going nowhere" with
    // a render-farm-failed-twice EIO, 2026-06-21). Re-creating the tarball is
    // idempotent, so retry the WHOLE create on EIO only; everything else (ENOSPC,
    // a genuinely dead disk after retries) still surfaces and fails closed.
    await retryEIOAsync("tarball create", () =>
      tarCreate({ gzip: true, file: tarball, cwd: bundleDir }, ["."]),
    );
  } catch (e) {
    // Surface the REAL reason instead of the opaque "tar failed" — a future
    // failure should tell the next reader exactly what broke (EIO, ENOSPC, …).
    fail(`bundle tar.gz creation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!existsSyncEIO(tarball)) fail(`bundle tar.gz missing after creation at ${tarball}`);
  const tarBytes = readFileSyncEIO(tarball);
  log(`[gh-render] bundle: ${chapters.length} chapters, ${(tarBytes.length / 1024 / 1024).toFixed(1)} MB`);

  let releaseId: number | null = null;
  try {
    // 4. Release + asset
    const relResp = await gh(token, "POST", `/repos/${owner}/${repo}/releases`, {
      tag_name: `render-${jobId}`, name: `render ${jobId}`, body: "Transient render bundle (auto-deleted).", prerelease: true, target_commitish: "main",
    });
    if (!relResp.ok) fail(`create release failed: HTTP ${relResp.status} ${(await relResp.text()).slice(0, 300)}`);
    const rel = await relResp.json() as { id: number; upload_url: string };
    releaseId = rel.id;
    const uploadUrl = `${rel.upload_url.split("{")[0]}?name=${jobId}.tar.gz`;
    const upResp = await gh(token, "POST", uploadUrl, tarBytes, { "Content-Type": "application/gzip" }, 600_000);
    if (!upResp.ok) fail(`asset upload failed: HTTP ${upResp.status} ${(await upResp.text()).slice(0, 300)}`);
    const asset = await upResp.json() as { id: number };
    // CI fetches via the API asset URL + built-in GITHUB_TOKEN (works for private repos).
    const bundleUrl = `${API}/repos/${owner}/${repo}/releases/assets/${asset.id}`;
    log(`[gh-render] bundle uploaded (asset ${asset.id})`);

    // 5. Dispatch
    const dispatchAt = Date.now();
    const dispResp = await gh(token, "POST", `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      ref: "main", inputs: { bundle_url: bundleUrl, num_chapters: String(chapters.length), job_id: jobId },
    });
    if (dispResp.status !== 204) fail(`workflow dispatch failed: HTTP ${dispResp.status} ${(await dispResp.text()).slice(0, 300)} (is ${WORKFLOW_FILE} pushed to main on GitHub?)`);
    log(`[gh-render] dispatched ${WORKFLOW_FILE}; locating run...`);

    // 6. Find + poll the run. The workflow sets run-name to `bwb-render-<jobId>`,
    // so we correlate by exact name (deterministic even under concurrent
    // dispatches); the timestamp window is only a secondary guard.
    const expectedRunName = `bwb-render-${jobId}`;
    let runId: number | null = null;
    for (let i = 0; i < 18 && runId === null; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const runsResp = await gh(token, "GET", `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`);
      if (!runsResp.ok) continue;
      const runs = (await runsResp.json()).workflow_runs as { id: number; name?: string; created_at: string; status: string }[];
      const recent = runs.filter((r) => new Date(r.created_at).getTime() >= dispatchAt - 15000);
      const candidate = recent.filter((r) => r.name === expectedRunName).sort((a, b) => b.id - a.id)[0];
      if (candidate) runId = candidate.id;
    }
    if (runId === null) fail(`could not locate dispatched workflow run "${expectedRunName}" after 90s`);
    const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
    log(`[gh-render] run ${runId} — ${runUrl}`);

    const startedAt = Date.now();
    let conclusion = "";
    log(`[gh-render] ${chapters.length} chapters fanned out to ${chapters.length} parallel GitHub runners — polling per-chapter status:`);
    while (Date.now() - startedAt < pollTimeout) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const runResp = await gh(token, "GET", `/repos/${owner}/${repo}/actions/runs/${runId}`);
      if (!runResp.ok) continue;
      const run = await runResp.json() as { status: string; conclusion: string | null };

      // Per-chapter visibility: GitHub runs every matrix job concurrently (the
      // workflow sets no max-parallel + fail-fast:false), so this lists each
      // "render chapter N" job's live state — proving the chapters render at the
      // same time rather than one after another.
      let chapterLine = "";
      try {
        const jobsResp = await gh(token, "GET", `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
        if (jobsResp.ok) {
          const jobs = (await jobsResp.json()).jobs as { name: string; status: string; conclusion: string | null }[];
          const chJobs = jobs.filter((j) => /render chapter \d+/i.test(j.name));
          if (chJobs.length) {
            const glyph = (j: { status: string; conclusion: string | null }) =>
              j.status === "completed" ? (j.conclusion === "success" ? "✓" : "✗")
                : j.status === "in_progress" ? "▶" : "·";
            const running = chJobs.filter((j) => j.status === "in_progress").length;
            const done = chJobs.filter((j) => j.status === "completed").length;
            const queued = chJobs.length - running - done;
            const sortedJobs = chJobs.slice().sort(
              (a, b) => parseInt((a.name.match(/\d+/) || ["0"])[0]) - parseInt((b.name.match(/\d+/) || ["0"])[0]),
            );
            chapterLine = ` | chapters [${sortedJobs.map(glyph).join("")}] ${running}▶ running / ${done}✓ done / ${queued}· queued`;
            // Mirror the per-chapter glyph row onto the progress sink (the BWB
            // caller maps it to the video_jobs row → live banner/popup).
            report({
              phase: `Rendering chapters on the GitHub farm (${done}/${chJobs.length} done)`,
              totalChapters: chJobs.length,
              chapters: sortedJobs.map((j, i): FarmProgressChapter => ({
                idx: i,
                title: `Chapter ${i + 1}`,
                scene_count: chapters[i]?.scenes?.length ?? 0,
                status:
                  j.status === "completed"
                    ? (j.conclusion === "success" ? "done" : "failed")
                    : j.status === "in_progress" ? "rendering" : "queued",
              })),
            });
          }
        }
      } catch { /* per-chapter view is best-effort; overall run status below is authoritative */ }

      process.stdout.write(`\r[gh-render] run ${runId}: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}${chapterLine}    `);
      if (run.status === "completed") { conclusion = run.conclusion || "unknown"; break; }
    }
    log("");
    if (conclusion !== "success") fail(`render run finished with conclusion="${conclusion || "timeout"}" — see ${runUrl}`);

    // 7. Download final-video artifact
    const artResp = await gh(token, "GET", `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`);
    if (!artResp.ok) fail(`artifact list failed: HTTP ${artResp.status} — see ${runUrl}`);
    const artJson: any = await artResp.json();
    const arts = (Array.isArray(artJson?.artifacts) ? artJson.artifacts : []) as { id: number; name: string }[];
    if (arts.length === 0) fail(`no artifacts returned for run ${runId} — see ${runUrl}`);
    const finalArt = arts.find((a) => a.name === "final-video");
    if (!finalArt) fail(`final-video artifact not found (have: ${arts.map((a) => a.name).join(", ")})`);
    const zipResp = await gh(token, "GET", `/repos/${owner}/${repo}/actions/artifacts/${finalArt!.id}/zip`, undefined, undefined, 600_000);
    if (!zipResp.ok) fail(`artifact download failed: HTTP ${zipResp.status}`);
    const zipPath = path.join(path.dirname(bundleDir), `${jobId}-final.zip`);
    writeFileSyncEIO(zipPath, Buffer.from(await zipResp.arrayBuffer()));
    const outMp4 = opts.outMp4;
    fs.mkdirSync(path.dirname(outMp4), { recursive: true });
    if (!extractFromZip(zipPath, "final.mp4", path.dirname(outMp4)))
      fail(`could not extract final.mp4 (adm-zip + unzip/python3/bsdtar all failed). Zip at ${zipPath}`);
    const extracted = path.join(path.dirname(outMp4), "final.mp4");
    // EIO-resilient existence check: a transient overlayFS fault must not make
    // existsSync silently return false and skip the rename (which would leave
    // outMp4 absent for the downstream stitch). statSyncEIO retries the EIO and
    // re-throws a genuine non-ENOENT error (fail-closed); ENOENT = truly absent.
    let extractedExists = false;
    try {
      statSyncEIO(extracted);
      extractedExists = true;
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
    if (extractedExists && path.resolve(extracted) !== path.resolve(outMp4)) fs.renameSync(extracted, outMp4);
    // Diagnostic-only size log — a rare overlayFS statSync EIO here must NOT crash
    // a render that already succeeded. Degrade to "unknown" instead.
    let sizeMB = "unknown";
    try { sizeMB = (fs.statSync(outMp4).size / 1024 / 1024).toFixed(2); } catch { /* eio-safe: cosmetic size log */ }
    log(`\n[gh-render] DONE — ${outMp4} (${sizeMB} MB), ${chapters.length} chapters rendered in parallel containers.`);

    return { outMp4, chapters: chapters.length, runUrl, jobId };
  } finally {
    if (releaseId !== null) {
      try {
        await gh(token, "DELETE", `/repos/${owner}/${repo}/releases/${releaseId}`);
        await gh(token, "DELETE", `/repos/${owner}/${repo}/git/refs/tags/render-${jobId}`);
        log(`[gh-render] cleaned up transient release`);
      } catch { /* best-effort */ }
    }
    try { fs.rmSync(bundleDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * server/lib/render-prep-canary.ts
 *
 * Render-prep canary — proves the EXACT ffmpeg + ffprobe path the BWB weekly
 * recap (and Felix's video pipeline) depends on actually WORKS in THIS deploy,
 * end-to-end, at boot time.
 *
 * WHY THIS EXISTS
 * The weekly recap kept failing one new way each week. The through-line was
 * never "new bugs" — it was prod's Reserved-VM overlayFS intermittently
 * corrupting execve on the bundled/PATH ffmpeg + ffprobe, surfacing on whatever
 * code path the job happened to reach that week. Each fix unmasked the next
 * latent failure. The robustness fix is `getFf{mpeg,probe}Path()` (tmpfs
 * relocation + execve probe + system fallback); this canary is the CONFIDENCE
 * layer on top: it runs the real synth+probe round trip at deploy/boot time so
 * a broken binary is caught on Friday's publish, not on Sunday's cron.
 *
 * It deliberately uses the SAME resolver the render-farm prep uses, and it
 * exercises BOTH binaries: ffmpeg WRITES a tiny media file, ffprobe READS it
 * back. A corrupt-execve binary returns 0/NaN/non-zero here exactly as it did
 * in the field — so this canary reproduces the real failure class cheaply
 * (~2-3 short spawns, no network, no money, no render farm).
 *
 * Pure + dependency-light: no DB, no LLM. Safe to call from server boot and
 * from a one-shot operator CLI (scripts/bwb-render-canary.ts).
 */
import { spawnSync } from "node:child_process";
import { logSilentCatch } from "./silent-catch";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getFfmpegPath, getFfprobePath, describeFfmpegResolution } from "./ffmpeg-paths";
import { sanitizeSpawnEnv } from "../safety/spawn-env-guard";

export interface CanaryCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RenderPrepCanaryResult {
  ok: boolean;
  checks: CanaryCheck[];
  ffmpeg: string;
  ffprobe: string;
  ffmpegSource: string;
  ffprobeSource: string;
}

const SPAWN_TIMEOUT_MS = 20000;

function runFfmpeg(args: string[]): { ok: boolean; detail: string } {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: SPAWN_TIMEOUT_MS });
  if (r.error) return { ok: false, detail: `ffmpeg spawn error (${(r.error as any)?.code || "unknown"}) at ${bin}: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, detail: `ffmpeg exited ${r.status} at ${bin}: ${(r.stderr || "").trim().slice(-200) || "(no stderr)"}` };
  return { ok: true, detail: `ok via ${bin}` };
}

function probeAudioDuration(file: string): number {
  const bin = getFfprobePath();
  const r = spawnSync(
    bin,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: SPAWN_TIMEOUT_MS },
  );
  if (r.error || r.status !== 0) return NaN;
  const d = parseFloat((r.stdout || "").trim());
  return Number.isFinite(d) ? d : NaN;
}

function probeImageDims(file: string): { w: number; h: number } {
  const bin = getFfprobePath();
  const r = spawnSync(
    bin,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: SPAWN_TIMEOUT_MS },
  );
  if (r.error || r.status !== 0) return { w: NaN, h: NaN };
  const nums = (r.stdout || "").trim().split(/\s+/).map(Number);
  return { w: nums[0] ?? NaN, h: nums[1] ?? NaN };
}

/**
 * Run the canary. Never throws — always resolves a structured result so callers
 * (boot hook, CLI) decide how loud to be. Cleans up its temp files.
 */
export async function runRenderPrepCanary(): Promise<RenderPrepCanaryResult> {
  const checks: CanaryCheck[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-render-canary-"));
  const audio = path.join(dir, "canary.wav");
  const image = path.join(dir, "canary.png");
  const res = describeFfmpegResolution();

  try {
    // 1. ffmpeg can WRITE a 1s silent PCM wav (exercises ffmpeg execve).
    const a = runFfmpeg(["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "pcm_s16le", audio]);
    checks.push({ name: "ffmpeg:write-audio", ok: a.ok && fs.existsSync(audio), detail: a.detail });

    // 2. ffmpeg can WRITE a 320x240 png (exercises the image bake path).
    const i = runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1", image]);
    checks.push({ name: "ffmpeg:write-image", ok: i.ok && fs.existsSync(image), detail: i.detail });

    // 3. ffprobe can READ a real duration back (the EXACT field that returned
    //    0/NaN in prod — mirrors github-render-farm ffprobeDuration).
    if (fs.existsSync(audio)) {
      const d = probeAudioDuration(audio);
      const ok = Number.isFinite(d) && d > 0.5;
      checks.push({ name: "ffprobe:audio-duration", ok, detail: ok ? `duration=${d.toFixed(3)}s via ${res.ffprobe}` : `probe returned ${d} (ffprobe failed or returned 0) at ${res.ffprobe}` });
    } else {
      checks.push({ name: "ffprobe:audio-duration", ok: false, detail: "skipped — audio fixture was never written (ffmpeg failed first)" });
    }

    // 4. ffprobe can READ valid image dims (mirrors validImageDims).
    if (fs.existsSync(image)) {
      const { w, h } = probeImageDims(image);
      const ok = w === 320 && h === 240;
      checks.push({ name: "ffprobe:image-dims", ok, detail: ok ? `${w}x${h} via ${res.ffprobe}` : `got ${w}x${h} (expected 320x240) at ${res.ffprobe}` });
    } else {
      checks.push({ name: "ffprobe:image-dims", ok: false, detail: "skipped — image fixture was never written (ffmpeg failed first)" });
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_silentErr) { logSilentCatch("server/lib/render-prep-canary.ts", _silentErr); }
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    ffmpeg: res.ffmpeg,
    ffprobe: res.ffprobe,
    ffmpegSource: res.ffmpegSource,
    ffprobeSource: res.ffprobeSource,
  };
}

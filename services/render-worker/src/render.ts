import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface SceneInput {
  imagePath: string;
  audioPath?: string;
  durationSec: number;
}

export interface RenderManifest {
  jobId: string;
  resolution: string;
  fps: number;
  transition: "fade" | "wipeleft" | "wiperight" | "slideleft" | "slideright" | "none";
  crossfadeMs: number;
  outputName: string;
}

export interface RenderResult {
  outputPath: string;
  durationSec?: number;
  sizeBytes?: number;
}

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function probeDuration(filePath: string): number | null {
  try {
    const out = execFileSync(FFPROBE, [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { encoding: "utf-8", timeout: 30000 }).trim();
    const n = parseFloat(out);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function escapeConcatPath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

export async function renderManifest(manifest: RenderManifest, scenes: SceneInput[], jobDir: string): Promise<RenderResult> {
  if (scenes.length === 0) throw new Error("manifest must include at least one scene");
  const [w, h] = manifest.resolution.split("x").map((s) => parseInt(s, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`invalid resolution: ${manifest.resolution}`);
  const fps = manifest.fps > 0 ? manifest.fps : 30;
  const crossfadeSec = Math.max(0, (manifest.crossfadeMs || 0) / 1000);
  const useTransition = manifest.transition !== "none" && crossfadeSec > 0 && scenes.length >= 2;

  fs.mkdirSync(jobDir, { recursive: true });
  const segmentPaths: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const segPath = path.join(jobDir, `seg_${String(i).padStart(3, "0")}.mp4`);
    const dur = Math.max(0.5, Number(scene.durationSec) || 3);
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
    const args: string[] = ["-y", "-loop", "1", "-i", scene.imagePath];
    if (scene.audioPath) {
      args.push("-i", scene.audioPath);
    } else {
      args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`);
    }
    args.push(
      "-vf", vf,
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-r", String(fps),
      "-t", String(dur),
      "-shortest",
      "-movflags", "+faststart",
      segPath,
    );
    try {
      execFileSync(FFMPEG, args, { timeout: 120_000, stdio: "pipe" });
      segmentPaths.push(segPath);
    } catch (err: any) {
      const stderr = err?.stderr?.toString?.()?.slice(-400) || err?.message || String(err);
      throw new Error(`scene ${i + 1} encode failed: ${stderr}`);
    }
  }

  const outPath = path.join(jobDir, manifest.outputName.replace(/[^A-Za-z0-9._-]/g, "_") || "output.mp4");

  if (!useTransition || segmentPaths.length < 2) {
    const concatFile = path.join(jobDir, "concat.txt");
    fs.writeFileSync(concatFile, segmentPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n"));
    execFileSync(FFMPEG, [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-r", String(fps), "-movflags", "+faststart", outPath,
    ], { timeout: 600_000, stdio: "pipe" });
  } else {
    let currentPath = segmentPaths[0];
    for (let i = 1; i < segmentPaths.length; i++) {
      const fadedPath = path.join(jobDir, `faded_${i}.mp4`);
      const dur0 = probeDuration(currentPath) || 0;
      const offset = Math.max(0, dur0 - crossfadeSec);
      try {
        execFileSync(FFMPEG, [
          "-y", "-i", currentPath, "-i", segmentPaths[i],
          "-filter_complex",
          `[0:v][1:v]xfade=transition=${manifest.transition}:duration=${crossfadeSec}:offset=${offset}[vout];[0:a][1:a]acrossfade=d=${crossfadeSec}[aout]`,
          "-map", "[vout]", "-map", "[aout]",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-r", String(fps), "-c:a", "aac", "-movflags", "+faststart", fadedPath,
        ], { timeout: 180_000, stdio: "pipe" });
        currentPath = fadedPath;
      } catch (xfErr: any) {
        const concatFb = path.join(jobDir, `concat_fb_${i}.txt`);
        fs.writeFileSync(concatFb, [currentPath, segmentPaths[i]].map((p) => `file '${escapeConcatPath(p)}'`).join("\n"));
        const fbPath = path.join(jobDir, `fb_${i}.mp4`);
        execFileSync(FFMPEG, [
          "-y", "-f", "concat", "-safe", "0", "-i", concatFb,
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          "-r", String(fps), "-movflags", "+faststart", fbPath,
        ], { timeout: 180_000, stdio: "pipe" });
        currentPath = fbPath;
      }
    }
    if (currentPath !== outPath) fs.copyFileSync(currentPath, outPath);
  }

  if (!fs.existsSync(outPath)) throw new Error("render finished but output file is missing");
  const stats = fs.statSync(outPath);
  if (stats.size < 1024) throw new Error(`render output suspiciously small (${stats.size} bytes)`);
  const finalDur = probeDuration(outPath);
  return { outputPath: outPath, durationSec: finalDur || undefined, sizeBytes: stats.size };
}

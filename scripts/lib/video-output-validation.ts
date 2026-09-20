import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getFfprobePath } from "../../server/lib/ffmpeg-paths";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";

const FFPROBE_TIMEOUT_MS = 20_000;

export interface RenderedVideoValidationResult {
  ok: boolean;
  reason: string;
}

export interface StableVideoSnapshot {
  filePath: string;
  cleanup: () => void;
}

/**
 * Copy a render through an O_NOFOLLOW descriptor before validation/delivery.
 * This binds the bytes that ffprobe accepts to the bytes the delivery pipeline
 * reads, instead of validating one pathname and later reopening it.
 */
export function createStableVideoSnapshot(filePath: string): StableVideoSnapshot {
  let sourceFd: number | undefined;
  let snapshotFd: number | undefined;
  let tempDir: string | undefined;
  try {
    const sourceStat = fs.lstatSync(filePath);
    if (!sourceStat.isFile()) {
      throw new Error("render output is not a regular file (symlinks and directories are rejected)");
    }
    const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW;
    if (noFollow === undefined) {
      throw new Error("platform cannot open render output without following symlinks");
    }

    tempDir = fs.mkdtempSync(path.join(path.dirname(filePath), ".bwb-delivery-"));
    const snapshotPath = path.join(tempDir, "final.mp4");
    sourceFd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(sourceFd);
    if (!openedStat.isFile()) {
      throw new Error("render output changed to a non-regular file while it was opened");
    }
    snapshotFd = fs.openSync(snapshotPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);

    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(sourceFd, buffer, 0, buffer.length, null);
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(snapshotFd, buffer, written, bytesRead - written, null);
      }
    } while (bytesRead > 0);

    fs.closeSync(sourceFd);
    sourceFd = undefined;
    fs.closeSync(snapshotFd);
    snapshotFd = undefined;
    return {
      filePath: snapshotPath,
      cleanup: () => {
        try { fs.rmSync(tempDir!, { recursive: true, force: true }); } catch (error: any) {
          console.warn(`[gh-render] delivery snapshot cleanup failed: ${error?.message || error}`);
        }
      },
    };
  } catch (error) {
    if (sourceFd !== undefined) {
      try { fs.closeSync(sourceFd); } catch { /* preserve the original failure */ }
    }
    if (snapshotFd !== undefined) {
      try { fs.closeSync(snapshotFd); } catch { /* preserve the original failure */ }
    }
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}

/**
 * Validate the exact artifact that is about to be delivered.
 *
 * lstat is intentional: an extracted symlink must never be followed into an
 * unrelated file. ffprobe then verifies the media contract produced by the
 * GitHub render workflow.
 */
export function validateRenderedVideo(filePath: string): RenderedVideoValidationResult {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error: any) {
    return { ok: false, reason: `render output is not a readable regular file (${error?.message || error})` };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "render output is not a regular file (symlinks and directories are rejected)" };
  }

  const probe = spawnSync(
    getFfprobePath(),
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json",
      filePath,
    ],
    {
      encoding: "utf8",
      env: sanitizeSpawnEnv(process.env),
      timeout: FFPROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    },
  );
  if (probe.error) {
    return { ok: false, reason: `ffprobe could not inspect render output (${probe.error.message})` };
  }
  if (probe.status !== 0) {
    return { ok: false, reason: `ffprobe rejected render output (exit ${probe.status})` };
  }

  let metadata: {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  try {
    metadata = JSON.parse(probe.stdout || "");
  } catch (error: any) {
    return { ok: false, reason: `ffprobe returned invalid metadata (${error?.message || error})` };
  }

  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: `render output has no positive duration (got ${metadata.format?.duration ?? "unknown"})` };
  }

  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  if (!video || video.codec_name !== "h264" || video.width !== 1920 || video.height !== 1080) {
    return {
      ok: false,
      reason: `render output video stream is invalid (expected h264 1920x1080, got ${video?.codec_name || "missing"} ${video?.width || "?"}x${video?.height || "?"})`,
    };
  }

  const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio || audio.codec_name !== "aac") {
    return { ok: false, reason: `render output audio stream is invalid (expected aac, got ${audio?.codec_name || "missing"})` };
  }

  return { ok: true, reason: `valid h264/aac 1920x1080 render (${duration.toFixed(3)}s)` };
}
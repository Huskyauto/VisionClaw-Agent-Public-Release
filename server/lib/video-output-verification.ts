import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfprobePath, getFfmpegPath } from "./ffmpeg-paths";
import { sanitizeSpawnEnv } from "../safety/spawn-env-guard";

const exec = promisify(execFile);
export const VIDEO_PROBE_ARGS = ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json"];
/** Shared technical acceptance. This does not certify creative/content quality. */
export type VerificationStatus = "PASS" | "WARN" | "FAIL" | "UNKNOWN" | "SKIPPED";
export interface VideoCheck {
  name: string;
  status: VerificationStatus;
  required: boolean;
  detail: string;
  coverage?: { startSeconds: number; endSeconds: number; fullVideo: boolean };
  segments?: Array<{ start: number; end: number; dur: number }>;
}
export interface VideoOutputContract {
  requireAudio?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  pixelFormat?: string;
  expectedDurationSeconds?: number;
  durationToleranceSeconds?: number;
}
export interface VideoVerificationReport {
  version: 1;
  ok: boolean;
  checks: VideoCheck[];
  durationSeconds?: number;
  identity?: { sha256: string; sizeBytes: number };
}
export function unknownVideoReport(name: string, detail: string): VideoVerificationReport {
  return { version: 1, ok: false, checks: [{ name, status: "UNKNOWN", required: true, detail }] };
}

/** Hash bounded memory through a no-follow descriptor, reject concurrent writes. */
export async function videoFileIdentity(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("video output is not a regular file");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const after = await handle.stat();
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new Error("video changed during identity measurement");
    return { sha256: hash.digest("hex"), sizeBytes: bytes };
  } finally { await handle.close(); }
}

export type VideoDiagnostic = "black" | "freeze" | "silence";

/** Optional advisory scan of the first <=60 seconds, never an artistic veto. */
export async function scanVideoDiagnostic(filePath: string, name: VideoDiagnostic, durationSeconds: number): Promise<VideoCheck> {
  const filters = {
    black: "blackdetect=d=2.0:pix_th=0.10",
    freeze: "freezedetect=n=-60dB:d=2",
    silence: "silencedetect=noise=-45dB:d=2",
  };
  const endSeconds = Math.min(60, durationSeconds);
  const coverage = { startSeconds: 0, endSeconds, fullVideo: durationSeconds <= 60 };
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Object.hasOwn(filters, name))
    return { name, status: "UNKNOWN", required: false, detail: "invalid diagnostic or unknown duration" };
  try {
    if (!(await fs.promises.lstat(filePath)).isFile()) throw new Error("not regular");
    const { stderr } = await exec(getFfmpegPath(), [
      "-hide_banner", "-nostdin", "-protocol_whitelist", "file,pipe", "-threads", "1", "-i", filePath,
      "-t", String(endSeconds), "-filter_threads", "1",
      ...(name === "silence" ? ["-vn", "-af", filters[name]] : ["-an", "-vf", filters[name]]),
      "-f", "null", "-",
    ], { env: sanitizeSpawnEnv(process.env), timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    const segments: Array<{ start: number; end: number; dur: number }> = [];
    if (name === "black") {
      for (const match of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g))
        segments.push({ start: Number(match[1]), end: Number(match[2]), dur: Number(match[3]) });
    }
    const detected = name === "black" ? segments.length > 0
      : name === "freeze" ? /freeze_start:/.test(stderr) : /silence_start:/.test(stderr);
    return { name, status: detected ? "WARN" : "PASS", required: false, coverage,
      detail: detected ? `${name} detected in scanned interval; advisory only` : `no ${name} detected in scanned interval`,
      ...(name === "black" ? { segments } : {}) };
  } catch {
    return { name, status: "UNKNOWN", required: false, coverage, detail: `${name} detector failed or timed out; not a clean scan` };
  }
}

export async function verifyVideoOutput(filePath: string, contract: VideoOutputContract = {}, diagnostics: VideoDiagnostic[] = []): Promise<VideoVerificationReport> {
  try {
    if (!(await fs.promises.lstat(filePath)).isFile()) return unknownVideoReport("file", "output must be a regular file, not a symlink");
    const before = await videoFileIdentity(filePath);
    let report: VideoVerificationReport;
    try {
      const { stdout } = await exec(getFfprobePath(), [...VIDEO_PROBE_ARGS, filePath], {
        env: sanitizeSpawnEnv(process.env), timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      });
      report = evaluateVideoMetadata(JSON.parse(stdout), contract);
    } catch {
      return unknownVideoReport("probe", "ffprobe failed, timed out or returned invalid metadata; output is not verified");
    }
    for (const name of ["black", "freeze", "silence"] as const) {
      report.checks.push(diagnostics.includes(name) && report.durationSeconds
        ? await scanVideoDiagnostic(filePath, name, report.durationSeconds)
        : { name, status: "SKIPPED", required: false, detail: "content scan not requested or duration unknown; probe is not full decode/content clearance" });
    }
    const after = await videoFileIdentity(filePath);
    if (before.sha256 !== after.sha256 || before.sizeBytes !== after.sizeBytes)
      return unknownVideoReport("identity", "output changed while probing");
    report.identity = after;
    report.checks.push({ name: "identity", status: "PASS", required: true, detail: "SHA-256 of the verified output bytes" });
    return report;
  } catch {
    return unknownVideoReport("file", "output is unreadable or changed during verification");
  }
}
export function evaluateVideoMetadata(metadata: unknown, contract: VideoOutputContract = {}): VideoVerificationReport {
  const checks: VideoCheck[] = [];
  const check = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, status: pass ? "PASS" : "FAIL", required: true, detail });
  const m = metadata as { format?: { duration?: unknown }; streams?: Array<Record<string, unknown>> } | null;
  const streams = Array.isArray(m?.streams) ? m.streams : [];
  const video = streams.find(s => s?.codec_type === "video" && !(s?.disposition as { attached_pic?: number })?.attached_pic);
  const audio = streams.find(s => s?.codec_type === "audio");
  const duration = Number(m?.format?.duration);
  check("video", !!video, video ? `video codec ${video.codec_name}` : "no video stream");
  check("duration", Number.isFinite(duration) && duration > 0, `measured duration ${duration}s`);
  check("dimensions", !!video && typeof video.width === "number" && Number.isInteger(video.width) && video.width > 0
    && typeof video.height === "number" && Number.isInteger(video.height) && video.height > 0, `measured ${video?.width}x${video?.height}`);
  if (contract.requireAudio !== false || contract.audioCodec) check("audio", !!audio, audio ? `audio codec ${audio.codec_name}` : "required audio stream missing");
  else checks.push({ name: "audio", status: "SKIPPED", required: false, detail: "audio optional by explicit contract" });
  for (const [key, actual] of [
    ["videoCodec", video?.codec_name], ["audioCodec", audio?.codec_name],
    ["width", video?.width], ["height", video?.height], ["pixelFormat", video?.pix_fmt],
  ] as const) {
    if (contract[key] !== undefined) check(key, contract[key] === actual, `expected ${contract[key]}, measured ${actual ?? "unknown"}`);
  }
  if (contract.fps !== undefined) {
    const parts = String(video?.avg_frame_rate ?? "").split("/").map(Number);
    const fps = parts.length === 2 ? parts[0] / parts[1] : Number.NaN;
    check("fps", Number.isFinite(contract.fps) && contract.fps > 0 && Number.isFinite(fps)
      && Math.abs(fps - contract.fps) <= 0.02, `expected ${contract.fps}fps, measured ${fps}`);
  }
  if (contract.expectedDurationSeconds !== undefined) {
    const expected = contract.expectedDurationSeconds;
    const tolerance = contract.durationToleranceSeconds ?? Math.max(0.5, expected * 0.05);
    check("timeline", Number.isFinite(expected) && expected > 0 && Number.isFinite(tolerance) && tolerance >= 0
      && Number.isFinite(duration) && Math.abs(duration - expected) <= tolerance,
    `expected ${expected}s ±${tolerance}s, measured ${duration}s`);
  }
  return { version: 1, ok: checks.every(c => !c.required || c.status === "PASS"), checks,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined };
}

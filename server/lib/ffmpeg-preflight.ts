import { execFileSync } from "child_process";
import { logSilentCatch } from "./silent-catch";
import * as fs from "fs";
import { getFfprobePath } from "./ffmpeg-paths";

export interface FfmpegPreflightFailure {
  ok: false;
  errMsg: string;
  errorType: "container_environment_corrupted" | "ffmpeg_unavailable" | "preflight_timeout";
  suggestedAction: string;
  ffmpegStderr: string;
}

export interface FfmpegPreflightOk {
  ok: true;
}

export type FfmpegPreflightResult = FfmpegPreflightOk | FfmpegPreflightFailure;

const PREFLIGHT_CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ok: true; expiresAt: number }>();

type ProbeResult = { ok: true; err?: undefined; stderr?: undefined } | { ok: false; err: any; stderr: string };

function tryProbe(binPath: string, timeoutMs: number): ProbeResult {
  try {
    execFileSync(binPath, ["-version"], { encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true };
  } catch (err: any) {
    let stderr = err?.stderr?.toString?.() || "";
    // R110.20.2 — when execFileSync fails BEFORE the binary starts (EACCES,
    // ENOEXEC, ENOENT), stderr is empty and err.message is just "Command
    // failed: <path>" with no useful info. Augment with the real diagnostic:
    // the syscall errno + file mode + size, so the next person sees WHY.
    if (!stderr) {
      const code = err?.code || err?.errno || "unknown";
      let fileInfo = "(stat failed)";
      try {
        const st = fs.statSync(binPath);
        fileInfo = `mode=${(st.mode & 0o777).toString(8)} size=${st.size} isFile=${st.isFile()}`;
      } catch (_e) { logSilentCatch("server/lib/ffmpeg-preflight.ts", _e); }
      stderr = `(no stderr) errno=${code} path=${binPath} ${fileInfo} message=${err?.message?.slice(0, 200) || String(err)}`;
    } else {
      stderr = stderr.slice(0, 800);
    }
    return { ok: false, err, stderr };
  }
}

export function ffmpegPreflight(ffmpegPath: string, callerLabel: string): FfmpegPreflightResult {
  // R110.20 — was `ffmpegPath.replace(/ffmpeg$/, "ffprobe")` which assumed
  // both binaries lived at sibling paths with identical basename. Bundled
  // ffprobe-static lives at `node_modules/ffprobe-static/bin/<os>/<arch>/ffprobe`,
  // not next to ffmpeg. R110.20.2 — use ESM static import (was `require()`,
  // which is undefined in prod tsx ESM context).
  const ffprobePath = getFfprobePath();
  const cacheKey = `${ffmpegPath}|${ffprobePath}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true };
  }

  for (const [attempt, timeoutMs] of [[1, 30000], [2, 60000]] as const) {
    const ffmpegRes = tryProbe(ffmpegPath, timeoutMs);
    if (ffmpegRes.ok) {
      const ffprobeRes = tryProbe(ffprobePath, timeoutMs);
      if (ffprobeRes.ok) {
        cache.set(cacheKey, { ok: true, expiresAt: Date.now() + PREFLIGHT_CACHE_TTL_MS });
        if (attempt > 1) console.warn(`[${callerLabel}] preflight ok on attempt ${attempt} (cold-start latency)`);
        return { ok: true };
      }
      if (ffprobeRes.err?.code === "ETIMEDOUT" && attempt === 1) continue;
      return classifyFailure(callerLabel, ffprobeRes.err, ffprobeRes.stderr, "ffprobe");
    }
    if (ffmpegRes.err?.code === "ETIMEDOUT" && attempt === 1) {
      console.warn(`[${callerLabel}] ffmpeg -version ETIMEDOUT after ${timeoutMs}ms — retrying once with 60s window`);
      continue;
    }
    return classifyFailure(callerLabel, ffmpegRes.err, ffmpegRes.stderr, "ffmpeg");
  }

  // Both attempts timed out — real problem
  return {
    ok: false,
    errorType: "preflight_timeout",
    errMsg: `Preflight failed: ffmpeg/ffprobe -version did not return within 60s (two attempts). Container is severely overloaded or ffmpeg is hung.`,
    suggestedAction: "The render container is starved for CPU/IO — ffmpeg cannot even respond to '-version' within 60s. Most likely cause: 12 parallel ffmpeg processes thrashing the cold-start page-fault path. Tell Bob: 'The render server is overloaded. Please bounce the deployment from the Replit dashboard (Deployments → Restart) and try again — and if this keeps happening on a fresh container, drop video parallelism from 8 → 4 chapters.'",
    ffmpegStderr: "ETIMEDOUT (both attempts)",
  };
}

function classifyFailure(callerLabel: string, err: any, stderr: string, which: "ffmpeg" | "ffprobe"): FfmpegPreflightFailure {
  const isLibError = /loading shared libraries|cannot read file data|Input\/output error|libdrm|libavcodec|libav/i.test(stderr);
  // R110.20.2 — detect the EACCES / ENOEXEC pattern surfaced by the augmented
  // stderr in tryProbe(). When deploy strips the executable bit on the bundled
  // ffmpeg-static binary, errno=EACCES is the smoking gun.
  const code = err?.code || err?.errno || "";
  const isPermError = code === "EACCES" || code === "ENOEXEC" || /EACCES|ENOEXEC|Permission denied/i.test(stderr);
  const errorType: FfmpegPreflightFailure["errorType"] = isLibError ? "container_environment_corrupted" : "ffmpeg_unavailable";
  const suggestedAction = isLibError
    ? "The deployed container's Nix store has a corrupted shared library (likely libdrm or an ffmpeg dependency). Code cannot fix this — the container must be redeployed/restarted to get a fresh image. Tell Bob: 'The render server's ffmpeg library is corrupted. Please bounce the deployment from the Replit dashboard (Deployments → Restart, OR Publish again) — the next container will get a clean image. This is NOT a TTS/provider/quota problem.'"
    : isPermError
    ? `${which} binary exists but is not executable (deploy stripped the +x bit). The startup auto-chmod should have fixed this — if you're seeing this error, the chmod itself failed (read-only filesystem?). Tell Bob: 'The render server's ffmpeg binary lost its executable permission during deployment and we couldn't restore it. Please redeploy from the Replit dashboard.'`
    : `${which} is missing or non-functional in this environment. Cannot proceed with video render. Verify ${which} installation.`;
  const errMsg = `Preflight failed: ${isLibError ? `${which} shared-library corruption` : isPermError ? `${which} not executable (EACCES)` : `${which} unavailable`} — ${stderr.slice(0, 200)}`;
  console.error(`[${callerLabel}] ${errMsg}`);
  return { ok: false, errMsg, errorType, suggestedAction, ffmpegStderr: stderr.slice(0, 500) };
}

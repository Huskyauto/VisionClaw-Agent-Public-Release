/**
 * server/lib/ffmpeg-paths.ts — single source of truth for ffmpeg/ffprobe
 * binary paths across the entire app.
 *
 * Why this exists (R110.20):
 *   Felix's video pipeline kept failing in prod because Replit's Nix-store
 *   ffmpeg gets corrupted/GC'd between deploys (libdrm.so.2 missing,
 *   ETIMEDOUT during cold-start library paging, etc.). Rounds R110.16
 *   through R110.18 added preflights + retry + caching but the binary
 *   itself was still the unstable Nix copy. R110.19 prototyped a Railway
 *   ffmpeg microservice as the workaround. R110.20 abandons Railway and
 *   permanently replaces the Nix dependency with bundled static binaries
 *   shipped via the `ffmpeg-static` + `ffprobe-static` npm packages —
 *   identical binaries in dev and prod, no Nix involvement, no GC, no
 *   library paging surprises (statically linked).
 *
 * Resolution order:
 *   1. ffmpeg-static / ffprobe-static (bundled, statically linked, ~50MB)
 *   2. PATH lookup via `which` (system ffmpeg, e.g. user-installed or Nix)
 *   3. Bare "ffmpeg" / "ffprobe" string (last-ditch — let the OS resolve)
 *
 * Cached on first call. Safe to call from anywhere; no side effects.
 */

import { execSync, execFileSync } from "child_process";
import { logSilentCatch } from "./silent-catch";
import * as fs from "fs";
import * as path from "path";

// R110.20.2 — Production deploy revealed two bugs in R110.20.1:
//   1. `createRequire(import.meta.url)` crashed because `import.meta.url`
//      is undefined in the prod tsx runtime (only present in pure ESM).
//   2. The bundled binary path resolved correctly via fallback, BUT
//      execFileSync failed with bare "Command failed" and no stderr —
//      classic EACCES (executable bit stripped during deploy bundling).
//
// Fix: drop createRequire entirely. The `ffmpeg-static` / `ffprobe-static`
// packages just export hardcoded path strings — we can resolve those paths
// ourselves without loading the package. Then `chmod +x` the binary on
// first resolution to defend against deploy systems that strip the bit.

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

// Try a list of candidate paths, return the first one that exists. Then
// chmod +x to guard against deploy systems that strip the executable bit.
function findAndArm(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      // Defensive chmod +x — no-op if already executable, fixes EACCES if
      // the deploy bundler stripped the bit (the symptom we hit in R110.20.1
      // prod: `Command failed: <path> -version` with empty stderr).
      let stat: fs.Stats;
      try {
        stat = fs.statSync(p);
        // R110.20.2 — guard against directory/symlink-to-dir candidates
        // (defensive; existsSync above can match dirs too).
        if (!stat.isFile()) {
          console.warn(`[ffmpeg-paths] ${p} exists but is not a regular file; skipping candidate`);
          continue;
        }
        const wantsMode = stat.mode | 0o111; // add owner+group+other execute
        if ((stat.mode & 0o111) !== 0o111) {
          try {
            fs.chmodSync(p, wantsMode);
            console.log(`[ffmpeg-paths] chmod +x ${p} (was mode ${(stat.mode & 0o777).toString(8)})`);
          } catch (chmodErr: any) {
            // R110.20.2 — chmod may fail on read-only FS. Refuse to return
            // a non-executable path; let the next candidate or `which`
            // fallback win instead.
            logSilentCatch("server/lib/ffmpeg-paths.ts", chmodErr);
            console.warn(`[ffmpeg-paths] chmod +x failed for ${p} (mode=${(stat.mode & 0o777).toString(8)}, err=${chmodErr?.code || "unknown"}); skipping candidate`);
            continue;
          }
        }
        // Verify post-chmod executability — if access(X_OK) still fails,
        // skip this candidate so the resolver can fall through to `which`.
        try {
          fs.accessSync(p, fs.constants.X_OK);
        } catch (accessErr: any) {
          logSilentCatch("server/lib/ffmpeg-paths.ts", accessErr);
          console.warn(`[ffmpeg-paths] ${p} not executable after chmod attempt (err=${accessErr?.code || "unknown"}); skipping candidate`);
          continue;
        }
      } catch (statErr: any) {
        logSilentCatch("server/lib/ffmpeg-paths.ts", statErr);
        continue;
      }
      return p;
    } catch (_e) { logSilentCatch("server/lib/ffmpeg-paths.ts", _e); }
  }
  return null;
}

// R110.20.2 — DO NOT use `__dirname` here; this module is ESM in prod tsx
// where `__dirname` throws "is not defined". Stick to `process.cwd()` which
// is always defined and on Replit Deployments equals /home/runner/workspace.
function bundledFfmpegCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "node_modules/ffmpeg-static/ffmpeg"),
    path.join(cwd, "node_modules/ffmpeg-static/ffmpeg.exe"),
  ];
}

function bundledFfprobeCandidates(): string[] {
  // ffprobe-static export structure: bin/<platform>/<arch>/ffprobe
  const cwd = process.cwd();
  return [
    path.join(cwd, "node_modules/ffprobe-static/bin/linux/x64/ffprobe"),
    path.join(cwd, "node_modules/ffprobe-static/bin/linux/arm64/ffprobe"),
    path.join(cwd, "node_modules/ffprobe-static/bin/darwin/x64/ffprobe"),
    path.join(cwd, "node_modules/ffprobe-static/bin/darwin/arm64/ffprobe"),
  ];
}

function tryBundled(kind: "ffmpeg" | "ffprobe"): string | null {
  return findAndArm(kind === "ffmpeg" ? bundledFfmpegCandidates() : bundledFfprobeCandidates());
}

/**
 * R110.20.3 — Replit Deployments' overlayFS is hostile to executing the
 * 64-80MB bundled binaries: spawn() returns errno=EIO even though the file
 * is mode 755 + correct size + isFile=true (kernel can read metadata but
 * can't map executable pages). The bundled binaries themselves are intact —
 * the bug is in HOW the filesystem serves them at exec time.
 *
 * Workaround: copy the binary to /tmp (or /dev/shm — Linux tmpfs, RAM-backed,
 * never overlayFS) at startup. The kernel can map executable pages from
 * tmpfs without trouble. If /tmp is also overlayFS for some reason, fall
 * back to /dev/shm. If both fail, return the original path so the caller
 * still gets a usable (if execve-failing) reference and the EIO surfaces
 * with the existing diagnostic.
 *
 * We key the destination filename by binary basename + size so:
 *   (a) re-runs don't re-copy unnecessarily,
 *   (b) a binary upgrade (different size) gets a fresh copy,
 *   (c) ffmpeg vs ffprobe don't collide.
 */
function relocateToTmpfs(srcPath: string, label: "ffmpeg" | "ffprobe"): string | null {
  const candidates = ["/tmp", "/dev/shm", "/var/tmp"];
  let srcSize = 0;
  try {
    srcSize = fs.statSync(srcPath).size;
  } catch (e) {
    logSilentCatch("server/lib/ffmpeg-paths.ts", e);
    return null;
  }
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      const dest = path.join(dir, `visionclaw-${label}-${srcSize}`);
      // Skip copy if already present + correct size + executable
      let needsCopy = true;
      try {
        const dstat = fs.statSync(dest);
        if (dstat.isFile() && dstat.size === srcSize && (dstat.mode & 0o111) === 0o111) {
          needsCopy = false;
        }
      } catch (_e) { logSilentCatch("server/lib/ffmpeg-paths.ts", _e); }
      if (needsCopy) {
        try {
          fs.copyFileSync(srcPath, dest);
          fs.chmodSync(dest, 0o755);
          console.log(`[ffmpeg-paths] copied ${label} to ${dest} (${srcSize} bytes) to bypass overlayFS exec corruption`);
        } catch (copyErr: any) {
          logSilentCatch("server/lib/ffmpeg-paths.ts", copyErr);
          console.warn(`[ffmpeg-paths] copy ${label} → ${dir} failed (${copyErr?.code || "unknown"}); trying next location`);
          continue;
        }
      }
      // Verify destination is executable (bit set)
      try {
        fs.accessSync(dest, fs.constants.X_OK);
      } catch (accessErr: any) {
        logSilentCatch("server/lib/ffmpeg-paths.ts", accessErr);
        console.warn(`[ffmpeg-paths] ${dest} not executable post-copy (${accessErr?.code || "unknown"}); trying next location`);
        continue;
      }
      // R110.20.3 — actual execve probe. X_OK only checks the bit; it does
      // NOT prove the kernel can map this binary's pages. The whole point
      // of this relocation is to escape an FS where execve returns EIO,
      // so we MUST verify the destination FS can actually run the binary
      // before claiming success. If the relocated path also EIO's (e.g.,
      // tmpfs mounted noexec, or /tmp is itself overlayFS in this deploy),
      // fall through to the next candidate dir.
      try {
        execFileSync(dest, ["-version"], { stdio: "ignore", timeout: 10000 });
        console.log(`[ffmpeg-paths] ${label} relocated path ${dest} passed execve probe`);
        return dest;
      } catch (execErr: any) {
        const code = execErr?.code || execErr?.errno || "unknown";
        console.warn(`[ffmpeg-paths] ${dest} execve probe FAILED (${code}); ${dir} cannot run this binary either, trying next location`);
        continue;
      }
    } catch (_e) {
      logSilentCatch("server/lib/ffmpeg-paths.ts", _e);
    }
  }
  return null;
}

/**
 * Best-effort relocation: returns the tmpfs path if copy+exec-bit succeeded,
 * otherwise returns the original bundled path so behavior degrades gracefully.
 */
function preferTmpfs(srcPath: string, label: "ffmpeg" | "ffprobe"): string {
  const relocated = relocateToTmpfs(srcPath, label);
  return relocated || srcPath;
}

function tryWhich(name: string): string | null {
  try {
    const out = execSync(`which ${name} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0];
    if (out && fs.existsSync(out)) return out;
  } catch (_e) { logSilentCatch("server/lib/ffmpeg-paths.ts", _e); }
  return null;
}

// Quick exec probe — verifies the binary at `path` can actually run.
// Used to detect overlay-FS EIO corruption on the bundled ffprobe/ffmpeg in
// production. Returns true only if `path -version` exits 0 within 3s.
function execProbeOk(path: string): boolean {
  try {
    execSync(`${path} -version`, { encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch (_e) {
    logSilentCatch("server/lib/ffmpeg-paths.ts", _e);
    return false;
  }
}

export function getFfmpegPath(): string {
  if (cachedFfmpeg) return cachedFfmpeg;
  const bundled = tryBundled("ffmpeg");
  if (bundled) {
    const resolved = preferTmpfs(bundled, "ffmpeg");
    // R116.1 — if relocation failed AND the bundled binary is EIO-corrupted on
    // the overlay filesystem, fall through to system ffmpeg before caching the
    // broken path. Saves Felix from a 91%-failure produce_video preflight.
    if (resolved !== bundled || execProbeOk(resolved)) {
      cachedFfmpeg = resolved; return cachedFfmpeg;
    }
    console.warn(`[ffmpeg-paths] bundled ffmpeg at ${bundled} failed exec probe (likely overlayFS EIO) — falling through to system ffmpeg`);
  }
  const which = tryWhich("ffmpeg");
  if (which) { cachedFfmpeg = which; return which; }
  cachedFfmpeg = "ffmpeg";
  return cachedFfmpeg;
}

export function getFfprobePath(): string {
  if (cachedFfprobe) return cachedFfprobe;
  const bundled = tryBundled("ffprobe");
  if (bundled) {
    const resolved = preferTmpfs(bundled, "ffprobe");
    if (resolved !== bundled || execProbeOk(resolved)) {
      cachedFfprobe = resolved; return cachedFfprobe;
    }
    console.warn(`[ffmpeg-paths] bundled ffprobe at ${bundled} failed exec probe (likely overlayFS EIO) — falling through to system ffprobe`);
  }
  const which = tryWhich("ffprobe");
  if (which) { cachedFfprobe = which; return which; }
  cachedFfprobe = "ffprobe";
  return cachedFfprobe;
}

/**
 * For diagnostic logs — returns the resolution method (bundled / system / fallback)
 * so we can tell at a glance which binary is in use.
 */
export function describeFfmpegResolution(): { ffmpeg: string; ffprobe: string; ffmpegSource: string; ffprobeSource: string } {
  const ff = getFfmpegPath();
  const fp = getFfprobePath();
  return {
    ffmpeg: ff,
    ffprobe: fp,
    ffmpegSource: ff.includes("node_modules/ffmpeg-static") ? "bundled" : (ff.includes("visionclaw-ffmpeg-") ? "bundled-tmpfs" : (ff === "ffmpeg" ? "fallback" : "system")),
    ffprobeSource: fp.includes("node_modules/ffprobe-static") ? "bundled" : (fp.includes("visionclaw-ffprobe-") ? "bundled-tmpfs" : (fp === "ffprobe" ? "fallback" : "system")),
  };
}

/** Test-only helper to bust the cache (avoid in production code). */
export function _resetFfmpegPathCacheForTests(): void {
  cachedFfmpeg = null;
  cachedFfprobe = null;
}

/**
 * Capability preflight — checks that the resolved ffmpeg has the encoders
 * AND filters the pipeline depends on. Logs a loud warning for any missing
 * capability so Felix's failures are explained ("text slides will be plain
 * color because drawtext is not in this build") rather than mysterious.
 *
 * Known limitation (R110.20): johnvansickle's ffmpeg-static GPL build does
 * NOT include the `drawtext` filter despite shipping libfreetype. Text-slide
 * generation in mpeg-engine.ts and tools.ts already has a try/catch that
 * falls back to plain-colored slides when drawtext fails, so this is a
 * graceful visual degradation, not a pipeline-breaking issue. Captions
 * burned via `subtitles`/`ass` filters (libass IS present) are unaffected.
 *
 * Returns a structured report; logs warnings via console.warn. Cheap (~50ms
 * cold, then cached). Safe to call at startup or from a healthcheck route.
 */
let cachedCapabilities: FfmpegCapabilities | null = null;
export interface FfmpegCapabilities {
  ffmpegPath: string;
  ffprobePath: string;
  version: string;
  encoders: { libx264: boolean; aac: boolean; libmp3lame: boolean; mjpeg: boolean };
  filters: { drawtext: boolean; xfade: boolean; acrossfade: boolean; zoompan: boolean; blackdetect: boolean; volumedetect: boolean; concat: boolean; amix: boolean; overlay: boolean; subtitles: boolean };
  warnings: string[];
}

export function probeFfmpegCapabilities(): FfmpegCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const ffmpegPath = getFfmpegPath();
  const ffprobePath = getFfprobePath();
  const warnings: string[] = [];
  let version = "unknown";
  let encodersOut = "";
  let filtersOut = "";
  try {
    version = execSync(`"${ffmpegPath}" -hide_banner -version 2>&1 | head -1`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch (e: any) { warnings.push(`ffmpeg -version failed: ${e?.message?.slice(0, 100)}`); }
  try {
    encodersOut = execSync(`"${ffmpegPath}" -hide_banner -encoders 2>&1`, { encoding: "utf-8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e: any) { warnings.push(`ffmpeg -encoders failed: ${e?.message?.slice(0, 100)}`); }
  try {
    filtersOut = execSync(`"${ffmpegPath}" -hide_banner -filters 2>&1`, { encoding: "utf-8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e: any) { warnings.push(`ffmpeg -filters failed: ${e?.message?.slice(0, 100)}`); }

  const has = (haystack: string, needle: string) =>
    new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\s|$)`, "m").test(haystack);

  const encoders = {
    libx264: has(encodersOut, "libx264"),
    aac: has(encodersOut, "aac"),
    libmp3lame: has(encodersOut, "libmp3lame"),
    mjpeg: has(encodersOut, "mjpeg"),
  };
  const filters = {
    drawtext: has(filtersOut, "drawtext"),
    xfade: has(filtersOut, "xfade"),
    acrossfade: has(filtersOut, "acrossfade"),
    zoompan: has(filtersOut, "zoompan"),
    blackdetect: has(filtersOut, "blackdetect"),
    volumedetect: has(filtersOut, "volumedetect"),
    concat: has(filtersOut, "concat"),
    amix: has(filtersOut, "amix"),
    overlay: has(filtersOut, "overlay"),
    subtitles: has(filtersOut, "subtitles"),
  };

  for (const [name, present] of Object.entries(encoders)) {
    if (!present) warnings.push(`MISSING ENCODER: ${name} — pipeline will fail at encode time`);
  }
  for (const [name, present] of Object.entries(filters)) {
    if (!present) {
      // drawtext is a graceful-degradation case (slide fallback to plain
      // color); everything else would be a real pipeline failure.
      const severity = name === "drawtext" ? "DEGRADED" : "MISSING";
      warnings.push(`${severity} FILTER: ${name}${name === "drawtext" ? " — text slides fall back to plain color (not a hard failure)" : " — pipeline path that uses this will fail"}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(`[ffmpeg-paths] capability preflight warnings (${warnings.length}):`);
    for (const w of warnings) console.warn(`[ffmpeg-paths]   ⚠ ${w}`);
  } else {
    console.log(`[ffmpeg-paths] capability preflight OK — all encoders + filters present (${version})`);
  }

  cachedCapabilities = { ffmpegPath, ffprobePath, version, encoders, filters, warnings };
  return cachedCapabilities;
}

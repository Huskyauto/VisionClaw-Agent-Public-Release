/**
 * R110.21 — async ffmpeg runner that does NOT block the Node event loop.
 *
 * Why this exists: server/mpeg-engine.ts Phase 3 used `execFileSync` for every
 * ffmpeg invocation. `execFileSync` is synchronous — it blocks the entire Node
 * thread until the child process exits. With server/video-job-runner.ts running
 * up to MAX_PARALLEL_CHAPTERS chapters concurrently, the second chapter's
 * ffmpeg literally couldn't start until the first chapter's ffmpeg finished,
 * because both share the same event loop. "Parallel" chapters were running
 * serial under the hood — exactly the symptom we hit in prod where 3 chapters
 * × ~5 min each ≈ 15 min wall-clock with zero progress logs.
 *
 * This helper wraps `spawn` in a Promise that:
 *   - resolves with { ok, exitCode, signal, stderrTail, durationMs }
 *   - streams stderr to an in-memory ring buffer (last N lines), so we get
 *     diagnostics on failure without flooding logs
 *   - parses ffmpeg's `-progress pipe:1` key=value stream on stdout if the
 *     caller wires `onProgressLine` (frame=, fps=, out_time_us=, etc.)
 *   - honors a timeout via setTimeout + SIGTERM (then SIGKILL 5s later if the
 *     child ignores the term)
 *   - never blocks the event loop, so OTHER chapters' ffmpeg processes can
 *     actually run in parallel
 *
 * Drop-in replacement for the `execFileSync(ffmpeg, args, { timeout, stdio:"pipe" })`
 * pattern; just `await` it and read `result.ok`/`result.stderrTail` instead of
 * try/catch around the sync call.
 */

import { spawn, type ChildProcess } from "child_process";
import { logSilentCatch } from "./silent-catch";

// R110.21 architect MEDIUM #2: orphan ffmpeg cleanup on Node shutdown.
// execFileSync was sync, so SIGTERM to Node killed the child too. With async
// spawn, in-flight ffmpeg processes can outlive the parent if we don't
// explicitly kill them on shutdown. Track all live ones in a Set; on
// SIGTERM/SIGINT/exit, send SIGTERM to each.
const liveProcs: Set<ChildProcess> = new Set();
let shutdownHooksInstalled = false;
function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const cleanup = (sig: string) => {
    if (liveProcs.size === 0) return;
    console.warn(`[ffmpeg-async] ${sig}: killing ${liveProcs.size} in-flight ffmpeg process(es)`);
    for (const p of Array.from(liveProcs)) {
      try { p.kill("SIGTERM"); } catch (_e) { logSilentCatch("server/lib/ffmpeg-async.ts", _e); }
    }
  };
  process.once("SIGTERM", () => cleanup("SIGTERM"));
  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("beforeExit", () => cleanup("beforeExit"));
}

export interface FfmpegAsyncOpts {
  /** Hard wall-clock cap for this invocation. SIGTERM at this mark, SIGKILL 5s later. */
  timeoutMs: number;
  /** Human-readable label for log lines (e.g. "ch1 encode seg 2/4"). */
  label: string;
  /**
   * Optional progress callback. Wire this if you pass `-progress pipe:1` to
   * ffmpeg — receives parsed key=value pairs (frame, fps, out_time_us, speed,
   * progress=continue|end). Throttle internally; ffmpeg emits progress every
   * ~500ms by default.
   */
  onProgressLine?: (kv: Record<string, string>) => void;
  /** How many trailing stderr lines to retain for the failure tail. Default 30. */
  capturedStderrLines?: number;
  /** If true, forward every stderr line to console.warn with the label. Default false. */
  forwardStderrToConsole?: boolean;
}

export interface FfmpegAsyncResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Last N lines of stderr, joined with \n. Useful for embedding in error messages. */
  stderrTail: string;
  durationMs: number;
  /** True if we killed the child via timeout (SIGTERM/SIGKILL). */
  timedOut: boolean;
}

export async function runFfmpegAsync(
  binary: string,
  args: string[],
  opts: FfmpegAsyncOpts
): Promise<FfmpegAsyncResult> {
  const start = Date.now();
  const tailSize = opts.capturedStderrLines ?? 30;
  const stderrBuf: string[] = [];
  let timedOut = false;
  let timer: NodeJS.Timeout | null = null;
  let hardKillTimer: NodeJS.Timeout | null = null;

  installShutdownHooks();

  return new Promise<FfmpegAsyncResult>((resolve) => {
    // R110.21 architect MEDIUM #1: guard against double-resolve. Both
    // proc.on('error') AND proc.on('exit') CAN fire on some Node versions
    // when spawn fails late (e.g. ENOMEM mid-startup). Without this guard
    // the second resolve would be a silent no-op (Promises ignore later
    // resolves) but Promise/V8 docs warn future versions may surface it.
    let settled = false;
    const settle = (r: FfmpegAsyncResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let proc;
    try {
      proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (spawnErr: any) {
      // spawn itself failed (ENOENT, EACCES, EIO on the binary, etc.) — this
      // is the "binary not executable" path the R110.20.3 tmpfs relocation
      // was designed to escape; surface it cleanly with no-op result.
      settle({
        ok: false,
        exitCode: null,
        signal: null,
        stderrTail: `spawn() threw: code=${spawnErr?.code || ""} errno=${spawnErr?.errno || ""} msg=${(spawnErr?.message || String(spawnErr)).slice(0, 300)}`,
        durationMs: Date.now() - start,
        timedOut: false,
      });
      return;
    }
    liveProcs.add(proc);

    const pushStderr = (line: string) => {
      stderrBuf.push(line);
      if (stderrBuf.length > tailSize) stderrBuf.shift();
      if (opts.forwardStderrToConsole) {
        // Trim noisy progress lines — only forward warnings/errors.
        if (/error|fail|invalid|deprecated|warning/i.test(line)) {
          console.warn(`[ffmpeg-async] ${opts.label}: ${line.slice(0, 240)}`);
        }
      }
    };

    let stderrCarry = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = stderrCarry + chunk.toString("utf-8");
      const lines = text.split("\n");
      stderrCarry = lines.pop() || "";
      for (const line of lines) {
        if (line) pushStderr(line);
      }
    });

    let stdoutCarry = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (!opts.onProgressLine) return;
      const text = stdoutCarry + chunk.toString("utf-8");
      const lines = text.split("\n");
      stdoutCarry = lines.pop() || "";
      const kv: Record<string, string> = {};
      for (const line of lines) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      if (Object.keys(kv).length > 0) {
        try { opts.onProgressLine(kv); } catch (_e) { logSilentCatch("server/lib/ffmpeg-async.ts", _e); }
      }
    });

    timer = setTimeout(() => {
      timedOut = true;
      console.warn(`[ffmpeg-async] ${opts.label} TIMED OUT after ${opts.timeoutMs}ms — SIGTERM`);
      try { proc.kill("SIGTERM"); } catch (_e) { logSilentCatch("server/lib/ffmpeg-async.ts", _e); }
      hardKillTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch (_e) { logSilentCatch("server/lib/ffmpeg-async.ts", _e); }
      }, 5000);
    }, opts.timeoutMs);

    proc.on("error", (err: any) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (hardKillTimer) { clearTimeout(hardKillTimer); hardKillTimer = null; }
      liveProcs.delete(proc);
      pushStderr(`proc error: code=${err?.code || ""} errno=${err?.errno || ""} msg=${(err?.message || String(err)).slice(0, 200)}`);
      settle({
        ok: false,
        exitCode: null,
        signal: null,
        stderrTail: stderrBuf.join("\n"),
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    proc.on("exit", (code, signal) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (hardKillTimer) { clearTimeout(hardKillTimer); hardKillTimer = null; }
      liveProcs.delete(proc);
      if (stderrCarry) pushStderr(stderrCarry);
      const ok = code === 0 && !timedOut;
      settle({
        ok,
        exitCode: code,
        signal,
        stderrTail: stderrBuf.join("\n"),
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}

/**
 * Convenience wrapper that throws on failure with a useful error message,
 * matching the throw-on-non-zero-exit behavior of `execFileSync`. Use this
 * when the caller's existing try/catch expects an exception, not a result.
 */
export async function runFfmpegAsyncOrThrow(
  binary: string,
  args: string[],
  opts: FfmpegAsyncOpts
): Promise<FfmpegAsyncResult> {
  const r = await runFfmpegAsync(binary, args, opts);
  if (!r.ok) {
    const reason = r.timedOut
      ? `timed out after ${opts.timeoutMs}ms`
      : `exit=${r.exitCode} signal=${r.signal || ""}`;
    const e: any = new Error(`[${opts.label}] ffmpeg failed (${reason}): ${r.stderrTail.slice(-400)}`);
    e.stderr = r.stderrTail;
    e.exitCode = r.exitCode;
    e.signal = r.signal;
    e.timedOut = r.timedOut;
    e.durationMs = r.durationMs;
    throw e;
  }
  return r;
}

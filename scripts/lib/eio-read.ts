/**
 * EIO-resilient synchronous file reads for the render-farm scripts path.
 *
 * Replit Reserved VM deploys run on an overlay filesystem that intermittently
 * throws `EIO: i/o error, read` on ordinary `fs.readFileSync`. This already bit
 * exec (see server/lib/ffmpeg-paths.ts) and the served frontend bundle (see the
 * readFileWithRetry helper in server/static.ts). The Built With Bob weekly recap
 * died the same way in prod: a single EIO on the render bundle tarball / script
 * JSON crashed the GitHub-farm handoff, the farm "retried once" and EIO'd again,
 * and the recap fail-closed without ever dispatching CI.
 *
 * The fault is transient, so a handful of retries with a short backoff almost
 * always succeeds. We THROW the original error once retries are exhausted so the
 * existing fail-closed handling still fires on a genuinely dead disk.
 */
import fs from "node:fs";

function sleepSync(ms: number): void {
  // True blocking sleep with no CPU burn (Node 20+). Falls back to a busy-wait
  // if SharedArrayBuffer/Atomics is unavailable for any reason.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* brief backoff before retrying the flaky overlayFS */
    }
  }
}

export function readFileSyncEIO(p: string, tries?: number): Buffer;
export function readFileSyncEIO(p: string, encoding: BufferEncoding, tries?: number): string;
export function readFileSyncEIO(
  p: string,
  encodingOrTries?: BufferEncoding | number,
  triesArg = 6,
): Buffer | string {
  const encoding = typeof encodingOrTries === "string" ? encodingOrTries : undefined;
  const tries = typeof encodingOrTries === "number" ? encodingOrTries : triesArg;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return encoding ? fs.readFileSync(p, encoding) : fs.readFileSync(p);
    } catch (e: any) {
      lastErr = e;
      // Only the transient overlayFS EIO is retryable; ENOENT/EACCES/EISDIR are
      // real and must surface immediately.
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on read of ${p} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(25 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * EIO-resilient `fs.copyFileSync`. The render bundle is assembled by copying
 * every scene image + audio clip + the renderer script into a temp dir; each
 * copy READS the source off the same flaky overlayFS, so a transient EIO on the
 * read side throws `EIO: i/o error, copyfile` uncaught. Same retry policy as
 * readFileSyncEIO: retry ONLY on EIO with short backoff, surface everything else
 * immediately, re-throw the EIO once exhausted so a dead disk still fails closed.
 */
export function copyFileSyncEIO(src: string, dest: string, tries = 6): void {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      fs.copyFileSync(src, dest);
      return;
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on copy ${src} → ${dest} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(25 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * EIO-resilient `fs.statSync`. Reading a file's metadata also touches the
 * overlayFS and can throw a transient `EIO: i/o error, stat`. Same policy:
 * retry ONLY on EIO, surface everything else (ENOENT/EACCES) immediately,
 * re-throw the EIO once exhausted so a dead disk still fails closed. Use this
 * only where the stat result is FUNCTIONAL (feeds a DB row / a decision); for
 * a purely cosmetic size log, a plain try/catch is fine and cheaper.
 */
export function statSyncEIO(p: string, tries = 6): fs.Stats {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return fs.statSync(p);
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on stat of ${p} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(25 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * EIO-resilient `fs.readdirSync`. Listing a directory reads off the overlayFS
 * and can throw a transient `EIO: i/o error, scandir`. Same EIO-only retry +
 * fail-closed policy as the rest of this module.
 */
export function readdirSyncEIO(p: string, tries = 6): string[] {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return fs.readdirSync(p);
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on readdir of ${p} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(25 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Run an async operation that internally READS files off the overlayFS (e.g.
 * node-tar's `create`, which opens and `fs.read`s every bundle file and surfaces
 * a transient fault as `EIO: i/o error, read`), retrying the WHOLE operation
 * only on an EIO. `op` MUST be idempotent — it is re-invoked from scratch on each
 * retry (re-creating the tarball is safe). Any non-EIO error surfaces
 * immediately; the EIO is re-thrown once exhausted so fail-closed still fires.
 */
export async function retryEIOAsync<T>(label: string, op: () => Promise<T>, tries = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO during ${label} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(50 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

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

// Retry budget (Bob 2026-06-27 — "I don't want to spend three more hours").
// The original 6×~25ms budget (~375ms total) was tuned for a SUB-SECOND overlayFS
// blip. But the Reserved VM occasionally enters a PROLONGED degraded-FS spell —
// the recap render (a paid GitHub-farm job) failed all 3 build attempts while the
// box was EIO'ing unrelated reads (the IdeaBrowser heartbeat) for *hours*. A
// short budget can't outlast that, so a worthwhile job dies needlessly. These
// defaults give a capped-exponential budget of ~16s/op (150,300,600,1200,2400,
// then 2500-capped) — generous enough to ride out a multi-second degraded window
// on a batch render job (NOT a request hot path — every caller is a scripts/
// render job), while STILL re-throwing the EIO once exhausted so a genuinely dead
// disk fails closed. All three are env-tunable for a deliberate widening.
// Finite-clamp env tunables so a misconfigured value (Infinity, NaN, a huge
// paste, a negative) can never turn the retry loop unbounded or make sleepSync
// block forever. Each knob is clamped to a finite integer in a sane range; a
// non-finite / out-of-range value falls back to the default, NOT the raw input.
export function clampIntEnv(raw: string | undefined, def: number, lo: number, hi: number): number {
  // Unset or blank env var ⇒ use the default (preserves the original `|| def`
  // semantics; a set-but-empty BWB_EIO_TRIES must NOT silently disable retries
  // by parsing to 0). A genuine numeric value is floored then clamped to range;
  // any non-finite parse (NaN/Infinity/garbage) also falls back to the default.
  if (raw === undefined || raw.trim() === "") return def;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

// tries: at least 1, at most 100 (100 × 2.5s cap ≈ 4min ceiling — already far
// past any observed degraded-FS spell). backoff/cap: finite ms within [1, 120s].
const EIO_TRIES = clampIntEnv(process.env.BWB_EIO_TRIES, 10, 1, 100);
const EIO_BACKOFF_MS = clampIntEnv(process.env.BWB_EIO_BACKOFF_MS, 150, 1, 120_000);
const EIO_BACKOFF_CAP_MS = clampIntEnv(process.env.BWB_EIO_BACKOFF_CAP_MS, 2500, EIO_BACKOFF_MS, 120_000);

/** Capped-exponential backoff for retry attempt `i` (0-indexed). */
function eioBackoffMs(i: number): number {
  return Math.min(EIO_BACKOFF_CAP_MS, EIO_BACKOFF_MS * 2 ** i);
}

export function readFileSyncEIO(p: string, tries?: number): Buffer;
export function readFileSyncEIO(p: string, encoding: BufferEncoding, tries?: number): string;
export function readFileSyncEIO(
  p: string,
  encodingOrTries?: BufferEncoding | number,
  triesArg = EIO_TRIES,
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
        sleepSync(eioBackoffMs(i));
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
export function copyFileSyncEIO(src: string, dest: string, tries = EIO_TRIES): void {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      fs.copyFileSync(src, dest);
      return;
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on copy ${src} → ${dest} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(eioBackoffMs(i));
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
export function statSyncEIO(p: string, tries = EIO_TRIES): fs.Stats {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return fs.statSync(p);
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on stat of ${p} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(eioBackoffMs(i));
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
export function readdirSyncEIO(p: string, tries = EIO_TRIES): string[] {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return fs.readdirSync(p);
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO on readdir of ${p} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(eioBackoffMs(i));
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
export async function retryEIOAsync<T>(label: string, op: () => Promise<T>, tries = EIO_TRIES): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "EIO" && i < tries - 1) {
        console.warn(`[eio-read] EIO during ${label} (attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(eioBackoffMs(i));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * EIO-resilient + VERIFIED `fs.writeFileSync` — a "durable write".
 *
 * Two distinct overlayFS write faults bite the render path, and a plain retry
 * only covers the first:
 *   1. A transient `EIO: i/o error, write` THROWS — caught and retried here.
 *   2. The INSIDIOUS one: during a degraded-FS spell the write call "succeeds"
 *      (no throw) but the bytes that land are TRUNCATED or partial. Nothing
 *      surfaces — the next reader just gets a corrupt PNG / half a manifest /
 *      a clipped video zip, and the render fails late & confusingly (or ships
 *      garbage). A retry-only wrapper never notices because no error was raised.
 *
 * So after every write we read the on-disk SIZE back (through the EIO budget) and
 * confirm it matches the bytes we handed in. A mismatch — or a stat that can't
 * see the file we just wrote — is treated as a transient corruption and the whole
 * write is re-issued. This is the software analog of writing past a flaky sector
 * and re-reading to confirm the write actually stuck before moving on; the disk
 * is virtualized so we can't address sectors, but we CAN refuse to trust a write
 * we haven't verified. Real, non-transient failures (ENOSPC/EACCES) surface
 * immediately; an unverifiable write re-throws once the budget is exhausted so a
 * genuinely dead disk still fails closed.
 *
 * Size verification (not a full content re-read) keeps this cheap enough to run
 * on every write including multi-MB video zips — truncation is the realistic
 * overlayFS corruption signature, and the preflight canary already does a full
 * content round-trip to gate the whole job. Opt out with verify:false only for a
 * write where a read-back is genuinely undesirable (none on the render path).
 */
export function writeFileSyncEIO(
  p: string,
  data: string | Buffer,
  triesOrOpts?: number | { tries?: number; verify?: boolean },
): void {
  const rawTries = typeof triesOrOpts === "number" ? triesOrOpts : triesOrOpts?.tries ?? EIO_TRIES;
  // Clamp to >=1: an accidental tries=0 / NaN caller would skip the loop entirely
  // and fall through to `throw lastErr` (undefined) — i.e. a SILENT no-write. The
  // whole point of this helper is to never silently fail a write, so floor it.
  const tries = Number.isFinite(rawTries) && rawTries >= 1 ? Math.floor(rawTries) : 1;
  const verify = typeof triesOrOpts === "object" ? triesOrOpts.verify !== false : true;
  const expectedBytes = Buffer.byteLength(data);
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      fs.writeFileSync(p, data);
      if (verify) {
        // Read the size back to prove the bytes landed. A transient EIO on the
        // verify-stat, a vanished file, or a short/over-long size are all signs
        // the write did not durably stick → retry the whole write.
        let landed: number;
        try {
          landed = fs.statSync(p).size;
        } catch (se: any) {
          throw Object.assign(
            new Error(`write verify stat failed for ${p}: ${se?.code || se?.message || se}`),
            { code: "EIO_VERIFY" },
          );
        }
        if (landed !== expectedBytes) {
          throw Object.assign(
            new Error(`write verify mismatch for ${p}: wrote ${expectedBytes}B but on-disk size is ${landed}B (overlayFS truncated/partial write)`),
            { code: "EIO_VERIFY" },
          );
        }
      }
      return;
    } catch (e: any) {
      lastErr = e;
      // Retry the transient write EIO AND a failed/short verify (both = the disk
      // hiccupped mid-write); surface ENOSPC/EACCES/etc. immediately.
      if ((e?.code === "EIO" || e?.code === "EIO_VERIFY") && i < tries - 1) {
        console.warn(`[eio-read] write of ${p} failed/unverified (${e?.code}, attempt ${i + 1}/${tries}) — retrying after backoff`);
        sleepSync(eioBackoffMs(i));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * EIO-resilient replacement for `fs.existsSync`.
 *
 * `fs.existsSync` is the INSIDIOUS overlayFS op: unlike readFileSync/statSync,
 * which THROW loudly on a transient EIO (so a retry/fail-closed path fires), it
 * swallows EVERY error and silently returns `false`. On a degraded-FS spell that
 * means a file that IS on disk reads as "missing" → the caller branches down the
 * wrong path (skips a real file, re-bakes a valid image, resets the daily cap, or
 * declares a successful render a failure). That exact silent-false branch cost
 * ~3h and a paid farm render on 2026-06-27.
 *
 * This wrapper restores honest semantics by going THROUGH statSyncEIO:
 *   - file present            → true
 *   - genuinely absent (ENOENT) → false
 *   - transient EIO           → retried via the budget, then true/false
 *   - persistent EIO / other  → THROWN (so the caller's fail-closed path fires
 *                               instead of a silent wrong-branch)
 */
export function existsSyncEIO(p: string, tries = EIO_TRIES): boolean {
  try {
    statSyncEIO(p, tries);
    return true;
  } catch (e: any) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return false;
    // EIO after retries, EACCES, etc. — surface loudly rather than silently
    // returning false the way raw fs.existsSync would.
    throw e;
  }
}

export interface FsHealthResult {
  ok: boolean;
  failedOp?: "mkdir" | "write" | "read" | "verify" | "stat" | "readdir";
  code?: string;
  detail: string;
}

/** Dependency seam so the canary is unit-testable without touching a real disk. */
export interface FsHealthDeps {
  mkdir: (dir: string) => void;
  write: (p: string, data: string) => void;
  read: (p: string) => string;
  stat: (p: string) => { size: number };
  readdir: (dir: string) => string[];
  unlink: (p: string) => void;
}

const realFsHealthDeps: FsHealthDeps = {
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  write: (p, data) => writeFileSyncEIO(p, data),
  read: (p) => readFileSyncEIO(p, "utf8"),
  stat: (p) => statSyncEIO(p),
  readdir: (dir) => readdirSyncEIO(dir),
  unlink: (p) => {
    try { fs.unlinkSync(p); } catch { /* best-effort cleanup of the canary file */ }
  },
};

/**
 * overlayFS health canary. The Reserved-VM overlayFS intermittently enters a
 * prolonged degraded-I/O spell during which ordinary reads/writes EIO for
 * minutes-to-hours. A recap that STARTS during such a spell pays for transcription
 * + image gen + a GitHub-farm render before an EIO finally kills a late stage —
 * the exact "burned 3 hours and money" failure mode.
 *
 * This does a real round-trip on the SAME overlayFS the render writes to
 * (write → read-back+verify → stat → readdir → unlink) THROUGH the EIO retry
 * budget, so a transient blip self-heals and only a genuinely degraded disk
 * reports `ok:false`. The preflight blocks fast & cheap on that, instead of
 * failing expensive & late. Op- and file-agnostic: it empirically tests the disk,
 * covering reads, writes and metadata regardless of which call would later fault.
 */
export function probeFsHealth(dir: string, deps: FsHealthDeps = realFsHealthDeps): FsHealthResult {
  const marker = `.bwb-fs-canary-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = `${dir}/${marker}`;
  const payload = `bwb-fs-canary ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const fail = (op: FsHealthResult["failedOp"], e: any): FsHealthResult => ({
    ok: false,
    failedOp: op,
    code: e?.code,
    detail: `overlayFS ${op} failed: ${[e?.code, e?.message || e].filter(Boolean).join(" ")}`.trim(),
  });

  try { deps.mkdir(dir); } catch (e) { return fail("mkdir", e); }
  try { deps.write(file, payload); } catch (e) { return fail("write", e); }
  try {
    let readBack = "";
    try { readBack = deps.read(file); } catch (e) { return fail("read", e); }
    if (readBack !== payload) {
      return {
        ok: false,
        failedOp: "verify",
        detail: `overlayFS read-back mismatch (wrote ${payload.length}B, read ${readBack.length}B) — the disk is returning corrupt data.`,
      };
    }
    let size = -1;
    try { size = deps.stat(file).size; } catch (e) { return fail("stat", e); }
    if (size <= 0) {
      return { ok: false, failedOp: "stat", detail: `overlayFS stat reports size ${size} for a just-written file.` };
    }
    let listed: string[] = [];
    try { listed = deps.readdir(dir); } catch (e) { return fail("readdir", e); }
    if (!listed.includes(marker)) {
      return { ok: false, failedOp: "readdir", detail: `overlayFS readdir did not list the just-written canary file.` };
    }
  } finally {
    deps.unlink(file);
  }
  return { ok: true, detail: `overlayFS read/write/stat/readdir OK (${payload.length}B round-trip).` };
}

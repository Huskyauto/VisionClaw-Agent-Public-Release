/**
 * scripts/lib/production-priority.ts — cross-process "production gets exclusive
 * priority" lock.
 *
 * Bob's intent (2026-06-14): when a Built With Bob PRODUCTION run is active, every
 * other heavy background job (skill optimizer, tenant audit, knowledge refresh,
 * jury drainer, CI self-healer) should stand down and WAIT until production is
 * done, then resume — so the box's CPU + the shared metered provider lanes aren't
 * hammered by the nightly herd while a real render is in flight.
 *
 * Why a FILE lock (not the in-process concurrency-pool): the nightly jobs each run
 * as their OWN node process (separate workflows), so the in-memory chat-priority
 * pool in server/lib/concurrency-pool.ts cannot see them. A tiny lockfile is the
 * only thing all those independent processes share.
 *
 * DESIGN — GENERATION LOCKS (provably single-owner, Opus 4.8 review 2026-06-14).
 * The lock is NOT a single mutable file. Each "version" of the lock is a distinct,
 * immutable file `production-priority.lock.<gen>`; the highest extant generation is
 * authoritative. The ONLY atomic primitive used is create-if-absent, which is a
 * true single-winner CAS:
 *   - To take over a stale generation `g`, a process CREATES generation `g+1`.
 *     Exactly one process can create `lock.<g+1>` (EEXIST for the losers), so there
 *     is no observe-then-destroy TOCTOU — takeover never mutates a file it did not
 *     author. The old claim/rename/restore dance (which had an irreducible race in
 *     its restore step) is gone.
 *   - Content is published atomically via write-temp-then-link(): linkSync fails
 *     with EEXIST if the generation already exists, AND the file appears with its
 *     full content in one step (no empty/partial-read window that openSync("wx")
 *     followed by a separate write would expose).
 *   - release() removes ONLY the generation file we authored, gated on our unique
 *     token (pid alone is unsafe — pids get reused).
 *
 * SAFETY POSTURE — FAIL OPEN, ALWAYS. A wedged maintenance system (e.g. the
 * tenant-isolation audit, the scariest invariant in the platform) is worse than
 * transient contention. So:
 *   - a crashed/killed holder is detected two independent ways (TTL expiry AND a
 *     dead-pid probe); either one frees the lock.
 *   - waiters NEVER block forever: they wait up to a cap, then proceed anyway.
 *   - any fs/parse error is treated as "no lock held" (proceed), never "blocked".
 */
import * as fs from "node:fs";
import * as path from "node:path";

const LOCK_DIR = process.env.PRODUCTION_LOCK_DIR || ".local/state";
const LOCK_PREFIX = "production-priority.lock.";
const GEN_RE = /^production-priority\.lock\.(\d+)$/;
// Backstop TTL: even if the holder is somehow still "alive" but stuck, the lock
// auto-expires so maintenance can never be starved indefinitely.
const DEFAULT_TTL_MS = Number(process.env.PRODUCTION_LOCK_TTL_MS) || 90 * 60 * 1000; // 90 min

interface LockData {
  label: string;
  pid: number;
  /** Unique per-acquire owner token (pid alone is unsafe — pids get reused). */
  token: string;
  startedAt: number;
  expiresAt: number;
}

function genPath(gen: number): string {
  return path.join(LOCK_DIR, `${LOCK_PREFIX}${gen}`);
}

function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check, no actual signal sent
    return true;
  } catch (e: any) {
    // EPERM = process exists but we can't signal it (still alive); ESRCH = gone.
    return e?.code === "EPERM";
  }
}

/**
 * The highest extant generation and its parsed data. `data` is null when the dir
 * is unreadable, no generation file exists, or the top generation is unreadable/
 * corrupt — all of which fail open to "not held". Because a higher generation is
 * only ever created after the one below it was observed NOT active, the highest
 * generation is always authoritative.
 */
function currentGen(): { gen: number; data: LockData | null } {
  let entries: string[];
  try {
    entries = fs.readdirSync(LOCK_DIR);
  } catch {
    return { gen: -1, data: null }; // dir missing/unreadable => not held (fail open)
  }
  let best = -1;
  for (const n of entries) {
    const m = GEN_RE.exec(n);
    if (m) best = Math.max(best, Number(m[1]));
  }
  if (best < 0) return { gen: -1, data: null };
  try {
    const d = JSON.parse(fs.readFileSync(genPath(best), "utf8")) as LockData;
    if (!d || typeof d.expiresAt !== "number" || typeof d.pid !== "number") return { gen: best, data: null };
    return { gen: best, data: d };
  } catch {
    return { gen: best, data: null }; // unreadable/corrupt top gen => not held (fail open)
  }
}

/** True only if the authoritative generation is held by a still-living process. */
function isActive(d: LockData | null): boolean {
  return (
    !!d &&
    typeof d.expiresAt === "number" &&
    Date.now() <= d.expiresAt && // TTL backstop
    typeof d.pid === "number" &&
    pidAlive(d.pid) // holder died (hard kill bypasses cleanup)
  );
}

/** True only if a fresh lock is held by a still-living process. */
export function isProductionActive(): boolean {
  return isActive(currentGen().data);
}

/** Label of the active production holder, or null if none. */
export function productionLockHolder(): string | null {
  const { data } = currentGen();
  return isActive(data) ? data?.label || "unknown" : null;
}

/**
 * Acquire the production-priority lock. Returns a release() fn. The lock is ALSO
 * auto-released on process teardown (process.exit bypasses try/finally, so we hook
 * the exit + signal events) and, as a last resort, by the TTL/dead-pid backstops.
 *
 * If another production run already holds an ACTIVE lock, this stands aside and
 * returns a no-op release — so our exit can never free a still-running holder's
 * lock.
 */
export function acquireProductionPriority(label: string, ttlMs = DEFAULT_TTL_MS): () => void {
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  } catch {
    /* best effort */
  }
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const { gen, data } = currentGen();

    // 1) A genuinely-active production run holds the top generation → stand aside.
    if (isActive(data)) {
      console.warn(
        `[production-priority] "${label}" found an ACTIVE production lock held by "${data?.label}" (pid ${data?.pid}); proceeding WITHOUT owning the lock (will not release another holder's lock).`,
      );
      return () => {};
    }

    // 2) Top generation is stale/absent → try to author the NEXT generation. Only
    // one process can create lock.<next> (atomic create-if-absent via link); the
    // losers get EEXIST and re-evaluate. Content is published atomically (temp +
    // link) so a concurrent reader never sees an empty/partial generation file.
    const next = gen + 1;
    const myPath = genPath(next);
    const mine: LockData = { label, pid: process.pid, token, startedAt: Date.now(), expiresAt: Date.now() + ttlMs };
    const tmpPath = path.join(LOCK_DIR, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(mine), "utf8");
      fs.linkSync(tmpPath, myPath); // atomic: creates myPath WITH content, or throws EEXIST
    } catch (e: any) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* best effort */
      }
      if (e?.code === "EEXIST") continue; // lost this generation → re-evaluate
      // Any other fs failure: do NOT block production — proceed unlocked.
      console.warn(`[production-priority] could not write lock (proceeding unlocked): ${e?.message || e}`);
      return () => {};
    }
    try {
      fs.unlinkSync(tmpPath); // drop the temp; the linked generation file remains
    } catch {
      /* best effort */
    }

    // We own generation `next`. Best-effort GC of every superseded generation
    // (created only on takeover ≈ crashes, so this stays tiny). Deleting a lower
    // generation is harmless — readers only ever consult the highest one.
    try {
      for (const n of fs.readdirSync(LOCK_DIR)) {
        const m = GEN_RE.exec(n);
        if (m && Number(m[1]) < next) {
          try {
            fs.unlinkSync(path.join(LOCK_DIR, n));
          } catch {
            /* best effort */
          }
        }
      }
    } catch {
      /* best effort — GC is non-critical to correctness */
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        const d = JSON.parse(fs.readFileSync(myPath, "utf8")) as LockData;
        // Only remove the generation if it still carries OUR exact token (a later
        // holder that superseded us authored a higher generation with its own).
        if (d?.token === token) fs.unlinkSync(myPath);
      } catch {
        /* best effort */
      }
    };

    // process.exit() does not run finally blocks; hook teardown so a clean exit
    // always frees the lock for the waiting nightly jobs.
    process.once("exit", release);
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      try {
        process.once(sig, () => {
          release();
          process.exit(0);
        });
      } catch {
        /* signal already handled elsewhere */
      }
    }

    console.log(
      `[production-priority] acquired by "${label}" (pid ${process.pid}, gen ${next}, ttl ${Math.round(ttlMs / 60000)}m)`,
    );
    return release;
  }

  console.warn(`[production-priority] "${label}" could not acquire lock after retries (proceeding unlocked).`);
  return () => {};
}

/**
 * Stand down while a production run is active, then resume. Polls until the lock
 * clears or the wait cap is hit (then proceeds anyway — fail open). Safe to call
 * at the top of any background job's main().
 */
export async function waitForProductionClear(opts: {
  label: string;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<void> {
  const maxWaitMs = opts.maxWaitMs ?? (Number(process.env.PRODUCTION_WAIT_MAX_MS) || 60 * 60 * 1000); // 60 min
  const pollMs = opts.pollMs ?? (Number(process.env.PRODUCTION_WAIT_POLL_MS) || 30 * 1000); // 30 s

  if (!isProductionActive()) return;

  const holder = productionLockHolder();
  const deadline = Date.now() + maxWaitMs;
  console.log(
    `[production-priority] "${opts.label}" standing down — production "${holder}" is active; waiting up to ${Math.round(
      maxWaitMs / 60000,
    )}m...`,
  );
  while (isProductionActive()) {
    if (Date.now() > deadline) {
      console.warn(
        `[production-priority] "${opts.label}" wait cap (${Math.round(
          maxWaitMs / 60000,
        )}m) hit — proceeding anyway (fail open; a stuck holder must not starve maintenance).`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log(`[production-priority] "${opts.label}" resuming — production cleared.`);
}

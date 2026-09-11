import { db } from "./db";
import { sql } from "drizzle-orm";

// Postgres-backed store for the storefront-checkout per-shopper throttle.
//
// Why not the per-process Map this used to be?
//   1. The Map resets on every server restart, so an attacker could just
//      force a deploy churn (or wait for one) to refill their budget.
//      This was the half of Task #29's acceptance criterion that the
//      first cut deferred and the code review explicitly rejected.
//   2. The Map is per-process, so as soon as the storefront runs on more
//      than one instance the limiter becomes inconsistent and the
//      effective per-shopper budget multiplies by the instance count.
//
// Postgres gives us both restart durability and cross-instance
// consistency for free. The traffic envelope is tiny (storefront buys
// peak at a handful per minute) so the extra round-trip per checkout
// attempt is invisible against the multi-second Stripe API call that
// follows it.
//
// Bounded size — strict, not debounced. Every insert is wrapped in a
// single CTE statement that:
//   1. Deletes all globally-expired rows (per-insert sweep).
//   2. Evicts the oldest non-expired rows so that the post-insert table
//      size cannot exceed MAX_TOTAL_ROWS.
//   3. Inserts the new hit.
// All three CTEs run against the same statement snapshot and touch
// disjoint row sets (sweep targets `expires_at <= NOW()`; eviction
// targets `expires_at > NOW()`). The earlier opportunistic
// once-per-minute debounce is gone — an attacker rotating fresh shopper
// keys at high QPS can no longer create unbounded row spikes between
// prune cycles, because the cap is enforced inside the same statement
// as the insert that would otherwise grow the table.

const MAX_TOTAL_ROWS = 50_000;

let __initPromise: Promise<void> | null = null;

// Minimal typed view of the node-postgres QueryResult shape we depend on.
// Avoids `any` casts on every callsite without dragging in pg's full
// type surface; we only ever need the rows array.
interface QueryResultLike<T> {
  rows: T[];
}

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  if (result && typeof result === "object" && Array.isArray((result as QueryResultLike<T>).rows)) {
    return (result as QueryResultLike<T>).rows;
  }
  if (Array.isArray(result)) return result as T[];
  return [];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Operational note: the table + indexes are bootstrapped lazily on the
// first call via CREATE ... IF NOT EXISTS. This is pragmatic in the
// current Replit-managed Postgres setup where the app role can DDL.
// If/when storefront throttle ships to an environment whose DB role is
// read/write only (no DDL grant), this bootstrap will fail on first
// hit; the long-term hardening is to move the schema into a real
// drizzle migration. Tracked as a follow-up.
async function ensureTable(): Promise<void> {
  if (__initPromise) return __initPromise;
  __initPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storefront_checkout_hits (
        id BIGSERIAL PRIMARY KEY,
        rate_key TEXT NOT NULL,
        hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    // (rate_key, expires_at) is the index every read uses: count rows
    // for a given key whose expires_at > NOW().
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS storefront_checkout_hits_key_exp
      ON storefront_checkout_hits (rate_key, expires_at)
    `);
    // Lookup-by-recency for the bounded-size LRU eviction inside the
    // insert CTE.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS storefront_checkout_hits_hit_at
      ON storefront_checkout_hits (hit_at)
    `);
    // expires_at-only index makes the per-insert global sweep
    // (`WHERE expires_at <= NOW()`) an index scan instead of a seq scan
    // as the table approaches MAX_TOTAL_ROWS.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS storefront_checkout_hits_expires_at
      ON storefront_checkout_hits (expires_at)
    `);
  })().catch((err: unknown) => {
    __initPromise = null; // allow retry on next call
    console.error(`[storefront-throttle] failed to ensure table: ${errorMessage(err)}`);
    throw err;
  });
  return __initPromise;
}

export interface RateCheckOutcome {
  allowed: boolean;
  retryAfterSec: number;
}

interface CountRow extends Record<string, unknown> {
  cnt: number | string;
  soonest_expiry: string | Date | null;
}

// Check whether `rateKey` has any budget left in its sliding window,
// and if so RECORD the hit.
//
// Operational behaviour — INTENTIONAL non-transactional read-then-write:
// the count and the insert are two separate statements (no SERIALIZABLE
// wrapper). Under concurrent requests against the SAME rate_key, two
// callers can both observe `cnt < limit` and both insert, briefly
// overshooting the configured limit by up to (concurrency - 1). This
// is acceptable for a soft throttle whose purpose is flood mitigation,
// not exact accounting: the overshoot is bounded by request concurrency
// — far below the order-of-magnitude headroom between the cap and
// legitimate traffic — and a SERIALIZABLE transaction here would trade
// one harmless edge case for a real contention hot spot under load.
// If exact-quota semantics ever become necessary, the right move is a
// per-key advisory lock, not raising the isolation level globally.
export async function recordStorefrontHit(
  rateKey: string,
  limit: number,
  windowMs: number,
): Promise<RateCheckOutcome> {
  await ensureTable();
  const now = Date.now();
  // Count current valid hits for this key, and find the soonest one to
  // expire so we can compute Retry-After accurately when we throttle.
  const countRes = await db.execute(sql`
    SELECT
      COUNT(*)::int AS cnt,
      MIN(expires_at) AS soonest_expiry
    FROM storefront_checkout_hits
    WHERE rate_key = ${rateKey} AND expires_at > NOW()
  `);
  const countRows = rowsOf<CountRow>(countRes);
  const row: CountRow = countRows[0] ?? { cnt: 0, soonest_expiry: null };
  const cnt = Number(row.cnt ?? 0);
  if (cnt >= limit) {
    const soonestMs = row.soonest_expiry ? new Date(row.soonest_expiry).getTime() : now + windowMs;
    const retryAfterSec = Math.max(1, Math.ceil((soonestMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  // Single CTE statement: sweep expired rows, evict oldest non-expired
  // rows if the table is at the cap, then insert the new hit. All three
  // operations execute against the same snapshot; the sweep and the
  // eviction work on disjoint row sets (expires_at <= NOW() vs. > NOW())
  // so they never conflict on the same tuple. The cap is enforced
  // inside this statement, NOT in a separate background prune, which is
  // what keeps growth strictly bounded under flood conditions even
  // when keys are rotated at high QPS.
  const expiresIso = new Date(now + windowMs).toISOString();
  const capLimit = MAX_TOTAL_ROWS - 1;
  await db.execute(sql`
    WITH
      expired_sweep AS (
        DELETE FROM storefront_checkout_hits
        WHERE expires_at <= NOW()
        RETURNING 1
      ),
      oldest_evict AS (
        DELETE FROM storefront_checkout_hits
        WHERE id IN (
          SELECT id FROM storefront_checkout_hits
          WHERE expires_at > NOW()
          ORDER BY hit_at ASC
          LIMIT GREATEST(
            0,
            (SELECT COUNT(*)::int FROM storefront_checkout_hits WHERE expires_at > NOW()) - ${capLimit}
          )
        )
        RETURNING 1
      ),
      new_row AS (
        INSERT INTO storefront_checkout_hits (rate_key, expires_at)
        VALUES (${rateKey}, ${expiresIso}::timestamptz)
        RETURNING 1
      )
    SELECT
      (SELECT COUNT(*) FROM expired_sweep) AS swept,
      (SELECT COUNT(*) FROM oldest_evict) AS evicted,
      (SELECT COUNT(*) FROM new_row) AS inserted
  `);
  return { allowed: true, retryAfterSec: 0 };
}

// Test-only: clear all hits. NODE_ENV-gated so production can never
// accidentally wipe the throttle state.
export async function __resetStorefrontRateLimitForTests(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  await ensureTable();
  await db.execute(sql`DELETE FROM storefront_checkout_hits`);
}

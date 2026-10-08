/**
 * One best-effort, cross-process lane for discretionary memory-heavy work.
 * A dedicated PostgreSQL session holds the advisory lock for the whole job.
 * Never place chat, payment, delivery, health, or safety work behind this gate.
 */
import { Client } from "pg";
import { getHeapStatistics } from "node:v8";

const LOCK_NAMESPACE = 0x56434c4e; // VCLN
const LOCK_KEY = 1;
const HEAP_ADMISSION_FRACTION = 0.7;

type LaneClient = {
  connect(): Promise<void>;
  query(text: string, params?: number[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
};

type LaneOptions = {
  clientFactory?: () => LaneClient;
  heapUsage?: () => number;
  enabled?: boolean;
  onLost?: () => void;
};

function heapFraction(): number {
  return process.memoryUsage().heapUsed / getHeapStatistics().heap_size_limit;
}

/** null = busy or too much heap; rejection = admission unavailable. Neither starts work. */
export async function tryAcquireHeavyWorkLane(
  label: string,
  options: LaneOptions = {},
): Promise<(() => Promise<void>) | null> {
  if (options.enabled === false || (options.enabled === undefined && process.env.HEAVY_WORK_LANE_ENABLED === "0")) {
    return async () => {};
  }
  const fraction = (options.heapUsage ?? heapFraction)();
  if (!Number.isFinite(fraction) || fraction >= HEAP_ADMISSION_FRACTION) {
    console.warn(`[heavy-lane] ${label} deferred: heap ${(fraction * 100).toFixed(0)}% of limit`);
    return null;
  }
  const client = (options.clientFactory ?? (() => new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    keepAlive: true,
  })))();
  let released = false;
  let lockHeld = false;
  let lossNotified = false;
  let releasePromise: Promise<void> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  const notifyLoss = () => {
    if (!lockHeld || released || lossNotified) return;
    lossNotified = true;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    try { options.onLost?.(); }
    catch { console.error(`[heavy-lane] ${label} lock-loss handler failed`); }
  };
  client.on("error", (err) => {
    console.error(`[heavy-lane] ${label} lost its PostgreSQL lock connection: ${err.message}`);
    notifyLoss();
  });
  client.on("end", notifyLoss);
  try {
    await client.connect();
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS got",
      [LOCK_NAMESPACE, LOCK_KEY],
    );
    if (result.rows[0]?.got !== true) {
      await client.end();
      return null;
    }
    lockHeld = true;
    console.log(`[heavy-lane] ${label} acquired`);
    // Long audit slices must keep the session alive: the lock belongs to this
    // connection, not to the process or the queue row.
    keepAliveTimer = setInterval(() => {
      client.query("SELECT 1").catch((err) => {
        console.error(`[heavy-lane] ${label} heartbeat failed: ${err.message}`);
        notifyLoss();
      });
    }, 30_000);
    keepAliveTimer.unref();
    return () => {
      if (releasePromise) return releasePromise;
      releasePromise = (async () => {
        if (released) return;
        released = true;
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        try {
          await client.query(
            "SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked",
            [LOCK_NAMESPACE, LOCK_KEY],
          );
        } finally {
          await client.end();
          console.log(`[heavy-lane] ${label} released`);
        }
      })();
      return releasePromise;
    };
  } catch (err) {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    await client.end().catch(() => {});
    throw err;
  }
}

export class HeavyWorkDeferred extends Error {
  constructor(label: string) { super(`Heavy-work lane unavailable for ${label}; retry later`); }
}

/** Use at the real work boundary so every caller, including direct tools, is covered. */
export async function withHeavyWorkLane<T>(label: string, work: () => Promise<T>): Promise<T> {
  let release: (() => Promise<void>) | null;
  try {
    release = await tryAcquireHeavyWorkLane(label);
  } catch (err: any) {
    console.warn(`[heavy-lane] ${label} admission failed: ${err.message}`);
    throw new HeavyWorkDeferred(label);
  }
  if (!release) throw new HeavyWorkDeferred(label);
  try {
    return await work();
  } finally {
    // Work may have already committed. A lost release must be loud, but must
    // not turn successful side effects into a duplicate queue retry.
    try { await release(); }
    catch (err: any) { console.error(`[heavy-lane] ${label} release failed: ${err.message}`); }
  }
}
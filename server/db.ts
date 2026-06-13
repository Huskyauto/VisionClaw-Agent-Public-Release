import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 30,
  idleTimeoutMillis: 300000,
  connectionTimeoutMillis: 20000,
  statement_timeout: 60000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

pool.on("connect", (client) => {
  client.on("error", (err) => {
    console.error("[db] Client error (will be removed from pool):", err.message);
  });
});

export const db = drizzle(pool, { schema });
export { pool };

/**
 * R120 — Tenant-aware DB transaction. Sets `SET LOCAL app.current_tenant = N`
 * for the duration of the txn so Postgres row-level security policies
 * (see scripts/migrations/R120-rls-policies.sql) refuse to return rows from
 * any tenant other than `tenantId`. Second line of defense behind the existing
 * app-layer WHERE clauses.
 *
 * Usage:
 *   await withTenantTx(tenantId, async (tx) => {
 *     const rows = await tx.execute(sql`SELECT * FROM messages`);
 *     // rows are guaranteed to belong to `tenantId` — even if WHERE is missing
 *   });
 *
 * NOTE: SET LOCAL is bound to the transaction; it expires automatically on
 * COMMIT/ROLLBACK and never leaks to the next checkout from the pool.
 */
export async function withTenantTx<T>(
  tenantId: number,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`withTenantTx: invalid tenantId ${tenantId}`);
  }
  const { sql } = await import("drizzle-orm");
  return await db.transaction(async (tx: any) => {
    // Fully parameterized: tenantId is bound as a SQL parameter via
    // Drizzle's ${} interpolation (set_config accepts text for value 2;
    // we cast the integer to text inside SQL). No sql.raw, no string
    // interpolation into the SQL text, no policy ambiguity even though
    // tenantId is already integer-guarded above.
    // set_config(name, value, is_local=true) is bound to the txn and
    // expires on COMMIT/ROLLBACK — never leaks across pool checkouts.
    await tx.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}::text, true)`,
    );
    // Hard fail-close: verify the setting actually took. If a misconfigured
    // pooler ever rejected the SET silently, the policy would fall back to
    // "no context" (Phase 1 audit-mode = visible everything) — explicit
    // readback prevents that quiet failure mode.
    const r: any = await tx.execute(
      sql`SELECT current_setting('app.current_tenant', true) AS v`,
    );
    const rows = (r as any).rows || r;
    const v = rows?.[0]?.v;
    if (String(v) !== String(tenantId)) {
      throw new Error(
        `withTenantTx: set_config readback mismatch (expected ${tenantId}, got ${JSON.stringify(v)})`,
      );
    }
    return await fn(tx);
  });
}

export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export function isPoolHealthy(): boolean {
  return pool.waitingCount < (pool as any).options.max! * 0.5;
}

export async function testPoolConnection(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export function isOffHours(): boolean {
  const centralHour = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(centralHour, 10);
  return hour >= 0 && hour < 6;
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isConnectionError =
        err.code === "ECONNREFUSED" ||
        err.code === "ETIMEDOUT" ||
        err.code === "57P01" ||
        err.code === "57P03" ||
        err.code === "08006" ||
        err.code === "08001" ||
        err.code === "08003" ||
        err.message?.includes("Connection terminated") ||
        err.message?.includes("connection timeout") ||
        err.message?.includes("too many clients");

      if (isConnectionError && attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        console.warn(`[db-retry] ${label} attempt ${attempt}/${maxRetries} failed: ${err.message} — retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`[db-retry] ${label} exhausted retries`);
}

let _poolMonitorInterval: ReturnType<typeof setInterval> | null = null;

export function startPoolMonitor() {
  if (_poolMonitorInterval) return;
  _poolMonitorInterval = setInterval(() => {
    const stats = getPoolStats();
    if (stats.waiting > 5 || stats.idle === 0) {
      console.warn(`[db-pool] pressure: total=${stats.total} idle=${stats.idle} waiting=${stats.waiting}`);
    }
  }, 30000);
}

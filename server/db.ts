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

export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export function isPoolHealthy(): boolean {
  return pool.waitingCount < pool.options.max! * 0.5;
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

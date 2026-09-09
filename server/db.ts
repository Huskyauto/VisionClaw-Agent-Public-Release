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
  // Let the process exit naturally when no queries are pending. Benign in prod
  // (the HTTP listener holds the loop); without it, any test that lazily touches
  // pg holds the event loop for idleTimeoutMillis (300s) → run.sh 60s cap = exit 124.
  allowExitOnIdle: true,
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

export type RlsAvailability = "available" | "unavailable" | "unknown";

/**
 * This is deliberately a status-only receipt: it must never include a tenant
 * ID, database URL, login role, or an error returned by Postgres.
 */
export interface RlsEnforcementReceipt {
  configured: boolean;
  available: RlsAvailability;
}

const RLS_RECEIPT_TIMEOUT_MS = 1_000;
const RLS_AVAILABILITY_QUERY = `
  WITH expected(table_name) AS (
    VALUES
      ('memory_entries'), ('messages'), ('conversations'), ('file_storage'),
      ('message_feedback'), ('customers'), ('invoices'), ('leads'), ('contracts'),
      ('knowledge_entries'), ('agent_trace_spans'), ('mind_tickets'), ('agent_runs'),
      ('procedure_edits'), ('skill_optimization_candidates'),
      ('skill_optimization_versions')
  ),
  eligible AS (
    SELECT c.oid
    FROM expected e
    JOIN pg_namespace n ON n.nspname = 'public'
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attname = 'tenant_id' AND NOT a.attisdropped
  ),
  coverage AS (
    SELECT
      count(*)::int AS expected_count,
      count(*) FILTER (
        WHERE c.relrowsecurity
          AND EXISTS (
            SELECT 1 FROM pg_policy p
            WHERE p.polrelid = c.oid
              AND p.polname = 'r120_tenant_isolation'
          )
      )::int AS covered_count
    FROM eligible e
    JOIN pg_class c ON c.oid = e.oid
  ),
  role_state AS (
    SELECT
      EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'visionclaw_rls'
        AND NOT rolsuper
        AND NOT rolbypassrls
      ) AND pg_has_role(current_user, 'visionclaw_rls', 'SET') AS can_set_role
  )
  SELECT
    coverage.expected_count,
    coverage.covered_count,
    role_state.can_set_role,
    (
      coverage.expected_count > 0
      AND coverage.expected_count = coverage.covered_count
      AND role_state.can_set_role
    ) AS available
  FROM coverage CROSS JOIN role_state
`;

export function isRlsEnforcementConfigured(
  env: { RLS_ENFORCE?: string } = { RLS_ENFORCE: process.env.RLS_ENFORCE },
): boolean {
  return env.RLS_ENFORCE === "1";
}

export function rlsAvailabilityFromProbe(result: unknown): RlsAvailability {
  const row = (result as {
    rows?: Array<{
      available?: unknown;
      expected_count?: unknown;
      covered_count?: unknown;
      can_set_role?: unknown;
    }>;
  })?.rows?.[0];
  return row?.available === true
    && typeof row.expected_count === "number"
    && row.expected_count > 0
    && row.covered_count === row.expected_count
    && row.can_set_role === true
    ? "available"
    : "unavailable";
}

async function probeRlsAvailability(): Promise<unknown> {
  // Catalog-only query: it reads no application tables or tenant context.
  // Racing it prevents a receipt probe from delaying startup when Postgres is
  // unhealthy. The original query is still safely owned by the pool.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pool.query(RLS_AVAILABILITY_QUERY),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("RLS availability probe timed out")),
          RLS_RECEIPT_TIMEOUT_MS,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getRlsEnforcementReceipt(
  probe: (() => Promise<unknown>) | undefined = process.env.DATABASE_URL
    ? probeRlsAvailability
    : undefined,
  env: { RLS_ENFORCE?: string } = { RLS_ENFORCE: process.env.RLS_ENFORCE },
): Promise<RlsEnforcementReceipt> {
  const configured = isRlsEnforcementConfigured(env);
  if (!probe) return { configured, available: "unknown" };

  try {
    return { configured, available: rlsAvailabilityFromProbe(await probe()) };
  } catch {
    // Database reachability is observation only; it must not block startup or
    // turn a transient outage into an application startup failure.
    return { configured, available: "unknown" };
  }
}

export async function emitRlsEnforcementReceipt(): Promise<void> {
  const receipt = await getRlsEnforcementReceipt();
  console.info(`[rls-receipt] ${JSON.stringify(receipt)}`);
}

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
    // R125 — make RLS actually ENFORCE (opt-in, default OFF). The login role
    // `postgres` is a superuser with BYPASSRLS, so RLS never filters a row for
    // it (FORCE doesn't change that — superusers always bypass RLS). When
    // RLS_ENFORCE=1, drop to a dedicated NOLOGIN/NOSUPERUSER/NOBYPASSRLS role
    // for the body of this txn so the r120_tenant_isolation policies apply. The
    // role is NOT the table owner, so the policy enforces with no FORCE needed.
    // SET LOCAL reverts on COMMIT/ROLLBACK — the pooled connection returns to
    // `postgres` cleanly. Requires scripts/migrations/R125-rls-enforcement-role.sql.
    // Fail-CLOSED: if the role is missing this throws and the txn aborts, which
    // is correct for an explicit opt-in enforcement mode.
    if (process.env.RLS_ENFORCE === "1") {
      await tx.execute(sql`SET LOCAL ROLE visionclaw_rls`);
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
  // Non-blocking and fail-safe. It reports only RLS installation/configuration
  // booleans so startup logs contain an auditable receipt without credentials
  // or tenant data.
  void emitRlsEnforcementReceipt();
  _poolMonitorInterval = setInterval(() => {
    const stats = getPoolStats();
    if (stats.waiting > 5 || stats.idle === 0) {
      console.warn(`[db-pool] pressure: total=${stats.total} idle=${stats.idle} waiting=${stats.waiting}`);
    }
  }, 30000);
}

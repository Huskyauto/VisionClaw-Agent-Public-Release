import type { Pool, PoolClient } from "pg";

// Global provider-account coordination; no caller/tenant input or customer data.
const LOCK_NAMESPACE = 20261030;
const LOCK_KEY = 429;
async function query(client: PoolClient, text: string, values: unknown[] = []) {
  const config = { text, values, query_timeout: 500 };
  return client.query(config);
}

/** Separate factory allows session-aware offline tests with no live credentials. */
export function createReplitSessionAcquirer(pool: Pick<Pool, "connect">) {
  let checkoutInProgress = false;
  return async (signal?: AbortSignal | null) => {
    signal?.throwIfAborted();
    if (checkoutInProgress) return null;
    checkoutInProgress = true;
    let expired = false;
    const pending = pool.connect().then(client => {
      if (expired || signal?.aborted) { client.release(); return null; }
      return client;
    }).finally(() => { checkoutInProgress = false; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = await Promise.race([
      pending,
      new Promise<null>(resolve => {
        timer = setTimeout(() => { expired = true; resolve(null); }, 500);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!client) return null;
    let released = false;
    const release = Object.assign(async () => {
      if (released) return;
      released = true;
      try {
        await query(client, "SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, LOCK_KEY]);
        client.release();
      } catch {
        client.release(true); // never return an uncertain/locked session to the pool.
      }
    }, { cooldown: async (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_000_000) throw new Error("Invalid cooldown");
      await query(client, `INSERT INTO ai_transport_cooldowns (transport, cooldown_until, updated_at)
        VALUES ('replit-openai', CURRENT_TIMESTAMP + $1 * INTERVAL '1 millisecond', CURRENT_TIMESTAMP)
        ON CONFLICT (transport) DO UPDATE SET
          cooldown_until = GREATEST(ai_transport_cooldowns.cooldown_until, EXCLUDED.cooldown_until),
          updated_at = CURRENT_TIMESTAMP`, [ms]);
    } });
    try {
      signal?.throwIfAborted();
      const result = await query(client, "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        [LOCK_NAMESPACE, LOCK_KEY]);
      if (!result.rows[0]?.acquired) { client.release(); return null; }
      const cooldown = await query(client, `SELECT 1 FROM ai_transport_cooldowns
        WHERE transport = 'replit-openai' AND cooldown_until > CURRENT_TIMESTAMP`);
      if (cooldown.rows.length) { await release(); return null; }
      signal?.throwIfAborted();
      return release;
    } catch (error) {
      if (!released) { released = true; client.release(true); }
      throw error;
    }
  };
}

let acquire: ReturnType<typeof createReplitSessionAcquirer> | undefined;
let cooldownRead: Promise<boolean> | undefined;
let knownCooldown = { active: false, validUntil: 0 };

/** Routing hint only: dispatch still rechecks under the cross-process lock. */
export async function replitCooldownActive(): Promise<boolean> {
  if (knownCooldown.validUntil > Date.now()) return knownCooldown.active;
  if (cooldownRead) return cooldownRead;
  cooldownRead = (async () => {
    const { pool } = await import("../db");
    const config = {
      text: `SELECT cooldown_until > CURRENT_TIMESTAMP AS active FROM ai_transport_cooldowns
        WHERE transport = 'replit-openai'`,
      query_timeout: 500,
    };
    const result = await pool.query(config);
    const active = result.rows[0]?.active === true;
    knownCooldown = { active, validUntil: Date.now() + 500 };
    return active;
  })().finally(() => { cooldownRead = undefined; });
  return cooldownRead;
}

export async function acquireReplitSession(signal?: AbortSignal | null) {
  const { pool } = await import("../db");
  acquire ??= createReplitSessionAcquirer(pool);
  return acquire(signal);
}

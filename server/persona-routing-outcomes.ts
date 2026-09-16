/**
 * Outcome-learned persona routing (Kimi K3 #3).
 *
 * The CEO orchestrator's matchPersona() routes by static keyword scores. This
 * module blends in an ADVISORY adjustment learned from the action_outcomes
 * ledger: personas with a strong measured track record get a small boost,
 * personas with a weak one a small penalty. The adjustment is deliberately
 * smaller than a single keyword hit (±1 vs 2-3), so learned signal can break
 * ties and nudge — never override — the declared skill mapping.
 *
 * Synchronous read from an in-memory per-tenant cache (matchPersona is sync);
 * the cache refreshes fire-and-forget on stale reads. Fail-open: no data / any
 * error ⇒ adjustment 0.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "./lib/silent-catch";

const CACHE_TTL_MS = 10 * 60 * 1000;
const LOOKBACK_DAYS = 90;
const MIN_SAMPLES = 5;
const BOOST_RATE = 0.8;
const PENALTY_RATE = 0.4;

interface TenantRates {
  fetchedAt: number;
  refreshing: boolean;
  /** persona name (lowercase) → { success, total } over the lookback window */
  rates: Map<string, { success: number; total: number }>;
}

const cache = new Map<number, TenantRates>();

function refreshTenant(tenantId: number): void {
  const entry = cache.get(tenantId);
  if (entry?.refreshing) return;
  const next: TenantRates = entry ?? { fetchedAt: 0, refreshing: false, rates: new Map() };
  next.refreshing = true;
  cache.set(tenantId, next);

  (async () => {
    try {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
      const r: any = await db.execute(sql`
        SELECT p.name AS persona_name,
               count(*) FILTER (WHERE ao.outcome_status = 'success') AS successes,
               count(*) FILTER (WHERE ao.outcome_status IN ('success', 'failure')) AS total
        FROM action_outcomes ao
        JOIN personas p ON p.id = ao.persona_id
        WHERE ao.tenant_id = ${tenantId}
          AND ao.action_timestamp > ${cutoff}
        GROUP BY p.name
      `);
      const rates = new Map<string, { success: number; total: number }>();
      for (const row of ((r.rows ?? r) as any[])) {
        rates.set(String(row.persona_name).toLowerCase(), {
          success: Number(row.successes) || 0,
          total: Number(row.total) || 0,
        });
      }
      cache.set(tenantId, { fetchedAt: Date.now(), refreshing: false, rates });
    } catch (err) {
      logSilentCatch("server/persona-routing-outcomes.ts", err);
      const stale = cache.get(tenantId);
      if (stale) stale.refreshing = false;
    }
  })();
}

/**
 * Advisory score adjustment for a persona from measured outcomes.
 * Returns +1 (strong record), -1 (weak record), or 0 (no signal).
 * Synchronous; triggers a background refresh when the cache is stale.
 */
export function getPersonaOutcomeAdjustment(personaName: string, tenantId: number): number {
  if (!tenantId || tenantId <= 0) return 0;
  const entry = cache.get(tenantId);
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    refreshTenant(tenantId);
  }
  const stats = entry?.rates.get(personaName.toLowerCase());
  if (!stats || stats.total < MIN_SAMPLES) return 0;
  const rate = stats.success / stats.total;
  if (rate >= BOOST_RATE) return 1;
  if (rate <= PENALTY_RATE) return -1;
  return 0;
}

/** Test/inspection helper. */
export function _peekOutcomeCache(tenantId: number) {
  return cache.get(tenantId) ?? null;
}

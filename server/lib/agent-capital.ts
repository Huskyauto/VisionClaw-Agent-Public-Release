// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S7b — per-tenant capital pool (reinvestment loop).
// Feature contract: data/feature-contracts/revenue-missions.
//
// DeepSeek review gap #2: mission P&L now settles into a durable per-tenant
// pool. Rules (all deterministic, no LLM):
//  - The pool starts UNSEEDED ($0, seeded_at NULL). An unseeded pool imposes
//    NO constraint — the existing HARD_CAPS regime governs. It is never
//    auto-funded from a payment method; only the owner seeds it.
//  - Settlement happens once per mission (capital_settled_at guard) on the
//    terminal transition, applying REALIZED margin only (revenue − refunds −
//    spend) — never forecast. Balance floors at 0 (missions can't drive the
//    pool negative; losses are recorded in total_spent).
//  - poolRiskCeilingUsdCents = 25% of balance for a SEEDED pool (never risk
//    more than a quarter of capital on one mission); null when unseeded.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`agent-capital: invalid tenantId ${tenantId} (fail closed)`);
  }
}

export interface CapitalPool {
  tenantId: number;
  balanceUsdCents: number;
  totalEarnedUsdCents: number;
  totalSpentUsdCents: number;
  seeded: boolean;
}

/** Fraction of a seeded pool that one mission may put at risk. */
export const POOL_RISK_FRACTION = 0.25;

/** Pure: risk ceiling for a pool snapshot. Null = unseeded = no pool constraint. */
export function riskCeilingForPool(pool: { balanceUsdCents: number; seeded: boolean } | null): number | null {
  if (!pool || !pool.seeded) return null;
  return Math.floor(Math.max(0, pool.balanceUsdCents) * POOL_RISK_FRACTION);
}

/** Pure: apply one settlement to a pool snapshot (exported for query-free tests). */
export function applyMarginToPool(
  pool: { balanceUsdCents: number; totalEarnedUsdCents: number; totalSpentUsdCents: number },
  realizedMarginUsdCents: number,
): { balanceUsdCents: number; totalEarnedUsdCents: number; totalSpentUsdCents: number } {
  const m = Number(realizedMarginUsdCents);
  if (!Number.isFinite(m)) return pool; // unreadable margin: no-op, never corrupt the ledger
  const margin = Math.trunc(m);
  return {
    balanceUsdCents: Math.max(0, pool.balanceUsdCents + margin),
    totalEarnedUsdCents: pool.totalEarnedUsdCents + Math.max(0, margin),
    totalSpentUsdCents: pool.totalSpentUsdCents + Math.max(0, -margin),
  };
}

export async function getPool(tenantId: number): Promise<CapitalPool | null> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM agent_capital WHERE tenant_id = ${tenantId} LIMIT 1
  `);
  const r = rows(res)[0];
  if (!r) return null;
  return {
    tenantId,
    balanceUsdCents: Number(r.balance_usd_cents) || 0,
    totalEarnedUsdCents: Number(r.total_earned_usd_cents) || 0,
    totalSpentUsdCents: Number(r.total_spent_usd_cents) || 0,
    seeded: r.seeded_at != null,
  };
}

/** Risk ceiling for the tenant's pool; null when the pool is unseeded/absent. */
export async function poolRiskCeilingUsdCents(tenantId: number): Promise<number | null> {
  const pool = await getPool(tenantId);
  return riskCeilingForPool(pool);
}

/**
 * Owner-only seeding (HITL — callers must already have verified the owner
 * channel). Upsert + re-read/assert (singleton-settings pattern: an
 * update-only helper silently no-ops on a missing row).
 */
export async function seedPool(tenantId: number, amountUsdCents: number, seededBy: string): Promise<CapitalPool> {
  assertTenant(tenantId);
  const amt = Math.floor(Number(amountUsdCents));
  if (!Number.isFinite(amt) || amt < 0) throw new Error(`agent-capital: invalid seed amount ${amountUsdCents} (fail closed)`);
  await db.execute(sql`
    INSERT INTO agent_capital (tenant_id, balance_usd_cents, seeded_at, seeded_by, updated_at)
    VALUES (${tenantId}, ${amt}, CURRENT_TIMESTAMP, ${seededBy}, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id) DO UPDATE
    SET balance_usd_cents = agent_capital.balance_usd_cents + ${amt},
        seeded_at = COALESCE(agent_capital.seeded_at, CURRENT_TIMESTAMP),
        seeded_by = ${seededBy},
        updated_at = CURRENT_TIMESTAMP
  `);
  const pool = await getPool(tenantId);
  if (!pool) throw new Error("agent-capital: seed write did not persist (fail closed)");
  return pool;
}

/**
 * Idempotent per-mission settlement: applies the mission's REALIZED margin to
 * the pool exactly once, guarded by revenue_missions.capital_settled_at.
 * Runs in one transaction with a per-tenant advisory lock (same pattern as
 * the experiment-draft cap) so concurrent terminal transitions can't
 * double-settle or interleave pool math.
 */
export async function settleMissionCapital(tenantId: number, missionId: number): Promise<{ settled: boolean; marginUsdCents?: number }> {
  assertTenant(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('agent-capital-settle'), ${tenantId})`);
    // Claim the mission for settlement (idempotency CAS).
    const claim = await tx.execute(sql`
      UPDATE revenue_missions
      SET capital_settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId} AND id = ${missionId}
        AND stage IN ('killed', 'scale_ready')
        AND capital_settled_at IS NULL
      RETURNING revenue_usd_cents, refunds_usd_cents, spend_usd_cents
    `);
    const m = rows(claim)[0];
    if (!m) return { settled: false }; // already settled, non-terminal, or not found
    const margin =
      (Number(m.revenue_usd_cents) || 0) - (Number(m.refunds_usd_cents) || 0) - (Number(m.spend_usd_cents) || 0);
    await tx.execute(sql`
      INSERT INTO agent_capital (tenant_id, balance_usd_cents, total_earned_usd_cents, total_spent_usd_cents, updated_at)
      VALUES (${tenantId}, ${Math.max(0, margin)}, ${Math.max(0, margin)}, ${Math.max(0, -margin)}, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id) DO UPDATE
      SET balance_usd_cents = GREATEST(0, agent_capital.balance_usd_cents + ${margin}),
          total_earned_usd_cents = agent_capital.total_earned_usd_cents + ${Math.max(0, margin)},
          total_spent_usd_cents = agent_capital.total_spent_usd_cents + ${Math.max(0, -margin)},
          updated_at = CURRENT_TIMESTAMP
    `);
    return { settled: true, marginUsdCents: margin };
  });
}

/**
 * Durable-retry reconciler: sweeps terminal missions whose capital was never
 * settled (the fire-and-forget hook in setStage can lose a transient failure)
 * and re-invokes the idempotent settleMissionCapital for each. Safe to call
 * from any cadence — settlement CAS makes double-invocation a no-op.
 */
export async function reconcileUnsettledCapital(tenantId: number): Promise<number> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT id FROM revenue_missions
    WHERE tenant_id = ${tenantId}
      AND stage IN ('killed', 'scale_ready')
      AND capital_settled_at IS NULL
    ORDER BY id
    LIMIT 50
  `);
  const pending = rows(res);
  let settled = 0;
  let failed = 0;
  for (const m of pending) {
    try {
      const out = await settleMissionCapital(tenantId, Number(m.id));
      if (out.settled) settled++;
    } catch (e) {
      failed++;
      console.warn("[agent-capital] reconcile settle failed (will retry next sweep):", (e as any)?.message ?? e);
    }
  }
  if (settled > 0) console.log(`[agent-capital] reconciled ${settled} unsettled terminal mission(s) for tenant ${tenantId}`);
  if (failed > 0) console.warn(`[agent-capital] reconcile sweep degraded: ${failed}/${pending.length} settlement(s) failed for tenant ${tenantId} (attempted=${pending.length}, settled=${settled})`);
  return settled;
}

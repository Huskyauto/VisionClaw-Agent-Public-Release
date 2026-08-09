// ─────────────────────────────────────────────────────────────────────────────
// Mission economics — true contribution margin (CPT 5.6 external review,
// priority 4, 2026-08-02).
//
// "Realized margin" (revenue − refunds − spend) omits Stripe payment fees and
// variable LLM/API costs, so reinvestment decisions ran on overstated margin.
// This module computes the honest figure:
//
//   contribution margin = revenue − refunds − recorded spend
//                       − payment fees − variable API/model cost
//
// Sources (all deterministic, no LLM):
//  - revenue/refunds/spend: revenue_missions rollup counters (evidence-derived);
//  - payment fees: mission_evidence rows type='other' raw.kind='payment_fee'
//    (written by the Stripe webhook from the charge's balance transaction,
//    deduped on the balance-transaction id via the evidence unique index);
//  - variable API cost: agent_cost_ledger rows stamped with mission_id via
//    withMissionCostAttribution (see server/agentic/cost-ledger.ts). Ledger
//    cost_usd is a USD decimal string; we CEIL to whole cents so rounding can
//    never overstate margin.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

export function requireNonNegInt(v: unknown, label: string, missionId: number): number {
  if (v == null || typeof v === "boolean" || typeof v === "object" || (typeof v === "string" && v.trim() === "")) throw new Error(`mission-economics: ${label} unreadable (${String(v)}) for mission ${missionId} (fail closed)`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`mission-economics: ${label} unreadable (${String(v)}) for mission ${missionId} (fail closed)`);
  return n;
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-economics: invalid tenantId ${tenantId} (fail closed)`);
  }
}

export interface ContributionMarginParts {
  revenueUsdCents: unknown;
  refundsUsdCents: unknown;
  spendUsdCents: unknown;
  paymentFeesUsdCents: unknown;
  variableApiCostUsdCents: unknown;
}

/**
 * Pure contribution-margin math. Fail CLOSED: any non-clean-number part
 * (NaN, Infinity, negative, non-number, null) returns null — callers must
 * treat an uncomputable margin as "do not settle / do not reinvest", never
 * as zero costs (value-cap type-confusion defense).
 */
export function computeContributionMarginUsdCents(parts: ContributionMarginParts): number | null {
  const vals: number[] = [];
  for (const v of [parts.revenueUsdCents, parts.refundsUsdCents, parts.spendUsdCents, parts.paymentFeesUsdCents, parts.variableApiCostUsdCents]) {
    const n = Number(v);
    if (v == null || typeof v === "boolean" || !Number.isFinite(n) || n < 0) return null;
    vals.push(Math.floor(n));
  }
  const [revenue, refunds, spend, fees, apiCost] = vals;
  return revenue - refunds - spend - fees - apiCost;
}

/** Pure: extract a payment-fee evidence item from a Stripe balance transaction.
 * Fail closed: anything without a clean txn_ id and a non-negative integer fee
 * returns null (no evidence written beats a corrupted ledger). */
export function paymentFeeItemFromBalanceTransaction(bt: unknown): { externalRef: string; feeUsdCents: number } | null {
  const id = (bt as any)?.id;
  if (typeof id !== "string" || !id.startsWith("txn_")) return null;
  const fee = Number((bt as any)?.fee);
  if (!Number.isSafeInteger(fee) || fee < 0) return null;
  return { externalRef: id, feeUsdCents: fee };
}

export interface MissionEconomics {
  revenueUsdCents: number;
  refundsUsdCents: number;
  spendUsdCents: number;
  paymentFeesUsdCents: number;
  variableApiCostUsdCents: number;
  /** legacy figure — kept for comparison surfaces */
  realizedMarginUsdCents: number;
  contributionMarginUsdCents: number;
}

/** Sum of recorded Stripe payment fees for a mission (whole cents). Throws on
 * unreadable rows — callers must fail closed, not assume $0 fees. */
export async function sumPaymentFeesUsdCents(tenantId: number, missionId: number): Promise<number> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(amount_usd_cents), 0)::bigint AS fees
    FROM mission_evidence
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
      AND type = 'other' AND raw->>'kind' = 'payment_fee'
  `);
  const n = Number(rows(res)[0]?.fees);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`mission-economics: unreadable fee sum for mission ${missionId} (fail closed)`);
  return n;
}

/** Sum of mission-attributed variable API/model cost (whole cents, CEILed so
 * rounding never overstates margin). Throws on unreadable rows. */
export async function sumVariableApiCostUsdCents(tenantId: number, missionId: number): Promise<number> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT CEIL(COALESCE(SUM(cost_usd::numeric), 0) * 100)::bigint AS cents
    FROM agent_cost_ledger
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
  `);
  const n = Number(rows(res)[0]?.cents);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`mission-economics: unreadable api-cost sum for mission ${missionId} (fail closed)`);
  return n;
}

/**
 * Deterministic per-mission economic ledger. Throws when any component is
 * unreadable (fail closed — an uncomputable margin must halt settlement and
 * reinvestment, never silently read as "no costs").
 */
export async function getMissionEconomics(tenantId: number, missionId: number): Promise<MissionEconomics> {
  assertTenant(tenantId);
  const mres = await db.execute(sql`
    SELECT revenue_usd_cents, refunds_usd_cents, spend_usd_cents
    FROM revenue_missions WHERE tenant_id = ${tenantId} AND id = ${missionId} LIMIT 1
  `);
  const m = rows(mres)[0];
  if (!m) throw new Error(`mission-economics: mission ${missionId} not found for tenant ${tenantId}`);
  // Fail closed: a corrupt rollup must throw, never coerce to $0 (which would
  // OVERSTATE margin — e.g. junk refunds reading as zero).
  const revenue = requireNonNegInt(m.revenue_usd_cents, "revenue_usd_cents", missionId);
  const refunds = requireNonNegInt(m.refunds_usd_cents, "refunds_usd_cents", missionId);
  const spend = requireNonNegInt(m.spend_usd_cents, "spend_usd_cents", missionId);
  const [fees, apiCost] = await Promise.all([
    sumPaymentFeesUsdCents(tenantId, missionId),
    sumVariableApiCostUsdCents(tenantId, missionId),
  ]);
  const contribution = computeContributionMarginUsdCents({
    revenueUsdCents: revenue,
    refundsUsdCents: refunds,
    spendUsdCents: spend,
    paymentFeesUsdCents: fees,
    variableApiCostUsdCents: apiCost,
  });
  if (contribution == null) throw new Error(`mission-economics: contribution margin uncomputable for mission ${missionId} (fail closed)`);
  return {
    revenueUsdCents: revenue,
    refundsUsdCents: refunds,
    spendUsdCents: spend,
    paymentFeesUsdCents: fees,
    variableApiCostUsdCents: apiCost,
    realizedMarginUsdCents: revenue - refunds - spend,
    contributionMarginUsdCents: contribution,
  };
}

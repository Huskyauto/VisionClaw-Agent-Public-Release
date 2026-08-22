// ─────────────────────────────────────────────────────────────────────────────
// Venture Discovery Loop — daily HARD cost cap (2026-06-17).
//
// Mirrors the Fusion second-opinion atomic reserve-then-settle pattern
// (server/second-opinion.ts): each spending stage reserves an estimate row under
// a per-tenant advisory xact lock BEFORE the paid call (so concurrent runs can't
// all pass a stale read and overshoot the HARD cap), then settles that same row
// in place to the real cost. Fails CLOSED on any reserve/ledger error (can't
// prove we're under cap ⇒ don't spend) unless VENTURE_BUDGET_FAILOPEN=true.
//
// OWNER-ONLY by default: the cap resolves to >0 only for the owner tenant. Any
// other tenant gets cap 0 ⇒ no live spend ever (dry-run still works for all).
// The whole loop defaults to dry-run; this cap only governs the live path.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../db";
import { sql } from "drizzle-orm";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { logSilentCatch } from "../lib/silent-catch";

export const VENTURE_TOOL_NAME = "venture_discovery";
const VENTURE_LEDGER_PREFIX = "venture_discovery"; // ledger tool_name LIKE 'venture_discovery%'

export const VENTURE_DAILY_BUDGET_USD = (() => {
  const n = parseFloat(process.env.VENTURE_DISCOVERY_DAILY_BUDGET_USD || "");
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

// Deterministic per-call estimate for one live stage. Conservative upper bound:
// a discovery/persona stage is a single structured completion. Override via
// VENTURE_STAGE_ESTIMATE_USD. Kept pessimistic so under-reserving (the only way
// concurrency breaches the cap) doesn't happen; over-reserving is always safe
// because settle rewrites the row down to the real cost.
export const VENTURE_STAGE_ESTIMATE_USD = (() => {
  const n = parseFloat(process.env.VENTURE_STAGE_ESTIMATE_USD || "");
  return Number.isFinite(n) && n > 0 ? n : 0.5;
})();

/** Owner-only cap: >0 only for the owner tenant; 0 (no live spend) for anyone else. */
export function resolveVentureCapUsd(tenantId: number): number {
  return tenantId === ownerTenantId() ? VENTURE_DAILY_BUDGET_USD : 0;
}

/**
 * Per-call reservation floor: never below the static estimate, and never below
 * the largest REAL cost already observed today (post-drift dynamic floor). Pure
 * + exported so the invariant is unit-testable without a DB round-trip.
 */
export function ventureReserveFloorUsd(estimateUsd: number, maxObservedTodayUsd: number): number {
  const observed = Number.isFinite(maxObservedTodayUsd) && maxObservedTodayUsd > 0 ? maxObservedTodayUsd : 0;
  return Math.max(estimateUsd, observed);
}

export interface VentureReservation {
  ok: boolean;
  reservationId?: number;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  degraded: boolean;
}

/** Injectable atomic reservation primitive (tests substitute a query-free fake). */
export interface VentureReserveDeps {
  reserve?: (args: {
    tenantId: number;
    estimateUsd: number;
    capUsd: number;
    operation: string;
  }) => Promise<{ ok: boolean; reservationId?: number; spentUsd: number }>;
}

async function defaultReserve(args: {
  tenantId: number;
  estimateUsd: number;
  capUsd: number;
  operation: string;
}): Promise<{ ok: boolean; reservationId?: number; spentUsd: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('venture-discovery-claim'), ${args.tenantId})`);
    const r: any = await tx.execute(sql`
      SELECT COALESCE(SUM(cost_usd::numeric), 0)::float AS total,
             COALESCE(MAX(cost_usd::numeric) FILTER (WHERE operation NOT LIKE '%:reserved'), 0)::float AS max_settled
      FROM agent_cost_ledger
      WHERE tenant_id = ${args.tenantId}
        AND created_at >= date_trunc('day', now())
        AND tool_name LIKE ${VENTURE_LEDGER_PREFIX + "%"}
    `);
    const rows = r.rows || r;
    const spentUsd = parseFloat(rows?.[0]?.total ?? 0) || 0;
    const maxSettledUsd = parseFloat(rows?.[0]?.max_settled ?? 0) || 0;
    const effectiveEstimate = ventureReserveFloorUsd(args.estimateUsd, maxSettledUsd);
    if (spentUsd + effectiveEstimate > args.capUsd) {
      return { ok: false, spentUsd };
    }
    const ins: any = await tx.execute(sql`
      INSERT INTO agent_cost_ledger (tenant_id, tool_name, model, cost_usd, tokens_in, tokens_out, operation, created_at)
      VALUES (${args.tenantId}, ${VENTURE_TOOL_NAME}, ${"venture-discovery"}, ${effectiveEstimate.toFixed(6)}, 0, 0, ${`${args.operation}:reserved`}, now())
      RETURNING id
    `);
    const insRows = ins.rows || ins;
    const reservationId = Number(insRows?.[0]?.id) || undefined;
    return { ok: true, reservationId, spentUsd };
  });
}

/**
 * Atomically RESERVE budget BEFORE a paid stage. Fails CLOSED on any txn/ledger
 * error (can't prove we're under cap) unless VENTURE_BUDGET_FAILOPEN=true.
 */
export async function reserveVentureBudget(
  tenantId: number,
  estimateUsd: number,
  operation: string,
  deps: VentureReserveDeps = {},
): Promise<VentureReservation> {
  const capUsd = resolveVentureCapUsd(tenantId);
  if (capUsd <= 0) {
    return { ok: false, spentUsd: 0, capUsd, remainingUsd: 0, degraded: false };
  }
  const reserve = deps.reserve ?? defaultReserve;
  try {
    const res = await reserve({ tenantId, estimateUsd, capUsd, operation });
    if (!res.ok) {
      return { ok: false, spentUsd: res.spentUsd, capUsd, remainingUsd: Math.max(0, capUsd - res.spentUsd), degraded: false };
    }
    return {
      ok: true,
      reservationId: res.reservationId,
      spentUsd: res.spentUsd,
      capUsd,
      remainingUsd: Math.max(0, capUsd - res.spentUsd - estimateUsd),
      degraded: false,
    };
  } catch (err) {
    logSilentCatch("server/venture-discovery/budget.ts", err);
    const failOpen = (process.env.VENTURE_BUDGET_FAILOPEN || "").trim().toLowerCase() === "true";
    console.warn(
      `[venture-discovery] budget reserve FAILED — failing ${failOpen ? "OPEN (VENTURE_BUDGET_FAILOPEN)" : "CLOSED (hard ceiling)"}: ${(err as Error)?.message || err}`,
    );
    return { ok: failOpen, spentUsd: 0, capUsd, remainingUsd: failOpen ? capUsd : 0, degraded: true };
  }
}

/** Settle a reservation row in place to the REAL spend (best-effort; never throws). */
export async function settleVentureReservation(
  reservationId: number | undefined,
  costUsd: number,
  tokensIn: number,
  tokensOut: number,
  operation: string,
): Promise<void> {
  if (!reservationId) return;
  try {
    await db.execute(sql`
      UPDATE agent_cost_ledger
      SET cost_usd = ${costUsd.toFixed(6)}, tokens_in = ${tokensIn}, tokens_out = ${tokensOut}, operation = ${operation}
      WHERE id = ${reservationId}
    `);
  } catch (err) {
    logSilentCatch("server/venture-discovery/budget.ts", err);
  }
}

/** Release a reservation a stage never actually spent (cost → 0). Best-effort; never throws. */
export async function releaseVentureReservation(reservationId: number | undefined): Promise<void> {
  if (!reservationId) return;
  try {
    await db.execute(sql`
      UPDATE agent_cost_ledger
      SET cost_usd = '0', operation = 'venture_discovery:released'
      WHERE id = ${reservationId}
    `);
  } catch (err) {
    logSilentCatch("server/venture-discovery/budget.ts", err);
  }
}

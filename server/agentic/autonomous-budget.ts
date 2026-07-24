import { db } from "../db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "../lib/silent-catch";

// ─────────────────────────────────────────────────────────────────────────────
// Autonomous-spend governor
//
// A cheap, no-LLM guard that background/autonomous loops (escalation resolver,
// jury drainer, CI self-healer, nightly optimizers, weekly render, etc.) call to
// refuse a new run once the day's autonomous AI spend has crossed a configurable
// cap. Two entry points:
//   - checkBudget()  — read-only ledger check; use for mid-run re-checks where a
//                      reservation would double-count.
//   - claimAutonomousBudget() — atomic claim-before-spend; RESERVES an estimate
//                      under a per-tenant advisory lock so concurrent loops can't
//                      both read "under budget" and both spend (TOCTOU).
// Both MUST be called AT THE FIRST POINT PAID WORK IS CERTAIN — i.e. AFTER the
// loop's empty-backlog / no-op / preflight-blocked early returns, never at the
// top of the run (a top-of-run claim orphans a reservation on every no-op tick).
//
// Design invariants:
//  - ENFORCEMENT IS BY CALLER, NOT BY A LEDGER COLUMN. Interactive chat never
//    calls this, so the user is NEVER blocked. Only opt-in background loops are.
//    (interactive = fail-open, background = fail-closed — same asymmetry the AHB
//    layer uses.)
//  - FAIL CLOSED, LOUD on a ledger READ failure. This is a HARD ceiling: if we
//    cannot PROVE we are under budget we must not spend. (A full DB outage already
//    halts the resolver at its fetch step, so the realistic case is a narrow
//    cost-ledger read blip — block it.) An operator who would rather keep autonomy
//    running through a ledger outage sets AUTONOMOUS_BUDGET_FAILOPEN=true; that path
//    is loud + flagged degraded so it is never silent.
//  - Tenant-scoped. The cap is on today's TOTAL tenant AI spend (interactive +
//    background) — so background loops yield headroom to live user work.
//  - OWNER-ONLY ECONOMICS (Bob 2026-06-09). The default daily budget is the
//    OWNER's own wallet. Autonomous loops must NEVER run up the owner's bill on
//    behalf of some other tenant. So: the owner tenant gets the default cap; ANY
//    other tenant gets $0 (blocked) UNLESS it has an explicitly-provisioned paid
//    budget in AUTONOMOUS_TENANT_BUDGETS_USD. A paying customer brings their own
//    budget; an unpaid tenant simply doesn't get autonomous spend.
//  - Pure-ish + fully injectable for query-free unit tests (pool-hang lesson).
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_DAILY_BUDGET_USD = 25;

export interface BudgetCheckResult {
  /** true ⇒ within budget, the caller may proceed. */
  ok: boolean;
  /** today's tenant-scoped autonomous spend in USD. */
  spentUsd: number;
  /** the cap in effect for this check. */
  capUsd: number;
  /** capUsd - spentUsd (may be negative when over). */
  remainingUsd: number;
  /** true ⇒ the ledger read failed and we failed OPEN (advisory only). */
  degraded: boolean;
  reason: string;
}

export interface BudgetDeps {
  /** Override the spend lookup (tests inject a fake; never touches the db). */
  getSpendToday?: (tenantId: number) => Promise<number>;
  log?: (msg: string) => void;
}

/** The owner's tenant id (their own wallet). Defaults to 1. */
export function ownerTenantId(): number {
  const n = parseInt(process.env.OWNER_TENANT_ID || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * A per-tenant provisioned budget from AUTONOMOUS_TENANT_BUDGETS_USD — a JSON map
 * of tenantId→USD/day, e.g. {"7":10,"42":50}. This is how a PAYING tenant brings
 * their own budget. Returns undefined when no entry exists (so the caller falls
 * back to owner-vs-other logic); an explicit 0 IS honored (a tenant capped to
 * nothing). Malformed env never silently grants budget.
 */
function tenantBudgetOverrideUsd(tenantId: number): number | undefined {
  const raw = process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw);
    const v = parseFloat(String(map?.[String(tenantId)]));
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the effective daily cap for a tenant. Precedence:
 *   1. explicit caller cap (tests / a deliberate per-run override), must be > 0.
 *   2. a provisioned per-tenant budget (AUTONOMOUS_TENANT_BUDGETS_USD) — a paying
 *      customer's own budget, honored exactly (incl. an explicit 0).
 *   3. the OWNER tenant → AUTONOMOUS_DAILY_BUDGET_USD env, else the built-in
 *      default. A non-positive / unparseable env falls through to the default so a
 *      typo can never accidentally $0-block the owner.
 *   4. ANY OTHER tenant with no provisioned budget → $0. Autonomous loops never
 *      spend the owner's money on an unpaid tenant.
 */
export function resolveDailyCapUsd(tenantId: number, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;

  const override = tenantBudgetOverrideUsd(tenantId);
  if (override !== undefined) return override;

  if (tenantId === ownerTenantId()) {
    const env = parseFloat(process.env.AUTONOMOUS_DAILY_BUDGET_USD || "");
    if (Number.isFinite(env) && env > 0) return env;
    return DEFAULT_DAILY_BUDGET_USD;
  }

  return 0;
}

/** Sum today's (local-day) autonomous AI spend for one tenant from the cost ledger. */
async function defaultGetSpendToday(tenantId: number): Promise<number> {
  const r: any = await db.execute(sql`
    SELECT COALESCE(SUM(cost_usd::numeric), 0)::float AS total
    FROM agent_cost_ledger
    WHERE tenant_id = ${tenantId}
      AND created_at >= date_trunc('day', now())
  `);
  const rows = r.rows || r;
  return parseFloat(rows?.[0]?.total ?? 0) || 0;
}

/**
 * Check whether an autonomous loop is allowed to spend right now.
 * Returns ok:false when today's spend has met-or-exceeded the cap, when the
 * tenant has no provisioned budget, OR (by default) when the ledger read fails
 * — an unprovable spend fails CLOSED (hard ceiling). Operators can opt into
 * fail-open with AUTONOMOUS_BUDGET_FAILOPEN=true (loud; ok:true + degraded:true).
 */
export async function checkAutonomousBudget(
  opts: { tenantId: number; capUsd?: number; label?: string },
  deps: BudgetDeps = {},
): Promise<BudgetCheckResult> {
  const capUsd = resolveDailyCapUsd(opts.tenantId, opts.capUsd);
  const getSpendToday = deps.getSpendToday ?? defaultGetSpendToday;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const label = opts.label ?? "autonomous";

  // Owner-only economics: a tenant with no provisioned budget (cap $0) is blocked
  // outright — no ledger read needed, and the reason is distinct from a real
  // cap-exceeded so logs/telemetry don't conflate "you spent your $25" with
  // "you were never granted a budget".
  if (capUsd <= 0) {
    log(
      `[autonomous-budget] ${label}: BLOCKED — tenant ${opts.tenantId} has no provisioned autonomous budget (cap $0). Grant one via AUTONOMOUS_TENANT_BUDGETS_USD.`,
    );
    return { ok: false, spentUsd: 0, capUsd, remainingUsd: 0, degraded: false, reason: "no-budget-provisioned" };
  }

  let spentUsd = 0;
  try {
    spentUsd = await getSpendToday(opts.tenantId);
  } catch (err) {
    logSilentCatch("server/agentic/autonomous-budget.ts", err);
    // HARD ceiling: a ledger read we can't complete means we can't prove we're
    // under budget, so fail CLOSED. Operators can opt into fail-open (loud).
    const failOpen = process.env.AUTONOMOUS_BUDGET_FAILOPEN === "true";
    log(
      `[autonomous-budget] ${label}: ledger read FAILED — failing ${failOpen ? "OPEN (AUTONOMOUS_BUDGET_FAILOPEN override)" : "CLOSED (hard ceiling)"}. ${(err as Error)?.message || err}`,
    );
    return {
      ok: failOpen,
      spentUsd: 0,
      capUsd,
      remainingUsd: failOpen ? capUsd : 0,
      degraded: true,
      reason: failOpen ? "ledger-read-failed-fail-open-override" : "ledger-read-failed-fail-closed",
    };
  }

  const remainingUsd = capUsd - spentUsd;
  if (spentUsd >= capUsd) {
    log(
      `[autonomous-budget] ${label}: BLOCKED — today's autonomous spend $${spentUsd.toFixed(2)} >= cap $${capUsd.toFixed(2)}`,
    );
    return { ok: false, spentUsd, capUsd, remainingUsd, degraded: false, reason: "daily-cap-exceeded" };
  }

  return { ok: true, spentUsd, capUsd, remainingUsd, degraded: false, reason: "within-budget" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic claim-before-spend
//
// checkAutonomousBudget above is a READ gate: two autonomous loops starting near
// the cap can BOTH read "under budget" and BOTH proceed, overrunning the cap (the
// real spend only lands in agent_cost_ledger later, so neither sees the other in
// flight). claimAutonomousBudget closes that race: it atomically RESERVES an
// estimated cost against the cap before any paid work, under a per-tenant advisory
// lock so concurrent claimants serialize. A claim that would push
// (today's ledger spend + outstanding claims-in-window + this estimate) over the
// cap is refused — the loser defers instead of double-spending.
//
// Claims are short-lived reservations, NOT a second ledger: only claims newer than
// the TTL window count, and expired claims are swept on each call. Once a run's
// real cost is recorded in agent_cost_ledger the claim ages out, so we never
// permanently double-count (estimate AND real spend). The estimate is a coarse
// upper bound on a run's spend — its only job is to keep concurrent runs from
// overrunning, not to be an accurate forecast.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimResult extends BudgetCheckResult {
  /** the row id of the granted reservation (only set when ok && a real claim was written). */
  claimId?: number;
  /** the estimate reserved by THIS claim (0 when refused). */
  claimedUsd: number;
}

export interface ClaimDeps {
  /**
   * Override the atomic claim (tests inject a fake; never touches the db).
   * Returns the post-claim spend snapshot + whether the reservation was granted.
   */
  claim?: (args: {
    tenantId: number;
    estimatedUsd: number;
    capUsd: number;
    ttlMinutes: number;
    label: string;
  }) => Promise<{ ok: boolean; spentUsd: number; claimedUsd: number; claimId?: number }>;
  log?: (msg: string) => void;
}

/** How long a reservation counts toward the cap before the real ledger spend takes over. */
export function claimTtlMinutes(): number {
  const n = parseInt(process.env.AUTONOMOUS_CLAIM_TTL_MINUTES || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Atomic default claim: serialize per-tenant on an advisory lock, sum today's
 * ledger spend + outstanding (in-window) claims, and INSERT a reservation only if
 * spend + claims + estimate stays within cap. Expired claims are swept first so
 * the table stays small and never double-counts settled spend. Returns the granted
 * claim id, or ok:false when the reservation would breach the cap.
 */
async function defaultClaim(args: {
  tenantId: number;
  estimatedUsd: number;
  capUsd: number;
  ttlMinutes: number;
  label: string;
}): Promise<{ ok: boolean; spentUsd: number; claimedUsd: number; claimId?: number }> {
  return db.transaction(async (tx) => {
    // Serialize concurrent claimants for this tenant. pg_advisory_xact_lock is
    // released automatically when the transaction commits/rolls back.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('autonomous-budget-claim'), ${args.tenantId})`);

    // Sweep expired reservations (best-effort housekeeping inside the same lock).
    await tx.execute(sql`
      DELETE FROM autonomous_budget_claims
      WHERE tenant_id = ${args.tenantId}
        AND created_at < now() - (${args.ttlMinutes} * interval '1 minute')
    `);

    const r: any = await tx.execute(sql`
      SELECT
        COALESCE((
          SELECT SUM(cost_usd::numeric) FROM agent_cost_ledger
          WHERE tenant_id = ${args.tenantId} AND created_at >= date_trunc('day', now())
        ), 0)::float AS spent,
        COALESCE((
          SELECT SUM(estimated_usd) FROM autonomous_budget_claims
          WHERE tenant_id = ${args.tenantId}
            AND created_at >= now() - (${args.ttlMinutes} * interval '1 minute')
        ), 0)::float AS claimed
    `);
    const rows = r.rows || r;
    const spent = parseFloat(rows?.[0]?.spent ?? 0) || 0;
    const claimed = parseFloat(rows?.[0]?.claimed ?? 0) || 0;

    if (spent + claimed + args.estimatedUsd > args.capUsd) {
      return { ok: false, spentUsd: spent, claimedUsd: claimed };
    }

    const ins: any = await tx.execute(sql`
      INSERT INTO autonomous_budget_claims (tenant_id, label, estimated_usd, created_at)
      VALUES (${args.tenantId}, ${args.label}, ${args.estimatedUsd}, now())
      RETURNING id
    `);
    const insRows = ins.rows || ins;
    const claimId = insRows?.[0]?.id;
    return { ok: true, spentUsd: spent, claimedUsd: args.estimatedUsd, claimId };
  });
}

/**
 * Reserve autonomous budget atomically before spending. Returns ok:true with a
 * claimId once a reservation is granted; ok:false when no budget is provisioned,
 * the reservation would breach the cap, or (by default) the claim transaction
 * fails — an unprovable claim fails CLOSED (hard ceiling), with the same
 * AUTONOMOUS_BUDGET_FAILOPEN opt-out as checkAutonomousBudget.
 */
export async function claimAutonomousBudget(
  opts: { tenantId: number; estimatedUsd?: number; capUsd?: number; label?: string; ttlMinutes?: number },
  deps: ClaimDeps = {},
): Promise<ClaimResult> {
  const capUsd = resolveDailyCapUsd(opts.tenantId, opts.capUsd);
  const log = deps.log ?? ((m: string) => console.warn(m));
  const label = opts.label ?? "autonomous";
  const claim = deps.claim ?? defaultClaim;
  const ttlMinutes = opts.ttlMinutes ?? claimTtlMinutes();
  // Coarse default per-run reservation. Callers pass a real estimate; the floor
  // keeps a zero/negative estimate from being a no-op reservation.
  const estimatedUsd = Math.max(0.01, Number(opts.estimatedUsd) || 1);

  if (capUsd <= 0) {
    log(
      `[autonomous-budget] ${label}: BLOCKED — tenant ${opts.tenantId} has no provisioned autonomous budget (cap $0). Grant one via AUTONOMOUS_TENANT_BUDGETS_USD.`,
    );
    return { ok: false, spentUsd: 0, capUsd, remainingUsd: 0, degraded: false, reason: "no-budget-provisioned", claimedUsd: 0 };
  }

  let res: { ok: boolean; spentUsd: number; claimedUsd: number; claimId?: number };
  try {
    res = await claim({ tenantId: opts.tenantId, estimatedUsd, capUsd, ttlMinutes, label });
  } catch (err) {
    logSilentCatch("server/agentic/autonomous-budget.ts", err);
    const failOpen = process.env.AUTONOMOUS_BUDGET_FAILOPEN === "true";
    log(
      `[autonomous-budget] ${label}: claim FAILED — failing ${failOpen ? "OPEN (AUTONOMOUS_BUDGET_FAILOPEN override)" : "CLOSED (hard ceiling)"}. ${(err as Error)?.message || err}`,
    );
    return {
      ok: failOpen,
      spentUsd: 0,
      capUsd,
      remainingUsd: failOpen ? capUsd : 0,
      degraded: true,
      reason: failOpen ? "claim-failed-fail-open-override" : "claim-failed-fail-closed",
      claimedUsd: 0,
    };
  }

  const remainingUsd = capUsd - res.spentUsd - res.claimedUsd;
  if (!res.ok) {
    log(
      `[autonomous-budget] ${label}: BLOCKED — reservation $${estimatedUsd.toFixed(2)} would breach cap (spent $${res.spentUsd.toFixed(2)} + outstanding claims $${res.claimedUsd.toFixed(2)} / cap $${capUsd.toFixed(2)})`,
    );
    return { ok: false, spentUsd: res.spentUsd, capUsd, remainingUsd, degraded: false, reason: "daily-cap-exceeded", claimedUsd: 0 };
  }

  return {
    ok: true,
    spentUsd: res.spentUsd,
    capUsd,
    remainingUsd,
    degraded: false,
    reason: "claim-granted",
    claimId: res.claimId,
    claimedUsd: res.claimedUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S5c — the autonomy ladder.
// Feature contract: data/feature-contracts/revenue-missions.
//
// Principle (GPT 5.6 review, adopted): "Agents earn greater autonomy with
// verified profit and reliable execution." A mission's autonomy_level bounds
// what the platform may do WITHOUT a fresh human approval. Levels are changed
// ONLY by the owner via the HITL route/admin UI — never by an agent tool.
//
// Deterministic module: no LLM calls. Every check fails CLOSED — an unknown
// action, malformed level, or malformed mission row denies.
//
// | Level | Autonomous authority                                              |
// |   0   | research, score, propose                                          |
// |   1   | create assets / landing pages                                     |
// |   2   | run a small OWNER-APPROVED validation experiment (HITL send)      |
// |   3   | contact prospects within stored caps (still HITL-approved sample) |
// |   4   | on verified payment: auto-kick fulfillment planning (wake Felix)  |
// |   5   | reinvest ≤10% of VERIFIED realized margin into the mission budget |
// |   6   | scale spend / launch new products — ALWAYS human approval (this   |
// |       | level exists only as a labelled ceiling; nothing auto-fires here) |
// ─────────────────────────────────────────────────────────────────────────────

export const AUTONOMY_MIN = 0;
export const AUTONOMY_MAX = 6;

/** Actions the platform may attempt autonomously, mapped to the MINIMUM ladder level. */
export const ACTION_MIN_LEVEL = {
  propose: 0,
  create_assets: 1,
  run_approved_experiment: 2, // still requires approved_by_owner_at — level never bypasses HITL
  contact_prospects: 3, // within stored caps, approved experiment only
  auto_fulfillment_kickoff: 4, // schedule a fulfillment wake on verified payment
  reinvest_realized_margin: 5, // capped reinvestment from verified gross profit
  // scale_spend / launch_new_product deliberately ABSENT: level 6 is
  // human-approval-always; there is no autonomous action to gate.
} as const;
export type AutonomyAction = keyof typeof ACTION_MIN_LEVEL;

/** Parse/clamp an owner-supplied level. Fail closed: junk → null (caller rejects). */
export function parseAutonomyLevel(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const s = String(value).trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isSafeInteger(n) || n < AUTONOMY_MIN || n > AUTONOMY_MAX) return null;
  return n;
}

/**
 * May this mission perform `action` autonomously? Fail CLOSED on every
 * malformed shape: unknown action, non-integer level, killed mission.
 */
export function autonomyAllows(mission: { autonomy_level?: unknown; stage?: unknown } | null | undefined, action: AutonomyAction): boolean {
  if (!mission || typeof mission !== "object") return false;
  const min = ACTION_MIN_LEVEL[action];
  if (min === undefined) return false;
  if (mission.stage === "killed") return false;
  const lvl = mission.autonomy_level;
  if (typeof lvl !== "number" || !Number.isSafeInteger(lvl) || lvl < AUTONOMY_MIN || lvl > AUTONOMY_MAX) return false;
  return lvl >= min;
}

// ── Level-5 reinvestment (pure math, applied atomically by the caller) ──────

export const REINVEST_RULES = {
  /** Fraction of VERIFIED realized margin eligible for reinvestment. */
  fraction: 0.10,
  /** Absolute ceiling on a mission's total budget after reinvestment (USD). */
  maxBudgetUsd: 250,
} as const;

/**
 * Compute the new max_cash_at_risk_usd after a reinvestment event.
 * Realized margin = revenue − refunds − spend (cents), from EVIDENCE-derived
 * rollups only. Returns null when nothing may be reinvested (no verified
 * profit, malformed inputs, or budget already at/above target). Fail closed.
 */
export function computeReinvestment(mission: {
  revenue_usd_cents?: unknown;
  refunds_usd_cents?: unknown;
  spend_usd_cents?: unknown;
  max_cash_at_risk_usd?: unknown;
}): { newBudgetUsd: number; reinvestedUsd: number } | null {
  const toInt = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const revenue = toInt(mission.revenue_usd_cents);
  const refunds = toInt(mission.refunds_usd_cents);
  const spend = toInt(mission.spend_usd_cents);
  const budgetUsd = toInt(mission.max_cash_at_risk_usd);
  if (revenue == null || refunds == null || spend == null || budgetUsd == null) return null;
  const marginCents = revenue - refunds - spend;
  if (marginCents <= 0) return null; // reinvest ONLY from verified realized profit
  const reinvestUsd = Math.floor((marginCents * REINVEST_RULES.fraction) / 100);
  if (reinvestUsd <= 0) return null;
  const target = Math.min(budgetUsd + reinvestUsd, REINVEST_RULES.maxBudgetUsd);
  if (target <= budgetUsd) return null; // already at ceiling
  return { newBudgetUsd: target, reinvestedUsd: target - budgetUsd };
}

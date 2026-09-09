// ─────────────────────────────────────────────────────────────────────────────
// Revenue Missions — hard capital budget guard (Grok 4.5 review item #3,
// 2026-07-25: "budgeted missions with hard capital caps failing closed").
//
// Two halves:
//   1. PRE-SPEND (fail closed): assertMissionBudgetHeadroom refuses any step
//      whose estimated cost cannot be PROVEN to fit inside the mission's
//      cumulative cap (max_cash_at_risk_usd, clamped by the contract hard
//      ceiling). Unreadable spend/cap refuses — never assumes $0.
//   2. POST-SPEND (fail safe): enforceMissionBudgetAfterSpend runs after a
//      spend evidence row lands. Recording is fact-keeping (the money is
//      already gone), so it never blocks the record — but a mission whose
//      cumulative spend has reached its cap is immediately auto-PAUSED
//      (enrollments stopped, live experiments cancelled) and the owner is
//      notified. Pause, never kill — kill remains a HITL owner decision.
//
// Idempotence: the pause stamps a notes marker sharing the SUNSET_MARKER
// prefix, so both this guard and the sunset sweep skip already-paused rows.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import { HARD_CAPS, assertBudgetHeadroom } from "./revenue-missions";
import { SUNSET_MARKER } from "./mission-sunset";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-budget-guard: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Marker stamped on a budget pause (shares the sunset prefix so both sweeps skip it). */
export const BUDGET_MARKER = `${SUNSET_MARKER} budget`;

/**
 * Pure: the mission's cumulative spend cap in usd cents — the mission row may
 * TIGHTEN the contract hard ceiling but can never raise it. Fail closed on an
 * unreadable budget (null/NaN/negative all yield 0 headroom).
 */
export function missionSpendCapUsdCents(mission: { max_cash_at_risk_usd?: unknown }): number {
  const raw = mission?.max_cash_at_risk_usd;
  // Number(null) === 0 AND clampCap raises non-positive values to the hard
  // ceiling — both go the WRONG direction for a budget. Unreadable/missing
  // budget ⇒ tightest interpretation: no headroom at all.
  if (raw == null) return 0;
  const budgetUsd = Number(raw);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) return 0;
  return Math.min(Math.floor(budgetUsd * 100), HARD_CAPS.maxSpendUsdCents);
}

export interface BudgetBreachDecision {
  breached: boolean;
  spendUsdCents: number;
  capUsdCents: number;
  reason: string;
}

/** Pure: has cumulative spend reached/exceeded the cap? Unreadable spend ⇒ breach (fail safe). */
export function decideBudgetBreach(spendUsdCents: unknown, capUsdCents: number): BudgetBreachDecision {
  const spend = Number(spendUsdCents);
  if (spendUsdCents == null || !Number.isFinite(spend)) {
    return { breached: true, spendUsdCents: NaN, capUsdCents, reason: "mission spend unreadable — treating as breached (fail safe)" };
  }
  if (spend >= capUsdCents) {
    return { breached: true, spendUsdCents: spend, capUsdCents, reason: `cumulative spend ${Math.floor(spend)}c >= cap ${capUsdCents}c` };
  }
  return { breached: false, spendUsdCents: spend, capUsdCents, reason: `headroom ${capUsdCents - Math.floor(spend)}c remaining` };
}

/**
 * Fail-closed pre-spend gate at the MISSION level: refuses when the estimated
 * step cost cannot be proven to fit within the mission's cumulative cap.
 * Callers that spend real money on behalf of a mission MUST call this first.
 */
export async function assertMissionBudgetHeadroom(args: {
  tenantId: number;
  missionId: number;
  estimatedStepCostUsdCents: number;
  stepLabel?: string;
}): Promise<{ remainingUsdCents: number }> {
  assertTenant(args.tenantId);
  const res = await db.execute(sql`
    SELECT max_cash_at_risk_usd, spend_usd_cents FROM revenue_missions
    WHERE tenant_id = ${args.tenantId} AND id = ${args.missionId} LIMIT 1
  `);
  const mission = rows(res)[0];
  if (!mission) throw new Error(`mission ${args.missionId} not found for tenant ${args.tenantId} (budget gate, fail closed)`);
  return assertBudgetHeadroom({
    spendSoFarUsdCents: mission.spend_usd_cents,
    spendCapUsdCents: missionSpendCapUsdCents(mission),
    estimatedStepCostUsdCents: args.estimatedStepCostUsdCents,
    stepLabel: args.stepLabel ?? "mission spend",
  });
}

/**
 * Post-spend enforcement: if the mission's cumulative spend has reached its
 * cap, auto-pause enrollments/experiments and notify the owner. Idempotent
 * (marker-stamped) and best-effort — a failure here is logged loud but never
 * unwinds the already-recorded evidence row.
 */
export async function enforceMissionBudgetAfterSpend(tenantId: number, missionId: number): Promise<{
  breached: boolean;
  paused: boolean;
}> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT id, name, notes, max_cash_at_risk_usd, spend_usd_cents, stage
    FROM revenue_missions
    WHERE tenant_id = ${tenantId} AND id = ${missionId} LIMIT 1
  `);
  const mission = rows(res)[0];
  if (!mission) return { breached: false, paused: false };
  const decision = decideBudgetBreach(mission.spend_usd_cents, missionSpendCapUsdCents(mission));
  if (!decision.breached) return { breached: false, paused: false };
  // Already paused by this guard or the sunset sweep — skip (idempotent).
  if (String(mission.notes || "").includes(SUNSET_MARKER)) return { breached: true, paused: false };

  const { pauseMissionEnrollments } = await import("./mission-experiment-run");
  const paused = await pauseMissionEnrollments(tenantId, missionId);
  const stamp = `${BUDGET_MARKER} ${new Date().toISOString().slice(0, 10)}: paused — ${decision.reason}. Raise max_cash_at_risk_usd or kill/resume is the owner's call.]`;
  await db.execute(sql`
    UPDATE revenue_missions
    SET notes = COALESCE(notes || E'\n', '') || ${stamp}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND id = ${missionId}
      AND COALESCE(notes, '') NOT LIKE ${"%" + SUNSET_MARKER + "%"}
  `);
  // Best-effort owner notification — never blocks the pause.
  try {
    const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
    if (ownerEmail) {
      const { ADMIN_TENANT_ID } = await import("../tenant-constants");
      const { getOrCreateTenantInbox, sendEmail } = await import("../email");
      const inboxResult = await getOrCreateTenantInbox(ADMIN_TENANT_ID);
      const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
      await sendEmail({
        inboxId,
        to: ownerEmail,
        subject: `[VisionClaw] Revenue Mission #${missionId} auto-paused (budget cap reached)`,
        text: [
          `Mission "${mission.name}" (#${missionId}) hit its hard capital cap.`,
          decision.reason,
          `Stopped ${paused.stoppedEnrollments} enrollment(s), cancelled ${paused.cancelledExperiments} experiment(s).`,
          `Pause is reversible — raising max_cash_at_risk_usd or killing the mission is your call.`,
        ].join("\n"),
      });
    }
  } catch (e) {
    console.warn("[mission-budget-guard] owner notify failed (pause already applied):", (e as any)?.message ?? e);
  }
  console.warn(`[mission-budget-guard] mission ${missionId} (tenant ${tenantId}) budget breached — paused. ${decision.reason}`);
  return { breached: true, paused: true };
}

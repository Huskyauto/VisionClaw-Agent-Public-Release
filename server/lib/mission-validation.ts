// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S7a — pre-launch validation gate.
// Feature contract: data/feature-contracts/revenue-missions.
//
// DeepSeek review gap #1 (3rd independent review to flag validate-before-
// spend): no experiment may be drafted until the mission carries a persisted
// validation score above threshold. DETERMINISTIC, $0, no LLM — the score is
// a preflight computed from the mission packet itself + evidence rollups +
// capital-pool headroom, never model output. The gate FAILS CLOSED: a missing
// or unreadable validation refuses the draft.
//
// This is deliberately a GATE, unlike the retrospective (record-only ledger):
// the retrospective advises after the fact; validation blocks before spend.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-validation: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Minimum validation score required before an experiment can be drafted. */
export const VALIDATION_LAUNCH_THRESHOLD = 70;

export interface MissionValidation {
  version: 1;
  generatedAt: string;
  /** 0–100 deterministic preflight score. */
  score: number;
  passed: boolean;
  checks: Array<{ name: string; points: number; max: number; note: string }>;
}

/**
 * Deterministic 0–100 preflight validation of a mission row. Pure — exported
 * for query-free tests.
 *
 *  - packet completeness (40): hypothesis, ideal_customer, offer, pain
 *    statement, success + kill criteria each carry points — a mission that
 *    can't articulate its kill criteria is not launch-ready;
 *  - economics sanity (30): a concrete price, and cash-at-risk within the
 *    capital-pool risk ceiling when a pool is seeded (poolCeiling null =
 *    unseeded pool = default hard-cap regime, full points);
 *  - demand evidence (30): prior evidence rows recorded for this mission
 *    (contacts/replies from an evidence_gathering stage) scale up to full
 *    points at 3+ items; zero evidence still passes packet-strong missions.
 */
export function validateMission(
  mission: any,
  opts?: { evidenceCount?: number; poolRiskCeilingUsdCents?: number | null },
): MissionValidation {
  const checks: MissionValidation["checks"] = [];
  const has = (v: unknown) => typeof v === "string" && v.trim().length >= 10;

  // Packet completeness — 40.
  let packet = 0;
  const fields: Array<[string, unknown, number]> = [
    ["hypothesis", mission?.hypothesis, 8],
    ["ideal_customer", mission?.ideal_customer, 8],
    ["offer", mission?.offer, 8],
    ["pain_statement", mission?.pain_statement, 4],
    ["success_criteria", mission?.success_criteria, 6],
    ["kill_criteria", mission?.kill_criteria, 6],
  ];
  const missing: string[] = [];
  for (const [name, v, pts] of fields) {
    if (has(v)) packet += pts;
    else missing.push(name);
  }
  checks.push({ name: "packet_completeness", points: packet, max: 40, note: missing.length ? `thin/missing: ${missing.join(", ")}` : "all packet fields substantive" });

  // Economics sanity — 30.
  let econ = 0;
  const price = Number(mission?.price_usd);
  if (Number.isFinite(price) && price > 0) econ += 15;
  const riskUsd = Math.max(0, Number(mission?.max_cash_at_risk_usd) || 0);
  const ceiling = opts?.poolRiskCeilingUsdCents;
  let econNote: string;
  if (ceiling == null) {
    econ += 15; // unseeded pool — hard-cap regime applies, no pool constraint
    econNote = price > 0 ? "price set; pool unseeded (hard-cap regime)" : "no concrete price; pool unseeded";
  } else if (riskUsd * 100 <= ceiling) {
    econ += 15;
    econNote = `price ${price > 0 ? "set" : "missing"}; cash-at-risk within pool ceiling (${ceiling} cents)`;
  } else {
    econNote = `cash-at-risk ${riskUsd * 100} cents exceeds pool risk ceiling ${ceiling} cents (25% of balance)`;
  }
  checks.push({ name: "economics_sanity", points: econ, max: 30, note: econNote });

  // Demand evidence — 30.
  const evidenceCount = Math.max(0, Math.floor(Number(opts?.evidenceCount) || 0));
  const demand = Math.min(30, evidenceCount * 10);
  checks.push({ name: "demand_evidence", points: demand, max: 30, note: `${evidenceCount} evidence rows recorded pre-launch` });

  const score = Math.max(0, Math.min(100, packet + econ + demand));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    score,
    passed: score >= VALIDATION_LAUNCH_THRESHOLD,
    checks,
  };
}

/**
 * Compute + persist the validation for one mission (re-runnable: each call
 * overwrites — validation reflects the CURRENT packet, unlike the immutable
 * retrospective). Returns the stored validation.
 */
export async function recordValidation(tenantId: number, missionId: number): Promise<MissionValidation | null> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM revenue_missions WHERE tenant_id = ${tenantId} AND id = ${missionId} LIMIT 1
  `);
  const mission = rows(res)[0];
  if (!mission) return null;
  const evRes = await db.execute(sql`
    SELECT count(*)::int AS n FROM mission_evidence
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
  `);
  const evidenceCount = Number(rows(evRes)[0]?.n) || 0;
  const { poolRiskCeilingUsdCents } = await import("./agent-capital");
  const ceiling = await poolRiskCeilingUsdCents(tenantId);
  const v = validateMission(mission, { evidenceCount, poolRiskCeilingUsdCents: ceiling });
  await db.execute(sql`
    UPDATE revenue_missions
    SET validation = ${JSON.stringify(v)}::jsonb,
        validation_score = ${v.score},
        validation_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND id = ${missionId}
  `);
  return v;
}

/**
 * Fail-closed launch gate: throws unless the mission carries a validation at
 * or above threshold. Called by createExperimentDraft BEFORE any insert.
 * A stale/missing validation is recomputed once (deterministic + $0, so a
 * fresh preflight is always safe) — but an under-threshold score REFUSES.
 */
export async function assertMissionValidated(tenantId: number, missionId: number): Promise<MissionValidation> {
  assertTenant(tenantId);
  const v = await recordValidation(tenantId, missionId);
  if (!v) throw new Error(`mission ${missionId} not found for tenant ${tenantId} (validation gate, fail closed)`);
  if (!v.passed) {
    const weak = v.checks.filter((c) => c.points < c.max).map((c) => `${c.name}: ${c.note}`).join(" | ");
    throw new Error(
      `validation gate: mission ${missionId} scored ${v.score} < ${VALIDATION_LAUNCH_THRESHOLD} — refusing experiment draft (fail closed). Weak checks: ${weak}`,
    );
  }
  return v;
}

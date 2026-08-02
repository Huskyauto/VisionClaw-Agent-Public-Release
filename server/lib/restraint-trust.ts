// R98.24 — MNEMA Nugget 2: two-channel reputation tensor.
//
// MNEMA (Smith, Gentic Lab, EUMAS 2026) Property 2: a witness firing often on
// weak evidence has its action-channel beta-posterior decay (anti-spam); a
// witness that declines when it should have fired has its restraint-channel
// beta-posterior decay (anti-hiding). Trust = min(actionPrecision,
// restraintPrecision) penalises BOTH pathologies — neither over-eagerness nor
// over-caution can game the score.
//
// Today our trust_scores table tracks only the action channel (0-100 integer).
// This module adds the restraint channel as Bayesian Beta(α,β) posteriors for
// both channels. Updates are simple count increments:
//   - confirmed action ok    → α_action += 1
//   - confirmed action wrong → β_action += 1
//   - confirmed decline ok   → α_restraint += 1     (correctly held back)
//   - confirmed decline wrong → β_restraint += 1    (should have acted but didn't)
//
// Effective trust returned from `effectiveTrust()` is min of the two channel
// means — exactly the formula in the paper (Definition 11).

import { db } from "../db";
import { sql } from "drizzle-orm";

export type ReputationOutcome =
  | "action_ok"        // fired, downstream confirmed it was the right call
  | "action_wrong"     // fired, downstream said it shouldn't have
  | "restraint_ok"     // declined, downstream confirmed it was the right call
  | "restraint_wrong"; // declined, downstream said it should have acted

export interface ChannelPrecision {
  action: number;     // mean of Beta(α_action, β_action)
  restraint: number;  // mean of Beta(α_restraint, β_restraint)
  effective: number;  // min(action, restraint) — the headline number
  actionAlpha: number;
  actionBeta: number;
  restraintAlpha: number;
  restraintBeta: number;
}

const COLUMN_BY_OUTCOME: Record<ReputationOutcome, string> = {
  action_ok: "action_alpha",
  action_wrong: "action_beta",
  restraint_ok: "restraint_alpha",
  restraint_wrong: "restraint_beta",
};

/**
 * Increment the appropriate Beta-posterior counter for a (persona, category).
 * Fails CLOSED on bad input — silently logging garbage outcomes would corrupt
 * the trust signal and we'd never notice.
 */
export async function recordReputationOutcome(opts: {
  tenantId: number;
  personaId: number;
  category: string;
  outcome: ReputationOutcome;
  delta?: number; // default 1; allow weighted updates if caller has a confidence score
}): Promise<{ ok: boolean; error?: string }> {
  const { tenantId, personaId, category, outcome, delta = 1 } = opts;
  if (!tenantId) return { ok: false, error: "tenantId required" };
  if (!personaId) return { ok: false, error: "personaId required" };
  if (!category || typeof category !== "string") return { ok: false, error: "category required" };
  if (!(outcome in COLUMN_BY_OUTCOME)) return { ok: false, error: `unknown outcome: ${outcome}` };
  if (!Number.isFinite(delta) || delta <= 0 || delta > 100) {
    return { ok: false, error: "delta must be finite, > 0, and <= 100" };
  }
  const column = COLUMN_BY_OUTCOME[outcome];
  // Whitelist column name (it came from a hardcoded record above, but defense
  // in depth: tag the dynamic identifier through sql.identifier-style raw
  // only after explicit allowlist check).
  if (!["action_alpha", "action_beta", "restraint_alpha", "restraint_beta"].includes(column)) {
    return { ok: false, error: "internal: column allowlist mismatch" };
  }
  try {
    // Upsert pattern: ensure the row exists with default Beta(1,1), then bump.
    // We do it as two statements rather than ON CONFLICT because the dynamic
    // column name complicates the conflict update clause and this path runs
    // off the request hot path (called from telemetry/audit hooks).
    await db.execute(sql`
      INSERT INTO trust_scores (tenant_id, persona_id, category, score)
      VALUES (${tenantId}, ${personaId}, ${category}, 50)
      ON CONFLICT DO NOTHING
    `);
    // Dynamic column update — column name is whitelisted above, delta is a
    // validated finite number, so sql.raw is safe here. (M1 in the deferred
    // gaps log: this is one of the call sites that uses semi-trusted runtime
    // values; the validation above is the mitigation.)
    await db.execute(sql`
      UPDATE trust_scores
      SET ${sql.raw(column)} = ${sql.raw(column)} + ${delta},
          updated_at = NOW()
      WHERE tenant_id = ${tenantId}
        AND persona_id = ${personaId}
        AND category = ${category}
    `);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) || "unknown" };
  }
}

/**
 * Compute current channel precisions for a (persona, category). Returns the
 * Beta-mean for each channel plus their min (effective trust).
 *
 * Returns null if no row exists yet (caller should treat as "uniform prior",
 * effective = 0.5).
 */
export async function effectiveTrust(
  tenantId: number,
  personaId: number,
  category: string,
): Promise<ChannelPrecision | null> {
  if (!tenantId || !personaId || !category) return null;
  try {
    const result = await db.execute(sql`
      SELECT action_alpha, action_beta, restraint_alpha, restraint_beta
      FROM trust_scores
      WHERE tenant_id = ${tenantId}
        AND persona_id = ${personaId}
        AND category = ${category}
      LIMIT 1
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const aA = Number(r.action_alpha) || 1;
    const aB = Number(r.action_beta) || 1;
    const rA = Number(r.restraint_alpha) || 1;
    const rB = Number(r.restraint_beta) || 1;
    const action = aA / (aA + aB);
    const restraint = rA / (rA + rB);
    return {
      action,
      restraint,
      effective: Math.min(action, restraint),
      actionAlpha: aA,
      actionBeta: aB,
      restraintAlpha: rA,
      restraintBeta: rB,
    };
  } catch {
    return null;
  }
}

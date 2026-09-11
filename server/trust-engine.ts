import { db } from "./db";
import { sql } from "drizzle-orm";
import { trustScores, type TrustScore } from "@shared/schema";
import { eq, and } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
import { getTrustDelta } from "./auto-tuner";
export type TrustCategory =
  | "external_comms"
  | "content_quality"
  | "code_reliability"
  | "research_accuracy"
  | "financial_accuracy"
  | "legal_soundness"
  | "delegation_efficiency"
  | "tool_compliance"
  | "purpose_adherence";

export type AutonomyLevel = "blocked" | "approve_before" | "notify_after" | "full_auto";

const TRUST_CATEGORIES: Record<number, TrustCategory[]> = {
  2: ["external_comms", "delegation_efficiency", "tool_compliance", "purpose_adherence"],
  3: ["code_reliability", "tool_compliance", "purpose_adherence"],
  4: ["external_comms", "content_quality", "tool_compliance", "purpose_adherence"],
  5: ["tool_compliance", "purpose_adherence"],
  6: ["tool_compliance", "purpose_adherence"],
  7: ["external_comms", "content_quality", "tool_compliance", "purpose_adherence"],
  8: ["tool_compliance", "purpose_adherence"],
  9: ["research_accuracy", "tool_compliance", "purpose_adherence"],
  10: ["research_accuracy", "content_quality", "tool_compliance", "purpose_adherence"],
  11: ["external_comms", "tool_compliance", "purpose_adherence"],
  12: ["financial_accuracy", "tool_compliance", "purpose_adherence"],
  13: ["financial_accuracy", "tool_compliance", "purpose_adherence"],
  14: ["legal_soundness", "tool_compliance", "purpose_adherence"],
};

const STARTING_SCORES: Record<number, Partial<Record<TrustCategory, number>>> = {
  2: { external_comms: 60, delegation_efficiency: 80, tool_compliance: 80, purpose_adherence: 80 },
  3: { code_reliability: 80, tool_compliance: 80, purpose_adherence: 80 },
  4: { external_comms: 40, content_quality: 80, tool_compliance: 80, purpose_adherence: 80 },
  5: { tool_compliance: 80, purpose_adherence: 80 },
  6: { tool_compliance: 80, purpose_adherence: 80 },
  7: { external_comms: 40, content_quality: 80, tool_compliance: 80, purpose_adherence: 80 },
  8: { tool_compliance: 80, purpose_adherence: 80 },
  9: { research_accuracy: 80, tool_compliance: 80, purpose_adherence: 80 },
  10: { research_accuracy: 80, content_quality: 60, tool_compliance: 80, purpose_adherence: 80 },
  11: { external_comms: 80, tool_compliance: 80, purpose_adherence: 80 },
  12: { financial_accuracy: 80, tool_compliance: 80, purpose_adherence: 80 },
  13: { financial_accuracy: 80, tool_compliance: 80, purpose_adherence: 80 },
  14: { legal_soundness: 80, tool_compliance: 80, purpose_adherence: 80 },
};

const NEVER_AUTO_ACTIONS = new Set([
  "payment_action",
  "browser_form_submit",
  "execute_shell_destructive",
  "kill_switch",
  "production_data_delete",
]);

const MAX_SCORE = 95;
const MIN_SCORE = 0;
const UPGRADE_DAYS_REQUIRED = 5;

export function scoreToAutonomyLevel(score: number): AutonomyLevel {
  if (score <= 25) return "blocked";
  if (score <= 50) return "approve_before";
  if (score <= 75) return "notify_after";
  return "full_auto";
}

export function getCategoriesForPersona(personaId: number): TrustCategory[] {
  return TRUST_CATEGORIES[personaId] || ["tool_compliance", "purpose_adherence"];
}

export async function initializeTrustScores(tenantId: number): Promise<void> {
  let repaired = 0;
  for (const [pidStr, categories] of Object.entries(TRUST_CATEGORIES)) {
    const personaId = parseInt(pidStr);
    const startingScores = STARTING_SCORES[personaId] || {};

    for (const category of categories) {
      const existing = await db.execute(sql`
        SELECT id, score FROM trust_scores 
        WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
      `);
      const rows = (existing as any).rows || existing;
      const minScore = startingScores[category] || 50;
      if (rows.length === 0) {
        const level = scoreToAutonomyLevel(minScore);
        await db.execute(sql`
          INSERT INTO trust_scores (tenant_id, persona_id, category, score, autonomy_level)
          VALUES (${tenantId}, ${personaId}, ${category}, ${minScore}, ${level})
        `);
      } else if (rows[0].score < minScore) {
        const level = scoreToAutonomyLevel(minScore);
        await db.execute(sql`
          UPDATE trust_scores SET score = ${minScore}, autonomy_level = ${level},
            last_change_reason = 'startup_floor_repair'
          WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
        `);
        repaired++;
      }
    }
  }
  if (repaired > 0) {
    console.log(`[trust-engine] Trust scores initialized for tenant ${tenantId} (repaired ${repaired} scores below floor)`);
  } else {
    console.log(`[trust-engine] Trust scores initialized for tenant ${tenantId}`);
  }
}

export async function getTrustScore(tenantId: number, personaId: number, category: TrustCategory): Promise<TrustScore | null> {
  const result = await db.execute(sql`
    SELECT * FROM trust_scores 
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
    LIMIT 1
  `);
  const rows = (result as any).rows || result;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getAllTrustScores(tenantId: number, personaId?: number): Promise<TrustScore[]> {
  const result = personaId
    ? await db.execute(sql`SELECT * FROM trust_scores WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} ORDER BY category`)
    : await db.execute(sql`SELECT * FROM trust_scores WHERE tenant_id = ${tenantId} ORDER BY persona_id, category`);
  const rows = (result as any).rows || result;
  return rows.map(mapRow);
}

export type TrustEvent =
  | "task_success"
  | "task_failure"
  | "quality_ship"
  | "quality_minor_edits"
  | "quality_revision"
  | "quality_rewrite"
  | "user_positive"
  | "user_negative"
  | "proactive_success"
  | "proactive_failure"
  | "tool_violation"
  | "purpose_drift"
  | "governance_trigger"
  | "hitl_rejection"
  | "clean_week"
  | "express_lane_success"
  | "security_violation"
  | "pii_exposure"
  | "cascading_failure"
  | "memory_poisoning";

const TRUST_CHANGES: Record<TrustEvent, { amount: number; categories?: TrustCategory[] }> = {
  task_success: { amount: 2 },
  task_failure: { amount: -3 },
  quality_ship: { amount: 3, categories: ["content_quality"] },
  quality_minor_edits: { amount: 1, categories: ["content_quality"] },
  quality_revision: { amount: -5, categories: ["content_quality"] },
  quality_rewrite: { amount: -10, categories: ["content_quality"] },
  user_positive: { amount: 5 },
  user_negative: { amount: -10 },
  proactive_success: { amount: 3, categories: ["purpose_adherence"] },
  proactive_failure: { amount: -5, categories: ["purpose_adherence"] },
  tool_violation: { amount: -5, categories: ["tool_compliance"] },
  purpose_drift: { amount: -8, categories: ["purpose_adherence"] },
  governance_trigger: { amount: -5 },
  hitl_rejection: { amount: -7 },
  clean_week: { amount: 5, categories: ["tool_compliance", "purpose_adherence"] },
  express_lane_success: { amount: 2, categories: ["tool_compliance"] },
  security_violation: { amount: -100 },
  pii_exposure: { amount: -100, categories: ["external_comms"] },
  cascading_failure: { amount: -20, categories: ["tool_compliance"] },
  memory_poisoning: { amount: -100 },
};

function getEffectiveDelta(event: TrustEvent): { amount: number; categories?: TrustCategory[] } {
  const base = TRUST_CHANGES[event];
  if (!base) return { amount: 0 };
  try {
    const tuned = getTrustDelta(event);
    if (tuned !== 0) return { ...base, amount: tuned };
  } catch (_silentErr) { logSilentCatch("server/trust-engine.ts", _silentErr); }
  return base;
}

export async function recordTrustEvent(
  tenantId: number,
  personaId: number,
  event: TrustEvent,
  reason?: string
): Promise<{ category: string; oldScore: number; newScore: number; oldLevel: AutonomyLevel; newLevel: AutonomyLevel }[]> {
  const change = getEffectiveDelta(event);
  if (!change || change.amount === 0) return [];

  const categories = change.categories || getCategoriesForPersona(personaId);
  const personaCategories = getCategoriesForPersona(personaId);
  const targetCategories = categories.filter(c => personaCategories.includes(c));

  if (targetCategories.length === 0 && !change.categories) {
    const allScores = await getAllTrustScores(tenantId, personaId);
    if (allScores.length > 0) {
      targetCategories.push(allScores[0].category as TrustCategory);
    }
  }

  const results: { category: string; oldScore: number; newScore: number; oldLevel: AutonomyLevel; newLevel: AutonomyLevel }[] = [];

  for (const category of targetCategories) {
    const isCriticalEvent = event === "security_violation" || event === "memory_poisoning" ||
      (event === "pii_exposure" && category === "external_comms");
    const isCascade = event === "cascading_failure" && category === "tool_compliance";

    let atomicResult;
    if (isCriticalEvent) {
      atomicResult = await db.execute(sql`
        WITH prior AS (
          SELECT score as old_score, autonomy_level as old_level
          FROM trust_scores
          WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category} AND locked = false
        )
        UPDATE trust_scores SET
          score = 0,
          autonomy_level = 'blocked',
          consecutive_days_above = 0,
          last_change_reason = ${reason || event},
          last_change_amount = ${change.amount},
          updated_at = CURRENT_TIMESTAMP
        FROM prior
        WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
          AND locked = false
        RETURNING trust_scores.score as new_score, trust_scores.autonomy_level as new_level, prior.old_score
      `);
    } else if (isCascade) {
      atomicResult = await db.execute(sql`
        WITH prior AS (
          SELECT score as old_score, autonomy_level as old_level
          FROM trust_scores
          WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category} AND locked = false
        )
        UPDATE trust_scores SET
          score = LEAST(GREATEST(trust_scores.score + ${change.amount}, ${MIN_SCORE}), 25),
          autonomy_level = CASE
            WHEN LEAST(GREATEST(trust_scores.score + ${change.amount}, ${MIN_SCORE}), 25) <= 25 THEN 'blocked'
            WHEN LEAST(GREATEST(trust_scores.score + ${change.amount}, ${MIN_SCORE}), 25) <= 50 THEN 'approve_before'
            ELSE 'notify_after'
          END,
          consecutive_days_above = 0,
          last_change_reason = ${reason || event},
          last_change_amount = ${change.amount},
          updated_at = CURRENT_TIMESTAMP
        FROM prior
        WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
          AND locked = false
        RETURNING trust_scores.score as new_score, trust_scores.autonomy_level as new_level, prior.old_score
      `);
    } else {
      atomicResult = await db.execute(sql`
        WITH prior AS (
          SELECT score as old_score, autonomy_level as old_level
          FROM trust_scores
          WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category} AND locked = false
        )
        UPDATE trust_scores SET
          score = GREATEST(${MIN_SCORE}, LEAST(${MAX_SCORE}, trust_scores.score + ${change.amount})),
          autonomy_level = CASE
            WHEN GREATEST(${MIN_SCORE}, LEAST(${MAX_SCORE}, trust_scores.score + ${change.amount})) <= 25 THEN 'blocked'
            WHEN GREATEST(${MIN_SCORE}, LEAST(${MAX_SCORE}, trust_scores.score + ${change.amount})) <= 50 THEN 'approve_before'
            WHEN GREATEST(${MIN_SCORE}, LEAST(${MAX_SCORE}, trust_scores.score + ${change.amount})) <= 75 THEN 'notify_after'
            ELSE 'full_auto'
          END,
          consecutive_days_above = CASE
            WHEN ${change.amount} < 0 THEN 0
            ELSE consecutive_days_above + 1
          END,
          last_change_reason = ${reason || event},
          last_change_amount = ${change.amount},
          updated_at = CURRENT_TIMESTAMP
        FROM prior
        WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
          AND locked = false
        RETURNING trust_scores.score as new_score, trust_scores.autonomy_level as new_level, prior.old_score
      `);
    }

    const rows = ((atomicResult as any).rows || atomicResult) as any[];
    if (rows.length === 0) continue;

    const row = rows[0];
    const oldScore = row.old_score ?? 0;
    const newScore = row.new_score;
    const oldLevel = scoreToAutonomyLevel(oldScore);
    const newLevel = row.new_level as AutonomyLevel;

    if (oldLevel !== newLevel) {
      console.log(`[trust-engine] Persona ${personaId} category ${category}: ${oldLevel} → ${newLevel} (score ${oldScore} → ${newScore})`);
    }

    results.push({ category, oldScore, newScore, oldLevel, newLevel });
  }

  return results;
}

export async function setTrustScore(
  tenantId: number,
  personaId: number,
  category: TrustCategory,
  score: number,
  locked?: boolean
): Promise<void> {
  const clampedScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  const level = scoreToAutonomyLevel(clampedScore);
  await db.execute(sql`
    UPDATE trust_scores SET score = ${clampedScore}, autonomy_level = ${level},
      last_change_reason = 'manual_override', last_change_amount = 0,
      ${locked !== undefined ? sql`locked = ${locked},` : sql``}
      updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND category = ${category}
  `);
  console.log(`[trust-engine] Manual override: persona ${personaId} ${category} → ${clampedScore} (${level})${locked ? " [LOCKED]" : ""}`);
}

export async function getAutonomyLevel(
  tenantId: number,
  personaId: number,
  action: string
): Promise<AutonomyLevel> {
  if (NEVER_AUTO_ACTIONS.has(action)) return "approve_before";

  const scores = await getAllTrustScores(tenantId, personaId);
  if (scores.length === 0) return "approve_before";

  const minScore = Math.min(...scores.map(s => s.score));
  return scoreToAutonomyLevel(minScore);
}

export async function getTrustSummary(tenantId: number, personaId: number): Promise<string> {
  const scores = await getAllTrustScores(tenantId, personaId);
  if (scores.length === 0) return "No trust scores available.";
  return scores.map(s =>
    `${s.category}: ${s.score} (${s.autonomyLevel})${s.locked ? " [LOCKED]" : ""}`
  ).join("\n");
}

export function isNeverAutoAction(action: string): boolean {
  return NEVER_AUTO_ACTIONS.has(action);
}

function autonomyRank(level: AutonomyLevel): number {
  switch (level) {
    case "blocked": return 0;
    case "approve_before": return 1;
    case "notify_after": return 2;
    case "full_auto": return 3;
  }
}

function mapRow(r: any): TrustScore {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    personaId: r.persona_id,
    category: r.category,
    score: r.score,
    autonomyLevel: r.autonomy_level,
    lastChangeReason: r.last_change_reason,
    lastChangeAmount: r.last_change_amount,
    consecutiveDaysAbove: r.consecutive_days_above,
    locked: r.locked,
    actionAlpha: r.action_alpha ?? 1.0,
    actionBeta: r.action_beta ?? 1.0,
    restraintAlpha: r.restraint_alpha ?? 1.0,
    restraintBeta: r.restraint_beta ?? 1.0,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}

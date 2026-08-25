// =============================================================================
// Task 130 — DB driver for model-switch savings recommendations.
//
// Tenant-scoped reads only. Split from the pure compute module
// (model-switch-recommendations.ts) so the math stays testable without a pg
// pool, and this join layer is integration-testable against seeded rows
// (tests/integration/model-switch-recommendations.test.ts).
// =============================================================================
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  computeModelSwitchRecommendations,
  type ModelQuality,
  type RecommendationOptions,
  type SwitchRecommendation,
  type WorkflowModelUsage,
} from "./model-switch-recommendations";

export async function fetchWorkflowModelUsage(
  tenantId: number,
  windowDays: number,
): Promise<WorkflowModelUsage[]> {
  const result: any = await db.execute(sql`
    SELECT COALESCE(tool_name, '(unknown)') AS workflow,
           model,
           COUNT(*)::int AS calls,
           COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
           COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
           COALESCE(SUM(NULLIF(cost_usd::text,'')::numeric), 0)::float AS total_cost_usd
    FROM agent_cost_ledger
    WHERE tenant_id = ${tenantId}
      AND model IS NOT NULL
      AND created_at > NOW() - (${windowDays} || ' days')::interval
    GROUP BY 1, 2
  `);
  return (result.rows || result).map((r: any) => ({
    workflow: String(r.workflow),
    model: String(r.model),
    calls: Number(r.calls || 0),
    tokensIn: Number(r.tokens_in || 0),
    tokensOut: Number(r.tokens_out || 0),
    totalCostUsd: Number(r.total_cost_usd || 0),
  }));
}

/**
 * Per-EXECUTING-model quality. Attribution key, in preference order:
 *   1. signals->>'execModel' — persisted directly on the reward row by
 *      recordStepReward (authoritative going forward; Task 130).
 *   2. plans.execution_log entry matched on the one-based step number —
 *      fallback for reward rows written before execModel was persisted.
 * step_rewards.model is the GRADING model ("heuristic-prm"), never used here.
 */
export async function fetchModelQuality(
  tenantId: number,
  windowDays: number,
): Promise<ModelQuality[]> {
  const result: any = await db.execute(sql`
    SELECT t.exec_model AS model,
           COUNT(*)::int AS graded_steps,
           AVG(t.score)::float AS avg_score
    FROM (
      SELECT sr.score,
             COALESCE(
               sr.signals->>'execModel',
               (
                 SELECT e->>'model'
                 FROM plans p
                 CROSS JOIN LATERAL jsonb_array_elements(p.execution_log) e
                 WHERE p.id = sr.plan_id
                   AND p.tenant_id = sr.tenant_id
                   AND jsonb_typeof(p.execution_log) = 'array'
                   AND e->>'step' ~ '^[0-9]+$'
                   AND (e->>'step')::int = sr.step_index
                   AND e->>'model' IS NOT NULL
                 LIMIT 1
               )
             ) AS exec_model
      FROM step_rewards sr
      WHERE sr.tenant_id = ${tenantId}
        AND sr.created_at > NOW() - (${windowDays} || ' days')::interval
    ) t
    WHERE t.exec_model IS NOT NULL
    GROUP BY 1
  `);
  return (result.rows || result).map((r: any) => ({
    model: String(r.model),
    avgScore: Number(r.avg_score || 0),
    gradedSteps: Number(r.graded_steps || 0),
  }));
}

export async function getModelSwitchRecommendations(
  tenantId: number,
  windowDays: number,
  opts?: RecommendationOptions,
): Promise<SwitchRecommendation[]> {
  const [usage, quality] = await Promise.all([
    fetchWorkflowModelUsage(tenantId, windowDays),
    fetchModelQuality(tenantId, windowDays),
  ]);
  return computeModelSwitchRecommendations(usage, quality, opts);
}

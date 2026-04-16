import { db } from "./db";
import { sql } from "drizzle-orm";

export async function trackAction(params: {
  tenantId: number;
  personaId: number;
  actionType: string;
  actionRef?: string;
  description: string;
  expectedOutcome?: string;
  expectedMetric?: string;
  expectedValue?: number;
  metadata?: any;
}): Promise<number> {
  try {
    const result = await db.execute(sql`
      INSERT INTO action_outcomes (tenant_id, persona_id, action_type, action_ref, action_description, action_timestamp, expected_outcome, expected_metric, expected_value, metadata)
      VALUES (${params.tenantId}, ${params.personaId}, ${params.actionType}, ${params.actionRef || null}, ${params.description}, NOW(), ${params.expectedOutcome || null}, ${params.expectedMetric || null}, ${params.expectedValue || null}, ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb)
      RETURNING id
    `);
    const id = ((result as any).rows || [])[0]?.id;
    console.log(`[outcome] Tracked action ${params.actionType} for persona ${params.personaId}: #${id}`);
    return id;
  } catch (err: any) {
    console.error("[outcome] Track failed:", err.message);
    return -1;
  }
}

export async function recordOutcome(
  outcomeId: number,
  tenantId: number,
  actualValue: number | null,
  actualOutcome: string,
  status: "success" | "partial" | "failure" | "unknown"
) {
  try {
    await db.execute(sql`
      UPDATE action_outcomes SET
        actual_value = ${actualValue},
        actual_outcome = ${actualOutcome},
        outcome_status = ${status},
        measured_at = NOW()
      WHERE id = ${outcomeId} AND tenant_id = ${tenantId}
    `);
    console.log(`[outcome] Recorded result for #${outcomeId}: ${status}`);
  } catch (err: any) {
    console.error("[outcome] Record failed:", err.message);
  }
}

export async function addFeedback(outcomeId: number, tenantId: number, feedbackSummary: string) {
  await db.execute(sql`
    UPDATE action_outcomes SET
      feedback_summary = ${feedbackSummary},
      feedback_applied = TRUE
    WHERE id = ${outcomeId} AND tenant_id = ${tenantId}
  `);
}

export async function getOutcomes(tenantId: number, filters?: {
  personaId?: number;
  actionType?: string;
  status?: string;
  limit?: number;
}) {
  const limit = filters?.limit || 50;
  let query = sql`SELECT * FROM action_outcomes WHERE tenant_id = ${tenantId}`;

  if (filters?.personaId) {
    query = sql`${query} AND persona_id = ${filters.personaId}`;
  }
  if (filters?.actionType) {
    query = sql`${query} AND action_type = ${filters.actionType}`;
  }
  if (filters?.status) {
    query = sql`${query} AND outcome_status = ${filters.status}`;
  }

  query = sql`${query} ORDER BY created_at DESC LIMIT ${limit}`;

  const result = await db.execute(query);
  return (result as any).rows || [];
}

export async function getOutcomeStats(tenantId: number) {
  const result = await db.execute(sql`
    SELECT
      persona_id,
      action_type,
      outcome_status,
      COUNT(*) as count,
      AVG(actual_value) as avg_value,
      AVG(expected_value) as avg_expected
    FROM action_outcomes
    WHERE tenant_id = ${tenantId}
    GROUP BY persona_id, action_type, outcome_status
    ORDER BY count DESC
  `);
  return (result as any).rows || [];
}

export async function getPendingOutcomes(tenantId: number, olderThanHours = 24) {
  const result = await db.execute(sql`
    SELECT * FROM action_outcomes
    WHERE tenant_id = ${tenantId}
      AND outcome_status = 'pending'
      AND action_timestamp < NOW() - INTERVAL '1 hour' * ${olderThanHours}
    ORDER BY action_timestamp ASC
    LIMIT 20
  `);
  return (result as any).rows || [];
}

export async function getPatterns(tenantId: number, personaId?: number) {
  let query = sql`SELECT * FROM outcome_patterns WHERE tenant_id = ${tenantId}`;
  if (personaId) {
    query = sql`${query} AND (persona_id = ${personaId} OR persona_id IS NULL)`;
  }
  query = sql`${query} ORDER BY confidence_score DESC NULLS LAST LIMIT 50`;
  const result = await db.execute(query);
  return (result as any).rows || [];
}

export async function savePattern(params: {
  tenantId: number;
  personaId?: number;
  actionType: string;
  pattern: string;
  evidence?: any;
  confidenceScore?: number;
  recommendation?: string;
  sampleSize?: number;
}) {
  await db.execute(sql`
    INSERT INTO outcome_patterns (tenant_id, persona_id, action_type, pattern, evidence, confidence_score, recommendation, sample_size)
    VALUES (${params.tenantId}, ${params.personaId || null}, ${params.actionType}, ${params.pattern}, ${params.evidence ? JSON.stringify(params.evidence) : null}::jsonb, ${params.confidenceScore || null}, ${params.recommendation || null}, ${params.sampleSize || null})
  `);
}

export async function buildOutcomeFeedback(tenantId: number, personaId: number): Promise<string> {
  try {
    const patterns = await getPatterns(tenantId, personaId);
    if (patterns.length === 0) return "";

    const stats = await db.execute(sql`
      SELECT
        action_type,
        outcome_status,
        COUNT(*) as count
      FROM action_outcomes
      WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
        AND outcome_status != 'pending'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY action_type, outcome_status
    `);
    const statRows = (stats as any).rows || [];

    const lines: string[] = ["[Outcome Feedback — Learned Patterns]"];

    for (const p of patterns.slice(0, 5)) {
      lines.push(`- ${p.pattern}${p.recommendation ? ` → ${p.recommendation}` : ""} (confidence: ${((p.confidence_score || 0) * 100).toFixed(0)}%)`);
    }

    if (statRows.length > 0) {
      const successCount = statRows.filter((s: any) => s.outcome_status === "success").reduce((sum: number, s: any) => sum + parseInt(s.count), 0);
      const totalCount = statRows.reduce((sum: number, s: any) => sum + parseInt(s.count), 0);
      if (totalCount > 0) {
        lines.push(`Overall success rate (30d): ${((successCount / totalCount) * 100).toFixed(0)}% (${successCount}/${totalCount})`);
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

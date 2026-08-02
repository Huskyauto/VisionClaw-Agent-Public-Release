/**
 * Skill-RAG Analytics — R74.9
 *
 * Persists every Skill-RAG decision (invoked or skipped) to skill_rag_decisions
 * table for observability + later threshold tuning. Fire-and-forget — never
 * blocks chat response. Failures are logged and swallowed.
 *
 * Table created via psql direct CREATE TABLE per the standing project rule
 * (see replit.md User Preferences line 7+13). Not in shared/schema.ts.
 */

import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import type { SkillRagResult } from "./skill-rag";

export async function logSkillRagDecision(
  tenantId: number,
  question: string,
  gateReason: string,
  result: SkillRagResult,
  candidatesIn: number,
): Promise<void> {
  try {
    const conf = Number.isFinite(result.judgeConfidence)
      ? Math.round(result.judgeConfidence * 100) / 100
      : 0;
    const rewritten = result.rewrittenQuery ? result.rewrittenQuery.slice(0, 800) : null;
    const subs =
      result.subQuestions && result.subQuestions.length > 0
        ? JSON.stringify(result.subQuestions).slice(0, 1500)
        : null;
    // Use raw pg.Pool with positional params — drizzle's sql template was
    // emitting NaN-typed placeholders for some integer params in this 13-arg
    // INSERT. Raw pg is rock-solid for fire-and-forget analytics writes.
    const safeInt = (v: any): number => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const params = [
      safeInt(tenantId),
      question.slice(0, 1000),
      !!result.invoked,
      gateReason.slice(0, 200),
      conf,
      (result.judgeReason || "").slice(0, 500),
      String(result.skillUsed),
      rewritten,
      subs,
      !!result.exited,
      safeInt(candidatesIn),
      safeInt(result.candidates?.length),
      safeInt(result.totalMs),
    ];
    await pool.query(
      `INSERT INTO skill_rag_decisions (
        tenant_id, question, invoked, gate_reason, judge_confidence, judge_reason,
        skill_used, rewritten_query, sub_questions, exited,
        candidates_in, candidates_out, total_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      params,
    );
  } catch (e: any) {
    console.warn(`[skill-rag-analytics] log failed (non-fatal): ${e.message}`);
  }
}

export async function getSkillRagAnalyticsSummary(
  tenantId: number,
  sinceDays: number = 7,
): Promise<{
  totalDecisions: number;
  invocationRate: number;
  skillBreakdown: Record<string, number>;
  exitRate: number;
  avgConfidence: number;
  avgLatencyMs: number;
  topGateReasons: Array<{ reason: string; count: number }>;
}> {
  try {
    const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
    const rows: any[] = (await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE invoked = true)::int AS invoked,
        skill_used,
        COUNT(*)::int AS skill_count,
        AVG(judge_confidence)::float AS avg_conf,
        AVG(total_ms)::float AS avg_ms,
        COUNT(*) FILTER (WHERE exited = true)::int AS exits,
        gate_reason
      FROM skill_rag_decisions
      WHERE tenant_id = ${tenantId} AND created_at >= ${since.toISOString()}
      GROUP BY GROUPING SETS ((skill_used), (gate_reason), ())
    `) as any).rows || [];

    let totalDecisions = 0;
    let invokedCount = 0;
    let exits = 0;
    let avgConfidence = 0;
    let avgLatencyMs = 0;
    const skillBreakdown: Record<string, number> = {};
    const gateReasons: Record<string, number> = {};

    for (const r of rows) {
      if (r.skill_used === null && r.gate_reason === null) {
        totalDecisions = r.total || 0;
        invokedCount = r.invoked || 0;
        exits = r.exits || 0;
        avgConfidence = r.avg_conf || 0;
        avgLatencyMs = r.avg_ms || 0;
      } else if (r.skill_used !== null) {
        skillBreakdown[r.skill_used] = r.skill_count || 0;
      } else if (r.gate_reason !== null) {
        gateReasons[r.gate_reason] = r.skill_count || 0;
      }
    }

    const topGateReasons = Object.entries(gateReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      totalDecisions,
      invocationRate: totalDecisions > 0 ? invokedCount / totalDecisions : 0,
      skillBreakdown,
      exitRate: invokedCount > 0 ? exits / invokedCount : 0,
      avgConfidence,
      avgLatencyMs,
      topGateReasons,
    };
  } catch (e: any) {
    console.warn(`[skill-rag-analytics] summary failed: ${e.message}`);
    return {
      totalDecisions: 0,
      invocationRate: 0,
      skillBreakdown: {},
      exitRate: 0,
      avgConfidence: 0,
      avgLatencyMs: 0,
      topGateReasons: [],
    };
  }
}

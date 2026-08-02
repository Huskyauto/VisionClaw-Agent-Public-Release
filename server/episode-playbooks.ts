/**
 * Episode playbooks (Kimi K3 #2) — step-level case-based reasoning.
 *
 * The LOOP plan-replay cache operates at the orchestration-PLAN grain (whole
 * plans replayed verbatim on near-identical objectives). This module operates
 * one level below: successful agent_runs TRAJECTORIES (the step ledger written
 * via withRun/appendStep) are distilled into compact playbooks and retrieved by
 * embedding similarity as ADVISORY planner context — "a similar goal previously
 * succeeded via these steps" — never replayed verbatim.
 *
 * Advisory + fail-open by design: a distillation or retrieval failure never
 * blocks the run or the planner (mirrors plan-replay's posture; quality fails
 * open, only safety fails closed).
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import { logSilentCatch } from "./lib/silent-catch";

const MIN_STEPS = 3;
const MAX_STEPS_STORED = 30;
const MIN_GOAL_LEN = 12;
const SIMILARITY_THRESHOLD = 0.82;
const MAX_AGE_DAYS = 60;
const MAX_PLAYBOOKS_RETURNED = 2;
const DEDUP_SIMILARITY = 0.97;

export interface PlaybookHit {
  id: number;
  runType: string;
  goal: string;
  steps: string[];
  similarity: number;
  successCount: number;
}

/**
 * Distill a completed run's step ledger into a playbook row. Fire-and-forget
 * from completeRun — never awaited on the run's hot path.
 */
export function distillEpisode(params: {
  runId: number;
  tenantId: number;
  runType: string;
  goal: string;
  steps: Array<{ step: string; status: string; at?: string }>;
  durationMs?: number | null;
}): void {
  const { runId, tenantId, runType, goal, steps } = params;
  if (!tenantId || tenantId <= 0) return;
  if (!goal || goal.trim().length < MIN_GOAL_LEN) return;
  const completedSteps = (steps || []).filter((s) => s?.step && s.status !== "failed");
  if (completedSteps.length < MIN_STEPS) return;

  (async () => {
    try {
      const embedding = await generateEmbedding(goal);
      if (!embedding) return;
      const embeddingLiteral = `[${embedding.join(",")}]`;

      // Compact trajectory: ordered step labels only (details can hold PII /
      // volatile ids — the label sequence is the reusable part).
      const stepLabels = completedSteps.slice(0, MAX_STEPS_STORED).map((s) => String(s.step).slice(0, 200));

      // Dedup: a near-identical existing playbook for the same run_type gets its
      // success_count bumped instead of a duplicate row.
      const existing: any = await db.execute(sql`
        SELECT id, 1 - (goal_embedding <=> ${embeddingLiteral}::vector) AS similarity
        FROM episode_playbooks
        WHERE tenant_id = ${tenantId} AND run_type = ${runType} AND goal_embedding IS NOT NULL
        ORDER BY goal_embedding <=> ${embeddingLiteral}::vector ASC
        LIMIT 1
      `);
      const top = ((existing.rows ?? existing) as any[])[0];
      if (top && Number(top.similarity) >= DEDUP_SIMILARITY) {
        await db.execute(sql`
          UPDATE episode_playbooks
          SET success_count = success_count + 1,
              steps_json = ${JSON.stringify({ steps: stepLabels })}::jsonb,
              step_count = ${stepLabels.length},
              total_duration_ms = ${params.durationMs ?? null},
              source_run_id = ${runId}
          WHERE id = ${top.id} AND tenant_id = ${tenantId}
        `);
        return;
      }

      await db.execute(sql`
        INSERT INTO episode_playbooks
          (tenant_id, run_type, goal, goal_embedding, steps_json, step_count, total_duration_ms, source_run_id)
        VALUES
          (${tenantId}, ${runType}, ${goal.slice(0, 500)}, ${embeddingLiteral}::vector,
           ${JSON.stringify({ steps: stepLabels })}::jsonb, ${stepLabels.length},
           ${params.durationMs ?? null}, ${runId})
      `);
      console.log(`[episode-playbooks] DISTILLED run=${runId} type=${runType} steps=${stepLabels.length}`);
    } catch (err) {
      logSilentCatch("server/episode-playbooks.ts", err);
    }
  })();
}

/**
 * Retrieve the top matching playbooks for a goal (tenant-scoped, recency- and
 * similarity-gated). Returns [] on any failure.
 */
export async function retrieveEpisodePlaybooks(
  goal: string,
  tenantId: number,
): Promise<PlaybookHit[]> {
  if (!goal || goal.trim().length < MIN_GOAL_LEN) return [];
  try {
    const embedding = await generateEmbedding(goal);
    if (!embedding) return [];
    const embeddingLiteral = `[${embedding.join(",")}]`;
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400_000);

    const r: any = await db.execute(sql`
      SELECT id, run_type, goal, steps_json, success_count,
             1 - (goal_embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM episode_playbooks
      WHERE tenant_id = ${tenantId}
        AND goal_embedding IS NOT NULL
        AND created_at > ${cutoff}
      ORDER BY goal_embedding <=> ${embeddingLiteral}::vector ASC
      LIMIT ${MAX_PLAYBOOKS_RETURNED}
    `);
    const rows = ((r.rows ?? r) as any[]).filter((row) => Number(row.similarity) >= SIMILARITY_THRESHOLD);
    if (rows.length === 0) return [];

    // Bump hit metadata fire-and-forget.
    const ids = rows.map((row) => Number(row.id));
    db.execute(sql`
      UPDATE episode_playbooks SET hit_count = hit_count + 1, last_hit_at = now()
      WHERE tenant_id = ${tenantId} AND id = ANY(${`{${ids.join(",")}}`}::int[])
    `).catch((err) => logSilentCatch("server/episode-playbooks.ts", err));

    return rows.map((row) => ({
      id: Number(row.id),
      runType: String(row.run_type),
      goal: String(row.goal),
      steps: Array.isArray(row.steps_json?.steps) ? row.steps_json.steps.map(String) : [],
      similarity: Number(row.similarity),
      successCount: Number(row.success_count) || 1,
    }));
  } catch (err) {
    logSilentCatch("server/episode-playbooks.ts", err);
    return [];
  }
}

/** Format playbook hits as an ADVISORY planner-prompt block ("" when none). */
export function formatPlaybooksForPlanner(hits: PlaybookHit[]): string {
  if (!hits.length) return "";
  const blocks = hits.map((h, i) =>
    `Playbook ${i + 1} (similarity ${h.similarity.toFixed(2)}, succeeded ${h.successCount}x — goal: "${h.goal.slice(0, 140)}"):\n` +
    h.steps.map((s, j) => `  ${j + 1}. ${s}`).join("\n"),
  );
  return `\nEPISODE PLAYBOOKS (ADVISORY — similar goals previously succeeded via these step sequences; adapt freely, do NOT copy blindly if the objective differs):\n${blocks.join("\n")}\n`;
}

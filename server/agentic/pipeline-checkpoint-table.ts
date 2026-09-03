/**
 * pipeline-checkpoint-table.ts — idempotent persistence guarantee for
 * `pipeline_stage_artifacts` (Resume & reconstitution, Task #53).
 *
 * Same ensure-on-first-use pattern as repo-surgeon-table.ts /
 * repair-incident-table.ts: this repo applies schema via `drizzle-kit db:push`
 * / psql DDL (the migration journal is intentionally empty), so we guarantee
 * the checkpoint table exists in EVERY environment — including the standalone
 * `npx tsx scripts/build-bwb-*.ts` render processes — with a cached, idempotent
 * CREATE TABLE IF NOT EXISTS run once before the first read/write. Mirrors
 * `shared/schema.ts` pipelineStageArtifacts and its two indexes exactly.
 */

let ensured: Promise<void> | null = null;

export function ensurePipelineStageArtifactsTable(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pipeline_stage_artifacts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        job_key TEXT NOT NULL,
        stage TEXT NOT NULL,
        unit_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'completed',
        artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
        artifact_path TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Upsert target — MUST match the ON CONFLICT column list in
    // pipeline-checkpoint.ts exactly, or the merge silently no-ops (R125+17).
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stage_artifacts_job_unit ON pipeline_stage_artifacts (tenant_id, job_key, stage, unit_key)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_pipeline_stage_artifacts_job ON pipeline_stage_artifacts (tenant_id, job_key)`,
    );
  })().catch((e) => {
    // Reset so a transient DB outage doesn't permanently disable persistence.
    ensured = null;
    throw e;
  });
  return ensured;
}

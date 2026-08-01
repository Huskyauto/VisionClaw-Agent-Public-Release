/**
 * repo-surgeon-table.ts — idempotent persistence guarantee for
 * `repo_surgeon_attempts` (Repo Surgeon Task #52).
 *
 * Same ensure-on-first-use pattern as repair-incident-table.ts: this repo
 * applies schema via `drizzle-kit db:push` / psql DDL (the migration journal is
 * intentionally empty), so we guarantee the executor's attempt table exists in
 * EVERY environment with a cached, idempotent CREATE TABLE IF NOT EXISTS run
 * once before the first insert. Mirrors `shared/schema.ts` repoSurgeonAttempts
 * and its two indexes exactly.
 */

let ensured: Promise<void> | null = null;

export function ensureRepoSurgeonAttemptsTable(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS repo_surgeon_attempts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        incident_id INTEGER,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        diagnosis TEXT NOT NULL DEFAULT '',
        root_cause TEXT NOT NULL DEFAULT '',
        touched_files TEXT[] NOT NULL DEFAULT '{}'::text[],
        outcome TEXT NOT NULL DEFAULT 'rolled_back',
        outcome_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        escalated BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_repo_surgeon_attempts_tenant_incident ON repo_surgeon_attempts (tenant_id, incident_id)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_repo_surgeon_attempts_outcome ON repo_surgeon_attempts (outcome, created_at)`,
    );
  })().catch((e) => {
    // Reset so a transient DB outage doesn't permanently disable persistence.
    ensured = null;
    throw e;
  });
  return ensured;
}

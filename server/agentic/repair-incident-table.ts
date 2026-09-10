/**
 * repair-incident-table.ts — idempotent persistence guarantee for `repair_incidents`.
 *
 * This repo applies schema via `drizzle-kit db:push` / psql DDL (the migration
 * journal is intentionally empty — no generated migrations). To guarantee the
 * incident table exists in EVERY environment (dev, CI, prod, a fresh clone)
 * regardless of whether `db:push` has run yet, we follow the established
 * ensure-on-first-use pattern (see server/webhook-dedupe.ts,
 * server/social-publisher.ts): a cached, idempotent CREATE TABLE IF NOT EXISTS
 * run once before the first insert. Mirrors `shared/schema.ts` repairIncidents
 * and the live table exactly (3 indexes).
 */

let ensured: Promise<void> | null = null;

export function ensureRepairIncidentsTable(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS repair_incidents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        signature TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        classification TEXT NOT NULL,
        classification_confidence REAL NOT NULL DEFAULT 0,
        classification_reason TEXT NOT NULL DEFAULT '',
        classified_by TEXT NOT NULL DEFAULT 'heuristic',
        routed_to TEXT NOT NULL DEFAULT 'surface',
        safety_blocked_autofix BOOLEAN NOT NULL DEFAULT false,
        jury_verdict TEXT,
        jury_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        escalated BOOLEAN NOT NULL DEFAULT false,
        action_taken TEXT,
        action_outcome TEXT,
        action_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        resolved BOOLEAN NOT NULL DEFAULT false,
        resolved_at TIMESTAMP,
        dispatched_at TIMESTAMP,
        human_label TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        classified_at TIMESTAMP
      )
    `);
    // Task #54 — additive columns for the closed remedy-dispatch loop. The table
    // predates these columns in already-migrated environments, and CREATE TABLE
    // IF NOT EXISTS won't add them to an existing table, so ensure each one with
    // an idempotent ALTER ... ADD COLUMN IF NOT EXISTS (Postgres 9.6+).
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS action_taken TEXT`);
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS action_outcome TEXT`);
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS action_detail JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE repair_incidents ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_repair_incidents_tenant_created ON repair_incidents (tenant_id, created_at)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_repair_incidents_source ON repair_incidents (source, created_at)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_repair_incidents_classification ON repair_incidents (classification, created_at)`,
    );
  })().catch((e) => {
    // Reset so a transient DB outage doesn't permanently disable persistence.
    ensured = null;
    throw e;
  });
  return ensured;
}

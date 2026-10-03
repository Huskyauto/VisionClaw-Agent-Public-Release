-- R60.B — Durable agent job queue (Apr 20, 2026).
-- Applied via direct SQL (see project rule: never modify shared/schema.ts
-- without approval; use psql $DATABASE_URL for new tables).
--
-- To apply on a fresh environment:
--   psql $DATABASE_URL -f scripts/migrations/R60-agent-jobs.sql

CREATE TABLE IF NOT EXISTS agent_jobs (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id     INTEGER,
  persona_id    INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  lease_until   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parent_job_id INTEGER REFERENCES agent_jobs(id) ON DELETE SET NULL,
  result        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  CONSTRAINT agent_jobs_status_check
    CHECK (status IN ('pending','running','succeeded','failed','failed_terminal','cancelled'))
);

-- Claim path: filter by pending + due, order by next_run_at.
CREATE INDEX IF NOT EXISTS agent_jobs_claim_idx
  ON agent_jobs (status, next_run_at) WHERE status = 'pending';

-- Lease sweep: expired-lease running jobs.
CREATE INDEX IF NOT EXISTS agent_jobs_lease_idx
  ON agent_jobs (status, lease_until) WHERE status = 'running';

-- Operator inbox filters.
CREATE INDEX IF NOT EXISTS agent_jobs_kind_status_idx
  ON agent_jobs (kind, status, created_at DESC);

-- Per-tenant listing.
CREATE INDEX IF NOT EXISTS agent_jobs_tenant_idx
  ON agent_jobs (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Failure-class-aware retry/backoff + rollback notes (Forge reliability slice).
-- Idempotent; applied to dev via direct psql, canonical record here for prod.
--   failure_class : taxonomy bucket (server/lib/failure-taxonomy.ts) — drives
--                   retry vs immediate dead-letter + clustering of failures.
--   rollback_note : compensating-action note for a half-applied mutating job.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS failure_class TEXT;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS rollback_note TEXT;

-- Failure clustering (Slice D): scan recent terminal failures by class.
CREATE INDEX IF NOT EXISTS agent_jobs_failure_class_idx
  ON agent_jobs (failure_class, created_at DESC) WHERE failure_class IS NOT NULL;

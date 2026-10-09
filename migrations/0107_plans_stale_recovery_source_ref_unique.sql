-- S8: one tenant-bound stale recovery child per deterministic incident key.
-- Deployment preflight: preserve every historical row while making only the
-- first identity canonical. Later duplicates receive a deterministic legacy
-- suffix and are never treated as active recovery identities.
WITH duplicates AS (
  SELECT id, tenant_id, source_ref,
    row_number() OVER (PARTITION BY tenant_id, source, source_ref ORDER BY id) AS ordinal
  FROM plans
  WHERE source = 'stale-plan-recovery' AND source_ref IS NOT NULL
), rewritten AS (
  SELECT id, source_ref || ':legacy:' || id::text AS replacement
  FROM duplicates WHERE ordinal > 1
)
UPDATE plans p SET
  status = CASE WHEN p.status IN ('awaiting_approval','approved','executing') THEN 'rejected' ELSE p.status END,
  ceo_decision = CASE WHEN p.status IN ('awaiting_approval','approved','executing') THEN 'rejected' ELSE p.ceo_decision END,
  ceo_decision_reason = CASE WHEN p.status IN ('awaiting_approval','approved','executing')
    THEN 'superseded duplicate recovery identity' ELSE p.ceo_decision_reason END,
  execution_log = CASE WHEN p.status IN ('awaiting_approval','approved','executing')
    THEN COALESCE(p.execution_log, '[]'::jsonb) || '[{"type":"execution.recovery_blocker","actionable":true,"reason":"superseded duplicate recovery identity"}]'::jsonb
    ELSE p.execution_log END,
  source_ref = r.replacement
FROM rewritten r WHERE p.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS plans_stale_recovery_source_ref_unique
  ON plans (tenant_id, source, source_ref)
  WHERE source = 'stale-plan-recovery' AND source_ref IS NOT NULL;

-- Rollback: DROP INDEX IF EXISTS plans_stale_recovery_source_ref_unique;
-- Historical legacy-suffixed source_ref values remain auditable and may be
-- restored manually only after confirming their original identity.
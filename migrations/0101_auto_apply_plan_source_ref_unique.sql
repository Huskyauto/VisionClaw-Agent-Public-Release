BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS plans_auto_apply_source_ref_unique
  ON plans (tenant_id, source, source_ref)
  WHERE source = 'agentic-engine.auto-apply'
    AND source_ref IS NOT NULL;

COMMIT;
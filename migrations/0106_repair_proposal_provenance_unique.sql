BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS code_proposals_repair_provenance_unique
  ON code_proposals (tenant_id, source, source_session_id)
  WHERE source = 'production-repair-handoff' AND source_session_id IS NOT NULL;
COMMIT;
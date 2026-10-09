-- Match server/seed.ts's evidence deduplication contract on a fresh CI DB.
-- Never replace this with a non-unique index: payment/webhook replay depends
-- on ON CONFLICT (tenant_id, source, external_ref) matching this predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_evidence_tenant_source_ref
  ON mission_evidence (tenant_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

-- Also declared as native SQL in shared/models/operational-learning.ts and
-- captured in docs/schema-snapshot.sql. Fresh db:push does not install it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sprint_contracts_open_per_ref
  ON sprint_contracts (tenant_id, ref_kind, ref_id)
  WHERE status = 'open';

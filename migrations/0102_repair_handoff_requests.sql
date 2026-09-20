BEGIN;
CREATE TABLE IF NOT EXISTS repair_handoff_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_identity text NOT NULL,
  source_finding_id text NOT NULL,
  source_evidence_version text NOT NULL,
  source_evidence_hash text NOT NULL,
  nonce text NOT NULL,
  key_id text NOT NULL,
  request_timestamp timestamp NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  proposal_id integer,
  job_id integer,
  blocker text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  accepted_at timestamp,
  consumed_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS repair_handoff_requests_identity_unique
  ON repair_handoff_requests (tenant_id, repair_identity);
CREATE UNIQUE INDEX IF NOT EXISTS repair_handoff_requests_nonce_unique
  ON repair_handoff_requests (tenant_id, nonce);
CREATE INDEX IF NOT EXISTS repair_handoff_requests_tenant_idx ON repair_handoff_requests (tenant_id);
CREATE INDEX IF NOT EXISTS repair_handoff_requests_status_idx ON repair_handoff_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS repair_handoff_requests_created_idx ON repair_handoff_requests (created_at);
COMMIT;
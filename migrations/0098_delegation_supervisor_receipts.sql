CREATE TABLE IF NOT EXISTS delegation_supervisor_receipts (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delegation_id text NOT NULL,
  attempt_id text NOT NULL,
  policy_version text NOT NULL,
  supervision_mode text NOT NULL,
  source text NOT NULL,
  requester_identity text NOT NULL,
  target_agent text NOT NULL,
  status text NOT NULL,
  final_tier text,
  structurally_valid boolean NOT NULL,
  enforcement_enabled boolean NOT NULL DEFAULT false,
  decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegation_supervisor_receipts_tenant_created
  ON delegation_supervisor_receipts (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delegation_supervisor_receipts_tenant_delegation
  ON delegation_supervisor_receipts (tenant_id, delegation_id);
DROP INDEX IF EXISTS uidx_delegation_supervisor_receipts_tenant_attempt;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_delegation_supervisor_receipts_tenant_attempt_policy
  ON delegation_supervisor_receipts (tenant_id, delegation_id, attempt_id, policy_version);

-- Rollback:
-- DROP TABLE IF EXISTS delegation_supervisor_receipts;
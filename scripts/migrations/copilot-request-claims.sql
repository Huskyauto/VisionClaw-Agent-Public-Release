-- Additive development migration. Production applies through the normal Publish
-- schema reconciliation, never at server startup. No existing data backfill.
CREATE TABLE IF NOT EXISTS copilot_request_claims (
  id text PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_copilot_claims_tenant_created ON copilot_request_claims(tenant_id, created_at);
ALTER TABLE copilot_request_claims ADD COLUMN IF NOT EXISTS owner_message_id integer REFERENCES messages(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_owner_message ON copilot_request_claims(tenant_id, owner_message_id);
-- Rollback: disable the feature; retain this ledger rather than deleting quota evidence.

BEGIN;
ALTER TABLE repair_handoff_requests
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;
CREATE INDEX IF NOT EXISTS repair_handoff_requests_claim_idx
  ON repair_handoff_requests (tenant_id, status, claim_expires_at);
COMMIT;
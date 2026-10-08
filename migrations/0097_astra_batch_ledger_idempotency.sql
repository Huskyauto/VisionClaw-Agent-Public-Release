ALTER TABLE agent_cost_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cost_ledger_tenant_idempotency
  ON agent_cost_ledger (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Rollback:
-- DROP INDEX IF EXISTS idx_agent_cost_ledger_tenant_idempotency;
-- ALTER TABLE agent_cost_ledger DROP COLUMN IF EXISTS idempotency_key;
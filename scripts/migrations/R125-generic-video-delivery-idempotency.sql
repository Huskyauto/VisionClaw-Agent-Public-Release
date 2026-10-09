-- Add a durable, tenant-scoped idempotency key for generic fulfillment jobs.
-- Safe on existing databases: nullable column, no backfill, partial index.
-- Rollback:
--   DROP INDEX IF EXISTS delivery_logs_tenant_idempotency_key_unique;
--   ALTER TABLE delivery_logs DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE delivery_logs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_logs_tenant_idempotency_key_unique
  ON delivery_logs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
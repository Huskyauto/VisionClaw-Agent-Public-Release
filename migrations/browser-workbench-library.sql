-- DEVELOPMENT ONLY. Managed production DDL belongs to Replit Publish.
-- No backfill: a missing row means an empty dedicated browser library.
CREATE TABLE IF NOT EXISTS browser_workbench_libraries (
  tenant_id integer PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
-- The primary key is the tenant lookup/FK index.
-- Rollback: unregister library routes before dropping this table.
-- File bytes in file_storage are intentionally untouched.
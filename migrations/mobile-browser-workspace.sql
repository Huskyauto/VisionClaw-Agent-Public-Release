-- Additive migration; no existing rows are changed.
CREATE TABLE IF NOT EXISTS browser_workspace_controls (
  tenant_id integer PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
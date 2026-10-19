CREATE TABLE IF NOT EXISTS owner_alert_logs (
  id text PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  subject text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL,
  size_bytes integer NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_alert_logs_tenant_created
  ON owner_alert_logs (tenant_id, created_at);

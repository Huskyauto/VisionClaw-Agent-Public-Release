CREATE TABLE IF NOT EXISTS web_domain_usage_events (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_domain_usage_events_tenant
  ON web_domain_usage_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_web_domain_usage_events_tenant_host_time
  ON web_domain_usage_events(tenant_id, hostname, occurred_at);

CREATE TABLE IF NOT EXISTS web_domain_cooldowns (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  cooldown_until TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_domain_cooldowns_tenant
  ON web_domain_cooldowns(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_web_domain_cooldowns_tenant_host
  ON web_domain_cooldowns(tenant_id, hostname);
CREATE INDEX IF NOT EXISTS idx_web_domain_cooldowns_expiry
  ON web_domain_cooldowns(cooldown_until);

CREATE TABLE IF NOT EXISTS web_collection_runs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_key TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  claim_token TEXT NOT NULL,
  lease_expires_at TIMESTAMP NOT NULL,
  result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_collection_runs_tenant
  ON web_collection_runs(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_web_collection_runs_tenant_run
  ON web_collection_runs(tenant_id, run_key);
CREATE INDEX IF NOT EXISTS idx_web_collection_runs_tenant_lease
  ON web_collection_runs(tenant_id, lease_expires_at);
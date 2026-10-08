-- R76 — Trust-Tier Policy Engine + Deliverable Contract Verification
-- Manual creation to avoid drizzle's rename-ambiguity prompts.

CREATE TABLE IF NOT EXISTS tool_policies (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL,
  scope_kind      TEXT NOT NULL,
  scope_value     TEXT NOT NULL,
  action          TEXT NOT NULL,
  max_amount_cents INTEGER,
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT 'owner',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tp_tenant ON tool_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tp_scope ON tool_policies(tenant_id, scope_kind, scope_value);

CREATE TABLE IF NOT EXISTS policy_audit (
  id                SERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL,
  tool_name         TEXT NOT NULL,
  action            TEXT,
  decision          TEXT NOT NULL,
  matched_policy_id INTEGER,
  reason            TEXT NOT NULL DEFAULT '',
  params_summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pa_tenant ON policy_audit(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pa_tool ON policy_audit(tool_name);

CREATE TABLE IF NOT EXISTS deliverable_contracts (
  id                    SERIAL PRIMARY KEY,
  deliverable_type      TEXT NOT NULL,
  required_extensions   TEXT[] DEFAULT ARRAY[]::TEXT[],
  required_mime_pattern TEXT,
  min_size_bytes        INTEGER,
  max_size_bytes        INTEGER,
  schema_jsonschema     JSONB,
  render_check          TEXT NOT NULL DEFAULT 'none',
  description           TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dc_type ON deliverable_contracts(deliverable_type);

CREATE TABLE IF NOT EXISTS delivery_verifications (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL,
  persona_id          INTEGER,
  conversation_id     INTEGER,
  deliverable_type    TEXT NOT NULL,
  file_path           TEXT,
  file_url            TEXT,
  contract_id         INTEGER,
  status              TEXT NOT NULL,
  failures            JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_extension  TEXT,
  detected_mime       TEXT,
  detected_size       INTEGER,
  verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dv_tenant ON delivery_verifications(tenant_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_dv_status ON delivery_verifications(status);

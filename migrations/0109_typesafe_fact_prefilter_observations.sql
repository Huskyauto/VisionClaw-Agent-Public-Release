CREATE TABLE IF NOT EXISTS typesafe_fact_prefilter_observations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  source_message_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  version TEXT NOT NULL DEFAULT 'jev-session-fact-prefilter-v1',
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  durable_fact_probability REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  model TEXT,
  extractor_ran BOOLEAN,
  facts_written INTEGER,
  error_class TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_typesafe_fact_prefilter_source
    UNIQUE (tenant_id, source_message_id, version)
);

CREATE INDEX IF NOT EXISTS idx_typesafe_fact_prefilter_tenant
  ON typesafe_fact_prefilter_observations (tenant_id);
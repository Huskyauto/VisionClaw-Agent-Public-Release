-- Additive schema for Felix's tenant-scoped Spark handoff.
-- Drizzle's shared/schema.ts remains the publish-time schema source of truth.
CREATE TABLE IF NOT EXISTS api_v1_conversation_runs (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_v1_conversation_runs_tenant
  ON api_v1_conversation_runs (tenant_id, conversation_id);

CREATE TABLE IF NOT EXISTS spark_outbox (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id INTEGER NOT NULL REFERENCES personas(id),
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT spark_outbox_message_length CHECK (char_length(message) BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS idx_spark_outbox_tenant_id ON spark_outbox (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_spark_outbox_tenant_created ON spark_outbox (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_spark_outbox_persona ON spark_outbox (persona_id);
CREATE INDEX IF NOT EXISTS idx_spark_outbox_conversation ON spark_outbox (conversation_id);
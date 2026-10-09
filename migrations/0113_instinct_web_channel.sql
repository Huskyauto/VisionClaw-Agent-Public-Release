-- Additive development schema for the owner-only Instinct web channel.
-- shared/schema.ts is the Drizzle source of truth for publish-time comparison.
-- No production DDL here; Replit Publish handles the production schema after
-- owner approval. Rollback code first and leave these rows/tables intact so
-- uncertain work and submission receipts remain available for investigation.
CREATE TABLE IF NOT EXISTS instinct_web_threads (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  conversation_id INTEGER UNIQUE,
  previous_conversation_id INTEGER,
  status_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT instinct_web_threads_state_check CHECK (state IN ('reserved', 'ready', 'blocked'))
);
CREATE INDEX IF NOT EXISTS idx_instinct_web_threads_state_updated
  ON instinct_web_threads (state, updated_at);

CREATE TABLE IF NOT EXISTS instinct_web_submissions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  client_key TEXT NOT NULL,
  message TEXT NOT NULL,
  state TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT instinct_web_submissions_message_size CHECK (char_length(message) BETWEEN 1 AND 16000),
  CONSTRAINT instinct_web_submissions_state_check CHECK (state IN ('accepted', 'running', 'complete', 'failed', 'blocked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instinct_web_submissions_tenant_token
  ON instinct_web_submissions (tenant_id, token_hash);
CREATE INDEX IF NOT EXISTS idx_instinct_web_submissions_tenant_thread_created
  ON instinct_web_submissions (tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_instinct_web_submissions_conversation
  ON instinct_web_submissions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_instinct_web_submissions_created_at
  ON instinct_web_submissions (created_at);
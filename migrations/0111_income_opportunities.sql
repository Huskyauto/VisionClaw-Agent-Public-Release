-- Additive Opportunity Bank schema. shared/models/income-opportunities.ts is
-- the Drizzle/publish source of truth; this records the clean-install DDL.
-- Do not run this against production manually. Publish reconciles its schema.
CREATE TABLE IF NOT EXISTS income_opportunities (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT 'Idea',
  buyer TEXT NOT NULL,
  problem TEXT NOT NULL,
  entry_offer TEXT NOT NULL,
  price TEXT NOT NULL DEFAULT 'Not yet validated',
  expansion TEXT NOT NULL DEFAULT 'Not yet defined',
  next_step TEXT NOT NULL,
  featured BOOLEAN NOT NULL DEFAULT false,
  action_path TEXT,
  source TEXT NOT NULL DEFAULT 'felix',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_income_opportunities_tenant
  ON income_opportunities (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS income_opportunities_tenant_slug_unique
  ON income_opportunities (tenant_id, slug);
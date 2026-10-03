-- Additive clean-install record for the global metered-AI reservation authority.
-- shared/schema.ts is the publish-time schema source. Apply only to the
-- development DB when the whole-schema Drizzle push hits ambiguous renames;
-- never run this file against production or from application startup.
CREATE TABLE aggregate_ai_spend_reservations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  attempt_key TEXT NOT NULL,
  utc_day DATE NOT NULL,
  reserved_cents INTEGER NOT NULL,
  actual_cents INTEGER,
  state TEXT NOT NULL DEFAULT 'reserved',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP,
  CONSTRAINT aggregate_ai_spend_reserved_cents_positive CHECK (reserved_cents > 0),
  CONSTRAINT aggregate_ai_spend_reserved_cents_cap CHECK (reserved_cents <= 2000),
  CONSTRAINT aggregate_ai_spend_actual_cents_nonnegative CHECK (actual_cents IS NULL OR actual_cents >= 0),
  CONSTRAINT aggregate_ai_spend_actual_cents_bounded CHECK (actual_cents IS NULL OR actual_cents <= reserved_cents),
  CONSTRAINT aggregate_ai_spend_state_valid CHECK (state IN ('reserved', 'settled')),
  CONSTRAINT aggregate_ai_spend_state_actual_consistent CHECK (
    (state = 'reserved' AND actual_cents IS NULL)
    OR (state = 'settled' AND actual_cents IS NOT NULL)
  )
);
CREATE INDEX idx_aggregate_ai_spend_tenant ON aggregate_ai_spend_reservations (tenant_id);
CREATE INDEX idx_aggregate_ai_spend_day_state ON aggregate_ai_spend_reservations (utc_day, state);
CREATE UNIQUE INDEX idx_aggregate_ai_spend_tenant_attempt ON aggregate_ai_spend_reservations (tenant_id, attempt_key);
-- Global provider-account readiness only; never customer or billing data.
-- Additive. No backfill is needed; a missing row means no known cooldown.
-- Rollback: revert application code; retain this harmless readiness table.
CREATE TABLE IF NOT EXISTS ai_transport_cooldowns (
  transport text PRIMARY KEY,
  cooldown_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- R118 — message_feedback table + indexes + constraints (idempotent)
-- Applied to dev via direct psql ALTER (per replit.md schema preference).
-- This file codifies the DDL so fresh envs / prod migration can replay it.
--
-- Architect note (post-R118 review): the route
--   POST /api/messages/:id/feedback  →  server/storage.ts upsertMessageFeedback
-- runs ON CONFLICT (tenant_id, message_id, COALESCE(user_id, 0)).
-- That clause binds to the expression-form UNIQUE index below — without it,
-- the upsert raises "no unique or exclusion constraint matching" and returns 500.

CREATE TABLE IF NOT EXISTS message_feedback (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  message_id      INTEGER NOT NULL,
  user_id         INTEGER,
  rating          INTEGER NOT NULL,
  comment         TEXT,
  topic_hint      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Rating must be -1 (thumbs down) or +1 (thumbs up). No 0 / no other values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_message_feedback_rating'
      AND conrelid = 'message_feedback'::regclass
  ) THEN
    ALTER TABLE message_feedback
      ADD CONSTRAINT check_message_feedback_rating CHECK (rating IN (-1, 1));
  END IF;
END $$;

-- Comment length cap mirrors the Zod max(2000) in server/validation.ts
-- messageFeedbackSchema. DB-level guard so non-route writers (scripts, SQL
-- console, future background jobs) can't bypass the application limit and
-- bloat AEvo evidence payloads. (Architect MEDIUM 2026-05-20.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_message_feedback_comment_len'
      AND conrelid = 'message_feedback'::regclass
  ) THEN
    ALTER TABLE message_feedback
      ADD CONSTRAINT check_message_feedback_comment_len
      CHECK (comment IS NULL OR char_length(comment) <= 2000);
  END IF;
END $$;

-- AEvo evidence query path (rating = -1 AND topic_hint = ?). Partial index
-- keeps the hot path narrow (only attributed thumbs-down rows).
CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant_topic
  ON message_feedback (tenant_id, topic_hint)
  WHERE topic_hint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant_msg
  ON message_feedback (tenant_id, message_id);

CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant_rating_created
  ON message_feedback (tenant_id, rating, created_at);

-- The UPSERT key. COALESCE collapses the nullable user_id so anonymous votes
-- still get a stable conflict target; a logged-in user updating their vote
-- replaces rather than stacks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_feedback_tenant_msg_user
  ON message_feedback (tenant_id, message_id, COALESCE(user_id, 0));

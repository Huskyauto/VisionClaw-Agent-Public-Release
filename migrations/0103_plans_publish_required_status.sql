BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conname = 'plans_status_check'
      AND pg_get_constraintdef(c.oid) LIKE '%expired%'
      AND pg_get_constraintdef(c.oid) LIKE '%publish_required%'
  ) THEN
    ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_status_check;
    ALTER TABLE plans ADD CONSTRAINT plans_status_check CHECK (status = ANY (ARRAY[
      'awaiting_approval'::text, 'approved'::text, 'rejected'::text,
      'revising'::text, 'revised'::text, 'executing'::text, 'completed'::text,
      'failed'::text, 'expired'::text, 'publish_required'::text
    ]));
  END IF;
END $$;

COMMIT;
BEGIN;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_status_check;
ALTER TABLE plans ADD CONSTRAINT plans_status_check CHECK (status = ANY (ARRAY[
  'awaiting_approval'::text, 'approved'::text, 'rejected'::text,
  'revising'::text, 'revised'::text, 'executing'::text, 'completed'::text,
  'failed'::text, 'expired'::text, 'publish_required'::text,
  'handoff_pending'::text
]));
COMMIT;
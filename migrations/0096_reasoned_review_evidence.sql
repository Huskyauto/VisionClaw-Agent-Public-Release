CREATE TABLE IF NOT EXISTS reasoned_review_evidence (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deliverable_type text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'complete',
  idempotency_key text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_candidate_hash text NOT NULL,
  recommended_candidate_hash text,
  baseline_decision text NOT NULL DEFAULT 'baseline',
  decision_used text NOT NULL DEFAULT 'baseline',
  degraded boolean NOT NULL DEFAULT false,
  disagreement boolean NOT NULL DEFAULT false,
  score_margin real,
  estimated_cost_usd double precision NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  fallback_reason text,
  rollback_triggered boolean NOT NULL DEFAULT false,
  valid_reviewer_count integer NOT NULL DEFAULT 0,
  actual_reviewer_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reasoned_review_evidence_tenant_idempotency
  ON reasoned_review_evidence (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_reasoned_review_evidence_tenant_created
  ON reasoned_review_evidence (tenant_id, created_at);

ALTER TABLE reasoned_review_evidence ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'reasoned_review_evidence'
      AND policyname = 'reasoned_review_tenant_isolation'
  ) THEN
    CREATE POLICY reasoned_review_tenant_isolation ON reasoned_review_evidence
      USING (
        NULLIF(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
      )
      WITH CHECK (
        NULLIF(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visionclaw_rls') THEN
    GRANT SELECT, INSERT, UPDATE ON reasoned_review_evidence TO visionclaw_rls;
    GRANT USAGE, SELECT ON SEQUENCE reasoned_review_evidence_id_seq TO visionclaw_rls;
  END IF;
END $$;
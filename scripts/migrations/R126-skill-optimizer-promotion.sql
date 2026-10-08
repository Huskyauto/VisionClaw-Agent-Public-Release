-- R126 — Durable, tenant-scoped skill optimizer promotion lifecycle.
--
-- Idempotent and intentionally limited to the two optimizer tables. Candidate
-- identity is immutable and unique per tenant. Version rows are append-only
-- evidence; application code never updates or deletes them.

CREATE TABLE IF NOT EXISTS skill_optimization_candidates (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  skill_id integer REFERENCES skills(id) ON DELETE SET NULL,
  identity_key text NOT NULL,
  label text NOT NULL,
  source text NOT NULL,
  state text NOT NULL DEFAULT 'proposed',
  seed_hash text NOT NULL,
  candidate_hash text NOT NULL,
  eval_set_hash text NOT NULL,
  policy_version text NOT NULL,
  name text,
  description text,
  candidate_content text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  jury_decision jsonb,
  jury_decision_hash text,
  review_deadline timestamptz,
  failure_reason text,
  promoted_at timestamptz,
  rolled_back_at timestamptz,
  previous_version_id integer,
  promoted_version_id integer,
  transition_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uidx_skill_opt_candidates_identity UNIQUE (tenant_id, identity_key)
);

ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS eval_set_hash text;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS policy_version text;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS jury_decision_hash text;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS promoted_at timestamptz;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz;
ALTER TABLE skill_optimization_candidates ADD COLUMN IF NOT EXISTS transition_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE skill_optimization_candidates ALTER COLUMN candidate_content DROP NOT NULL;
ALTER TABLE skill_optimization_candidates ALTER COLUMN review_deadline TYPE timestamptz;
ALTER TABLE skill_optimization_candidates ALTER COLUMN promoted_at TYPE timestamptz;
ALTER TABLE skill_optimization_candidates ALTER COLUMN rolled_back_at TYPE timestamptz;
ALTER TABLE skill_optimization_candidates ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE skill_optimization_candidates ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE skill_optimization_candidates ALTER COLUMN eval_set_hash SET NOT NULL;
ALTER TABLE skill_optimization_candidates ALTER COLUMN policy_version SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_skill_opt_candidates_identity
  ON skill_optimization_candidates (tenant_id, identity_key);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'skill_optimization_candidates'::regclass
      AND conname = 'uq_skill_opt_candidates_id_tenant'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_skill_opt_candidates_id_tenant
      ON skill_optimization_candidates (id, tenant_id);
    ALTER TABLE skill_optimization_candidates
      ADD CONSTRAINT uq_skill_opt_candidates_id_tenant
      UNIQUE USING INDEX uidx_skill_opt_candidates_id_tenant;
  END IF;
END $$;
ALTER TABLE skill_optimization_candidates
  DROP CONSTRAINT IF EXISTS skill_opt_candidate_identity_unique;
ALTER TABLE skill_optimization_candidates
  DROP CONSTRAINT IF EXISTS skill_optimization_candidates_skill_id_fkey;
ALTER TABLE skill_optimization_candidates
  ADD CONSTRAINT skill_optimization_candidates_skill_id_fkey
  FOREIGN KEY (skill_id) REFERENCES skills(id);
ALTER TABLE skill_optimization_candidates
  DROP CONSTRAINT IF EXISTS skill_optimization_candidates_skill_id_skills_id_fk;
DROP INDEX IF EXISTS skill_opt_candidate_skill_idx;
DROP INDEX IF EXISTS skill_opt_candidate_state_idx;

CREATE INDEX IF NOT EXISTS idx_skill_opt_candidates_tenant
  ON skill_optimization_candidates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_skill_opt_candidates_skill
  ON skill_optimization_candidates (skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_opt_candidates_state
  ON skill_optimization_candidates (state, review_deadline);

CREATE TABLE IF NOT EXISTS skill_optimization_versions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  skill_id integer NOT NULL REFERENCES skills(id),
  candidate_id integer NOT NULL,
  kind text NOT NULL DEFAULT 'live-snapshot',
  content_hash text NOT NULL,
  content text NOT NULL,
  previous_version_id integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'skill_optimization_versions'
      AND column_name = 'version_kind'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'skill_optimization_versions'
      AND column_name = 'kind'
  ) THEN
    ALTER TABLE skill_optimization_versions RENAME COLUMN version_kind TO kind;
  END IF;
END $$;
ALTER TABLE skill_optimization_versions ADD COLUMN IF NOT EXISTS previous_version_id integer;
ALTER TABLE skill_optimization_versions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE skill_optimization_versions ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE skill_optimization_versions
  DROP CONSTRAINT IF EXISTS skill_optimization_versions_skill_id_fkey;
ALTER TABLE skill_optimization_versions
  ADD CONSTRAINT skill_optimization_versions_skill_id_fkey
  FOREIGN KEY (skill_id) REFERENCES skills(id);
ALTER TABLE skill_optimization_versions
  DROP CONSTRAINT IF EXISTS skill_optimization_versions_skill_id_skills_id_fk;
ALTER TABLE skill_optimization_versions
  DROP CONSTRAINT IF EXISTS skill_optimization_versions_candidate_id_fkey;
ALTER TABLE skill_optimization_versions
  DROP CONSTRAINT IF EXISTS fk_skill_opt_versions_candidate_tenant;
ALTER TABLE skill_optimization_versions
  ADD CONSTRAINT fk_skill_opt_versions_candidate_tenant
  FOREIGN KEY (candidate_id, tenant_id)
  REFERENCES skill_optimization_candidates(id, tenant_id)
  DEFERRABLE INITIALLY DEFERRED;
DROP INDEX IF EXISTS skill_opt_version_skill_idx;
DROP INDEX IF EXISTS skill_opt_version_candidate_idx;

CREATE INDEX IF NOT EXISTS idx_skill_opt_versions_tenant
  ON skill_optimization_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_skill_opt_versions_skill
  ON skill_optimization_versions (skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_opt_versions_candidate
  ON skill_optimization_versions (candidate_id);

ALTER TABLE skill_optimization_candidates
  DROP CONSTRAINT IF EXISTS skill_optimization_candidates_previous_version_id_skill_optimization_versions_id_fk;
ALTER TABLE skill_optimization_candidates
  ADD CONSTRAINT skill_optimization_candidates_previous_version_id_skill_optimization_versions_id_fk
  FOREIGN KEY (previous_version_id) REFERENCES skill_optimization_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE skill_optimization_candidates
  DROP CONSTRAINT IF EXISTS skill_optimization_candidates_promoted_version_id_skill_optimization_versions_id_fk;
ALTER TABLE skill_optimization_candidates
  ADD CONSTRAINT skill_optimization_candidates_promoted_version_id_skill_optimization_versions_id_fk
  FOREIGN KEY (promoted_version_id) REFERENCES skill_optimization_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

GRANT SELECT, INSERT, UPDATE ON skill_optimization_candidates TO visionclaw_rls;
GRANT SELECT, INSERT ON skill_optimization_versions TO visionclaw_rls;
REVOKE DELETE ON skill_optimization_candidates FROM visionclaw_rls;
REVOKE UPDATE, DELETE ON skill_optimization_versions FROM visionclaw_rls;
GRANT USAGE, SELECT, UPDATE
  ON SEQUENCE skill_optimization_candidates_id_seq, skill_optimization_versions_id_seq
  TO visionclaw_rls;

-- Candidate identity/provenance is immutable. Lifecycle fields and evidence may
-- change, but the reviewed object can never be swapped underneath an approval.
CREATE OR REPLACE FUNCTION skill_opt_guard_candidate_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.skill_id IS DISTINCT FROM OLD.skill_id
     OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.identity_key IS DISTINCT FROM OLD.identity_key
     OR NEW.seed_hash IS DISTINCT FROM OLD.seed_hash
     OR NEW.candidate_hash IS DISTINCT FROM OLD.candidate_hash
     OR NEW.eval_set_hash IS DISTINCT FROM OLD.eval_set_hash
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.candidate_content IS DISTINCT FROM OLD.candidate_content
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.transition_history IS DISTINCT FROM OLD.transition_history
     OR (OLD.jury_decision IS NOT NULL AND NEW.jury_decision IS DISTINCT FROM OLD.jury_decision)
     OR (OLD.jury_decision_hash IS NOT NULL AND NEW.jury_decision_hash IS DISTINCT FROM OLD.jury_decision_hash)
  THEN
    RAISE EXCEPTION 'skill optimizer candidate identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skill_opt_candidate_identity_guard ON skill_optimization_candidates;
CREATE TRIGGER skill_opt_candidate_identity_guard
BEFORE UPDATE ON skill_optimization_candidates
FOR EACH ROW EXECUTE FUNCTION skill_opt_guard_candidate_identity();

-- Enforce the lifecycle at the storage boundary. This prevents an application
-- caller from skipping directly to approval/promotion or replacing rollback
-- provenance even if it can issue SQL through the tenant-scoped app role.
CREATE OR REPLACE FUNCTION skill_opt_guard_candidate_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation jsonb;
  versions_valid boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('proposed', 'rejected')
       OR NEW.jury_decision IS NOT NULL
       OR NEW.jury_decision_hash IS NOT NULL
       OR NEW.previous_version_id IS NOT NULL
       OR NEW.promoted_version_id IS NOT NULL
       OR NEW.promoted_at IS NOT NULL
       OR NEW.rolled_back_at IS NOT NULL
       OR NEW.transition_history <> '[]'::jsonb
    THEN
      RAISE EXCEPTION 'skill optimizer candidates must enter through proposed or scanner-rejected registration';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state = 'proposed'
     AND NEW.state = 'approved'
     AND current_user = 'visionclaw_rls'
  THEN
    RAISE EXCEPTION 'skill optimizer approval requires the sealed server writer';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state = 'proposed' AND NEW.state IN ('approved', 'held', 'rejected', 'failed'))
    OR (OLD.state = 'approved' AND NEW.state IN ('promoted', 'held', 'rejected', 'failed'))
    OR (OLD.state = 'held' AND NEW.state IN ('rejected', 'failed'))
    OR (OLD.state = 'promoted' AND NEW.state IN ('rolled_back', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid skill optimizer lifecycle transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF OLD.previous_version_id IS NOT NULL
     AND NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id
  THEN
    RAISE EXCEPTION 'skill optimizer rollback provenance is immutable';
  END IF;
  IF OLD.promoted_version_id IS NOT NULL
     AND NEW.promoted_version_id IS DISTINCT FROM OLD.promoted_version_id
  THEN
    RAISE EXCEPTION 'skill optimizer promotion provenance is immutable';
  END IF;

  IF NEW.state = 'held' AND (
    NEW.review_deadline IS NULL
    OR NEW.failure_reason IS NULL
    OR btrim(NEW.failure_reason) = ''
  ) THEN
    RAISE EXCEPTION 'held skill optimizer candidate requires deadline and owner-visible reason';
  END IF;

  IF NEW.state = 'approved' THEN
    evaluation := NEW.evidence -> 'evaluationAttestation';
    IF NEW.skill_id IS NULL
       OR NEW.candidate_content IS NULL
       OR NEW.policy_version IS NULL
       OR NEW.jury_decision_hash !~ '^[a-f0-9]{64}$'
       OR NEW.jury_decision ->> 'verdict' IS DISTINCT FROM 'FIX'
       OR (NEW.jury_decision ->> 'majority') IS DISTINCT FROM '2'
       OR COALESCE((NEW.jury_decision ->> 'shouldEscalate')::boolean, false)
       OR jsonb_typeof(evaluation) IS DISTINCT FROM 'object'
       OR evaluation ->> 'seedHash' IS DISTINCT FROM NEW.seed_hash
       OR evaluation ->> 'candidateHash' IS DISTINCT FROM NEW.candidate_hash
       OR evaluation ->> 'evalSetHash' IS DISTINCT FROM NEW.eval_set_hash
       OR evaluation ->> 'policyVersion' IS DISTINCT FROM NEW.policy_version
       OR jsonb_typeof(evaluation -> 'baselineScore') IS DISTINCT FROM 'number'
       OR jsonb_typeof(evaluation -> 'bestScore') IS DISTINCT FROM 'number'
       OR (evaluation ->> 'bestScore')::numeric <= (evaluation ->> 'baselineScore')::numeric
       OR (evaluation ->> 'baselineScore')::numeric < 0
       OR (evaluation ->> 'bestScore')::numeric > 1
       OR jsonb_typeof(evaluation -> 'acceptedEdits') IS DISTINCT FROM 'number'
       OR (evaluation ->> 'acceptedEdits')::numeric < 1
       OR jsonb_typeof(evaluation -> 'rejectedEdits') IS DISTINCT FROM 'number'
       OR (evaluation ->> 'rejectedEdits')::numeric < 0
    THEN
      RAISE EXCEPTION 'skill optimizer approval evidence is incomplete or invalid';
    END IF;
  END IF;

  IF NEW.state = 'promoted' AND OLD.state IS DISTINCT FROM 'promoted' THEN
    SELECT EXISTS (
      SELECT 1
      FROM skill_optimization_versions previous
      JOIN skill_optimization_versions promoted
        ON promoted.id = NEW.promoted_version_id
       AND promoted.tenant_id = NEW.tenant_id
       AND promoted.skill_id = NEW.skill_id
       AND promoted.candidate_id = NEW.id
       AND promoted.kind = 'promotion'
       AND promoted.content_hash = NEW.candidate_hash
       AND promoted.previous_version_id = previous.id
      WHERE previous.id = NEW.previous_version_id
        AND previous.tenant_id = NEW.tenant_id
        AND previous.skill_id = NEW.skill_id
        AND previous.candidate_id = NEW.id
        AND previous.kind = 'pre-promotion'
        AND previous.content_hash = NEW.seed_hash
    ) INTO versions_valid;
    IF NOT COALESCE(versions_valid, false) THEN
      RAISE EXCEPTION 'skill optimizer promotion versions do not match candidate provenance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skill_opt_candidate_lifecycle_guard ON skill_optimization_candidates;
CREATE TRIGGER skill_opt_candidate_lifecycle_guard
BEFORE INSERT OR UPDATE ON skill_optimization_candidates
FOR EACH ROW EXECUTE FUNCTION skill_opt_guard_candidate_lifecycle();

-- Every state change leaves an append-only transition record. The application
-- role cannot manufacture a state change without this durable audit trail.
CREATE OR REPLACE FUNCTION skill_opt_record_candidate_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  history jsonb;
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    history := CASE
      WHEN jsonb_typeof(OLD.transition_history) = 'array' THEN OLD.transition_history
      ELSE '[]'::jsonb
    END;
    NEW.transition_history := history || jsonb_build_array(jsonb_build_object(
      'from', OLD.state,
      'to', NEW.state,
      'at', clock_timestamp(),
      'reason', NEW.failure_reason
    ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skill_opt_candidate_transition_audit ON skill_optimization_candidates;
CREATE TRIGGER skill_opt_candidate_transition_audit
BEFORE UPDATE ON skill_optimization_candidates
FOR EACH ROW EXECUTE FUNCTION skill_opt_record_candidate_transition();

ALTER TABLE skill_optimization_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_optimization_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS r120_tenant_isolation ON skill_optimization_candidates;
CREATE POLICY r120_tenant_isolation ON skill_optimization_candidates
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
);

DROP POLICY IF EXISTS r120_tenant_isolation ON skill_optimization_versions;
CREATE POLICY r120_tenant_isolation ON skill_optimization_versions
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
);
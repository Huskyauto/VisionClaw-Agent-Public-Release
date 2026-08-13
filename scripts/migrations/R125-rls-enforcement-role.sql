-- R125 — RLS ENFORCEMENT (makes R120's inert policies actually enforce)
--
-- BACKGROUND / WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- R120 enabled Row-Level Security + the `r120_tenant_isolation` policy on the
-- highest-sensitivity tenant tables, and added `withTenantTx()` to set
-- `app.current_tenant`. BUT the application logs in as the `postgres` role,
-- which is a SUPERUSER with BYPASSRLS. Postgres superusers (and any role with
-- BYPASSRLS) bypass row-level security ENTIRELY — and `FORCE ROW LEVEL
-- SECURITY` does NOT change that (FORCE only makes RLS apply to the table
-- OWNER, never to a superuser). So as shipped, R120's policies never filtered
-- a single row for our role. RLS was documentation, not enforcement.
--
-- THE FIX (no new connection string, no new secret)
-- ---------------------------------------------------------------------------
-- Create a dedicated NOLOGIN, NOSUPERUSER, NOBYPASSRLS role. Inside the
-- existing `withTenantTx()` transaction (env-gated by RLS_ENFORCE=1) the app
-- runs `SET LOCAL ROLE visionclaw_rls`. A superuser session that has SET ROLE
-- to a non-superuser role IS subject to RLS for the duration of that role —
-- and because this role is NOT the table owner, the policy applies with no
-- FORCE needed. SET LOCAL reverts automatically on COMMIT/ROLLBACK, so the
-- pooled connection returns to `postgres` cleanly. Proven empirically
-- (2026-06-17): under this role with app.current_tenant=8, a SELECT on
-- `messages` returned 2 rows instead of 596.
--
-- This migration is SAFE to apply with zero production behavior change:
--   * The role is NOLOGIN and unused until RLS_ENFORCE=1 is set.
--   * The policy redefinition has NO effect on the `postgres` superuser (it
--     bypasses RLS regardless of policy text).
--
-- Idempotent: re-running this file is safe.

-- ---------------------------------------------------------------------------
-- 1) The enforcement role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visionclaw_rls') THEN
    CREATE ROLE visionclaw_rls NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
    RAISE NOTICE 'R125-RLS: created role visionclaw_rls';
  ELSE
    -- Defensive: make sure an existing role can never silently bypass RLS.
    ALTER ROLE visionclaw_rls NOSUPERUSER NOBYPASSRLS;
    RAISE NOTICE 'R125-RLS: role visionclaw_rls already exists (re-asserted NOSUPERUSER NOBYPASSRLS)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Privileges. The role needs DML on tenant tables + sequence usage, plus
--    default privileges so future tables are covered automatically.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO visionclaw_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO visionclaw_rls;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO visionclaw_rls;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO visionclaw_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO visionclaw_rls;

-- ---------------------------------------------------------------------------
-- 3) Harden the r120_tenant_isolation policy: fix the `''::int` crash.
--
-- The original USING/WITH CHECK clause was:
--   current_setting('app.current_tenant', true) IS NULL
--   OR current_setting('app.current_tenant', true) = ''
--   OR tenant_id = current_setting('app.current_tenant')::int
--
-- When the GUC is the empty string (which happens on a pooled connection AFTER
-- a prior SET LOCAL has reverted — `current_setting(..., true)` returns '' not
-- NULL once the GUC is "known"), the third branch evaluated `''::int` and threw
-- `invalid input syntax for type integer: ""` instead of failing open.
--
-- Fix: NULLIF(...,'') collapses both '' and NULL to NULL *before* the cast, so
-- the cast never sees an empty string. Semantics are preserved exactly:
--   * no context (NULL or '') -> first branch TRUE -> fail OPEN (all rows)
--   * context = N             -> tenant_id = N
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'memory_entries','messages','conversations','file_storage',
    'message_feedback','customers','invoices','leads','contracts',
    'knowledge_entries','agent_trace_spans','mind_tickets','agent_runs',
    'procedure_edits'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'R125-RLS: table % does not exist, skipping', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'R125-RLS: table % has no tenant_id column, skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS r120_tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY r120_tenant_isolation ON %I
      USING (
        NULLIF(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
      )
      WITH CHECK (
        NULLIF(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
      )
    $f$, t);

    RAISE NOTICE 'R125-RLS: hardened policy on %', t;
  END LOOP;
END $$;

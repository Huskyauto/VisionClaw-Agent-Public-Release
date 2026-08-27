-- R120 — Postgres Row-Level Security (defense-in-depth)
--
-- Adds DB-engine-enforced tenant isolation on the 12 highest-sensitivity
-- tenant-scoped tables. This is the SECOND line of defense behind the existing
-- application-layer WHERE clauses + AsyncLocalStorage tenant scope.
--
-- Mode: AUDIT (fail-OPEN when no context is set, fail-CLOSED when context is set).
--
--   * Policy: USING (current_setting('app.current_tenant', true) IS NULL OR
--                    current_setting('app.current_tenant', true) = ''       OR
--                    tenant_id = current_setting('app.current_tenant')::int)
--
--   * If a connection does NOT set `app.current_tenant` (admin scripts, seeds,
--     migrations, nightly backups), all rows are visible — preserves backward
--     compatibility while we migrate every storage method.
--
--   * If a connection DOES set `app.current_tenant = N` (per `withTenantTx()`
--     in server/db.ts), Postgres itself rejects any row where tenant_id != N.
--     A coding bug that drops the app-layer WHERE clause CANNOT leak rows.
--
-- FORCE ROW LEVEL SECURITY is intentionally NOT set in this round — that would
-- also apply to the table owner (superuser), breaking seeds + admin scripts.
-- A future R-round will migrate all storage methods to use withTenantTx(), then
-- flip to FORCE on a per-table basis.
--
-- Idempotent: re-running this file is safe.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'memory_entries',
    'messages',
    'conversations',
    'file_storage',
    'message_feedback',
    'customers',
    'invoices',
    'leads',
    'contracts',
    'knowledge_entries',
    'agent_trace_spans',
    'mind_tickets',
    'agent_runs',
    'procedure_edits'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist (forward/backward compatibility)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'R120-RLS: table % does not exist, skipping', t;
      CONTINUE;
    END IF;

    -- Skip if table has no tenant_id column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'R120-RLS: table % has no tenant_id column, skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Drop & recreate so policy edits in future rounds are clean
    EXECUTE format('DROP POLICY IF EXISTS r120_tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY r120_tenant_isolation ON %I
      USING (
        current_setting('app.current_tenant', true) IS NULL
        OR current_setting('app.current_tenant', true) = ''
        OR tenant_id = current_setting('app.current_tenant')::int
      )
      WITH CHECK (
        current_setting('app.current_tenant', true) IS NULL
        OR current_setting('app.current_tenant', true) = ''
        OR tenant_id = current_setting('app.current_tenant')::int
      )
    $f$, t);

    RAISE NOTICE 'R120-RLS: enabled on %', t;
  END LOOP;
END $$;

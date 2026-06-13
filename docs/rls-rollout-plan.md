# Postgres RLS Rollout Plan (R120 → R12x)

## Why

Application-layer tenant isolation (`AsyncLocalStorage` + every storage query
filtering on `tenantId`) is the first line of defense. Postgres Row-Level
Security is the **second line of defense**: even if a future code edit drops
the WHERE clause, the database engine itself refuses to return rows that don't
match the active tenant context.

Gemini-3.5-Flash-Extended (2026-05-20 architecture review) flagged this as
the #2 highest-impact hardening idea after sandboxing. We agreed it's worth
doing.

## Phase 1 — R120 (this round) — AUDIT MODE

* RLS **ENABLED** on 14 highest-sensitivity tenant-scoped tables:
  `memory_entries`, `messages`, `conversations`, `file_storage`,
  `message_feedback`, `customers`, `invoices`, `leads`, `contracts`,
  `knowledge_entries`, `agent_trace_spans`, `mind_tickets`, `agent_runs`,
  `procedure_edits`.

* Policy is **fail-OPEN when no tenant context is set, fail-CLOSED when context
  is set**:

  ```sql
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR tenant_id = current_setting('app.current_tenant')::int
  )
  ```

* `FORCE ROW LEVEL SECURITY` is **NOT** set in Phase 1. The platform role is a
  superuser; FORCE would apply RLS to seeds, migrations, nightly backups, and
  admin scripts — all of which currently rely on bypassing tenant scope.

* New helper `withTenantTx(tenantId, fn)` in `server/db.ts` opens a transaction
  and runs `SET LOCAL app.current_tenant = N` before the caller's work. When
  called, all queries inside the txn get DB-level tenant filtering even if the
  app-layer WHERE is missing.

* Integration test `tests/security/rls-isolation.test.ts` proves cross-tenant
  reads return 0 rows when the wrong tenant context is set.

* No existing storage methods are migrated yet — the audit policy is
  intentionally permissive so the existing codebase keeps working.

## Phase 2 — R12x (next round) — STRICT-MODE OPT-IN

* `STRICT_RLS=1` env var: when set, the app boot wraps the pool in a
  per-request middleware that calls `withTenantTx()` for every API request
  with an authenticated tenant. Routes without a tenant (public landing pages,
  health checks) get an explicit no-context bypass.

* Migration script: convert the top 30 storage methods to use `withTenantTx()`
  explicitly so they continue working under STRICT.

* Production stays in AUDIT mode (`STRICT_RLS=0`) for the duration of Phase 2.
  Developers + CI run STRICT to surface any missed migrations.

## Phase 3 — R12y — FORCE PER TABLE

* Once every storage method on a given table is migrated, that table flips to
  `ALTER TABLE x FORCE ROW LEVEL SECURITY;`. Superuser bypass goes away for
  that table.

* Seeds + migrations switch to setting `app.current_tenant = 0` (a reserved
  admin sentinel) and a separate policy `r120_admin_bypass` checks for it.

* All 14 Phase 1 tables FORCE'd one at a time, with a 7-day soak between each.

## Phase 4 — R12z — EXPAND COVERAGE

* RLS extended from the 14 highest-sensitivity tables to all 116 tenant tables
  (out of 177 total — the rest are tenant-less reference data).

## Rollback procedure

Each phase is reversible:

```sql
-- Disable all R120 policies
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_policies WHERE policyname = 'r120_tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY r120_tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

## Decision log

* **Why permissive USING vs strict?** Strict (`tenant_id = current_setting...`
  with no IS NULL fallback) would have broken every admin script + the nightly
  memory backup + every seed during Phase 1. We'd have shipped a regression
  the same round we shipped the hardening.
* **Why not FORCE in Phase 1?** Same reason — FORCE applies to superusers, and
  every operator script + cron job + R119.2+sec admin backup runs as the
  superuser. Migrating all of those is a multi-round project.
* **Why these 14 tables?** They hold the highest-value cross-tenant data: PII
  (`customers`), money (`invoices`, `contracts`), conversation content
  (`messages`, `memory_entries`), and audit trails (`agent_trace_spans`).
* **Why not 60-table multi-tenant on first round?** Connascence — each table
  has its own storage methods, FK dependencies, and edge cases. Doing 14 first
  validates the pattern; expanding to 116 is mechanical after.

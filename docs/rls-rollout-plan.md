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

## ⚠️ CORRECTION (2026-06-17) — the superuser blind spot

The original plan assumed Phase 3 would "flip `FORCE ROW LEVEL SECURITY` on" to
make RLS enforce. **That premise is wrong.** The app logs in as the `postgres`
role, which is verified to be `rolsuper=t` AND `rolbypassrls=t`:

* **Postgres superusers and `BYPASSRLS` roles bypass RLS unconditionally.**
* `FORCE ROW LEVEL SECURITY` does **not** apply RLS to a superuser — it only
  makes RLS apply to the table *owner* (who would otherwise skip it for tables
  they own). A superuser is never subject to RLS no matter what FORCE says.

So as shipped, R120's policies filtered **zero** rows for our role — RLS was
readiness/documentation, not enforcement. (Empirically confirmed 2026-06-17:
under `postgres`, a context-set SELECT on `messages` returned all 596 rows.)

### The fix that actually enforces (R125) — no new connection string / secret

Run the request body under a dedicated **NOLOGIN, NOSUPERUSER, NOBYPASSRLS**
role. A superuser session that has `SET LOCAL ROLE visionclaw_rls` *is* subject
to RLS for the duration of that role, and because the role is not the table
owner the policy applies with **no FORCE needed**. `SET LOCAL` reverts on
COMMIT/ROLLBACK, so the pooled connection returns to `postgres` cleanly.

* Migration: `scripts/migrations/R125-rls-enforcement-role.sql` (creates the
  role + grants; also hardens the policy — see below).
* Wiring: `withTenantTx()` issues `SET LOCAL ROLE visionclaw_rls` when
  `RLS_ENFORCE=1` (default OFF → identical to today). Fail-CLOSED if the role
  is absent.
* Proof: `tests/security/rls-enforcement.test.ts` — under the role with a
  tenant context, a no-WHERE SELECT returns only that tenant's rows; the
  superuser still sees all rows.
* Empirically confirmed 2026-06-17: under `visionclaw_rls` with
  `app.current_tenant=8`, the same SELECT returned 2 rows, not 596.

### Policy bug fixed in the same migration

R120's `USING` clause did `tenant_id = current_setting('app.current_tenant')::int`.
On a pooled connection where the GUC had been set then reverted,
`current_setting(..., true)` returns `''` (not NULL), so the cast threw
`invalid input syntax for type integer: ""` instead of failing open. R125
rewrites it as `NULLIF(current_setting('app.current_tenant', true), '')::int`,
which collapses both `''` and NULL to NULL **before** the cast — same fail-open
semantics, no crash.

### Remaining work to enforce platform-wide

`SET LOCAL ROLE` only protects code that runs inside `withTenantTx()`. Turning
on `RLS_ENFORCE=1` for every request still needs the Phase-2 per-request
wrapper below (routing all storage through the tenant txn). Do that behind the
env flag in dev/CI first; production stays at the default (OFF) until the
storage layer is proven to run cleanly under the non-superuser role.

## Phase 1 — R120 (this round) — AUDIT MODE

* RLS **ENABLED** on 14 highest-sensitivity tenant-scoped tables:
  `memory_entries`, `messages`, `conversations`, `file_storage`,
  `message_feedback`, `customers`, `invoices`, `leads`, `contracts`,
  `knowledge_entries`, `agent_trace_spans`, `mind_tickets`, `agent_runs`,
  `procedure_edits`.

* Policy is **fail-OPEN when no tenant context is set, fail-CLOSED when context
  is set**:

  ```sql
  -- NOTE: hardened in R125 to NULLIF(...,'')::int — see the correction section
  -- above. The original form below crashed on an empty-string GUC.
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR tenant_id = current_setting('app.current_tenant')::int
  )
  ```

* `FORCE ROW LEVEL SECURITY` is **NOT** set in Phase 1. *(Historical note: the
  original rationale here — "FORCE would apply RLS to the superuser role" — was
  technically wrong. FORCE only affects the table OWNER; a superuser/BYPASSRLS
  role is never subject to RLS regardless of FORCE. See the correction section
  at the top. Enforcement comes from `SET LOCAL ROLE` to a non-superuser role,
  not from FORCE.)*

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

## Phase 3 — R12y — ENFORCE PLATFORM-WIDE

> **Superseded mechanism:** earlier drafts said this phase would
> `ALTER TABLE x FORCE ROW LEVEL SECURITY` to "remove superuser bypass." That
> does not work — FORCE never subjects a superuser to RLS. Enforcement instead
> comes from running request work under the non-superuser `visionclaw_rls` role
> (R125, `SET LOCAL ROLE` inside `withTenantTx`). FORCE is only relevant if/when
> tables are reassigned to a non-superuser OWNER; it is not on the critical path.

* Turn on `RLS_ENFORCE=1` only after every tenant-scoped request path routes
  through `withTenantTx()` (Phase 2). Until then, queries outside the helper run
  as `postgres` and bypass RLS — so a partial rollout gives a false sense of
  coverage.

* Add a strict-mode regression guard that fails if a tenant-scoped API path
  executes a query outside `withTenantTx()` — otherwise a missed migration is
  an invisible hole under enforcement.

* Seeds + migrations + nightly jobs keep using the `postgres` login role (they
  never `SET LOCAL ROLE`), so they retain full access without a sentinel tenant.

* Roll out `RLS_ENFORCE=1` to one environment at a time (dev → CI → staging →
  prod) with a soak between each.

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

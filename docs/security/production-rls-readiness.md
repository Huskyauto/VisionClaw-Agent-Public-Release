# Production RLS readiness — hold enforcement

## Decision and authority

**Owner-approved scope change:** Bob chose private app preparation instead of
continuing the production console workflow. See
[owner-only access](owner-only-access.md). Do not resume role provisioning or
ask Bob to repeat phone SQL steps without a new request. The original
production-readiness findings below remain a hold, not resolved enforcement.

**Not ready to activate.** This is a readiness investigation, not production
isolation clearance. No production writes, role/grant changes, configuration
changes, publication, migration scripts or startup DDL were performed.

Replit's official documentation identifies the **production Database SQL
console** as the manual administration path for objects Publish does not copy,
including custom roles and specific grants:

- https://docs.replit.com/features/data-and-storage/publish-database-changes
- https://docs.replit.com/features/data-and-storage/work-with-your-data
- https://docs.replit.com/help/troubleshooting/databases

Use that owner-controlled path only after Bob approves the exact target and
reviewed changes. The agent's production SQL inspection is a **read-only
replica**, not a production writer or the application's pool. Do not work around
that restriction with a production connection string, a deployment command,
a database dump, an automatic migration or an application startup repair.

## Evidence collected November 16, 2026

Catalog-only replica queries, without reading customer rows, reported:

| Check | Observed result | Boundary |
| --- | --- | --- |
| PostgreSQL version | 16.16 | Replica metadata only |
| Inspection session | `neondb_owner`, transaction read-only | Not proof of application login identity |
| Inspection role attributes | Not superuser; BYPASSRLS; CREATEROLE; LOGIN; INHERIT | Do not assume application privileges match |
| Enforcement role | `visionclaw_rls` absent | No membership or grant readiness established |
| Public tenant-bearing tables | 253 | Ordinary/partitioned tables with `tenant_id` |
| Tenant tables with RLS enabled | 14 | Not application-wide coverage |
| FORCE RLS | Off on those 14 tables | FORCE would not override BYPASSRLS |
| Policies | One `r120_tenant_isolation` per enabled table, permissive, PUBLIC, ALL | Policy names do not establish filtering |
| Policy expressions | All 14 have `polqual IS NULL` and `polwithcheck IS NULL` | Requires writer-side confirmation |

Access follow-up confirmed `pg_is_in_recovery() = true` and
`transaction_read_only = on`. A bounded connection-metadata query showed only
the inspection `psql` connection, not the app's pool. Replit's documented Agent
access is read-only; no supported Agent administration callback was found.
The owner could not locate the SQL console, so asking for query results is not
an actionable prerequisite yet. Use the direct Database-pane navigation and
identify the actual screen before requesting manual SQL. Documentation locates
the console under Production / My Data and describes an Enable Editing control
for live modifications; do not ask the owner to enable writes for these SELECTs
unless the interface explicitly requires it, and never imply it authorizes DDL.

The owner subsequently enabled editing, but another access check still reported
a read-only physical standby. The supplied mobile screenshot showed SQL entered
into saved-snippet search fields; “No snippets found” was not a query failure or
evidence of lost data. The owner asked for another approach rather than further
phone-console troubleshooting. No production SQL execution or provisioning by
the owner has been established. Continue independent development verification;
do not make manual phone SQL a recurring request or bypass the access boundary.

The last observation is stronger than an empty display field: explicit
`IS NULL` predicates returned true for both catalog fields. An ALL policy with
neither expression is unrestricted, including when tenant context is present.
Do not assume this replica representation proves the writer has the same
definitions; confirm there before deciding whether policy repair is required.
Do not report these policies as successfully filtering customer traffic.

The 14 tables were `agent_runs`, `agent_trace_spans`, `contracts`,
`conversations`, `customers`, `file_storage`, `invoices`, `memory_entries`,
`message_feedback`, `messages`, `mind_tickets`, `procedure_edits`,
`skill_optimization_candidates`, and `skill_optimization_versions`.

## Actual application authority is still unverified

`server/db.ts` builds its pool from `DATABASE_URL`. Workspace credentials and
replica `current_user` cannot prove which principal the published app uses.
The historical migration's assertion that the login is a `postgres`
superuser must not be applied to production without evidence.

Before provisioning, Bob must confirm the published app uses this managed
database and an operator must verify the connection principal through the
**actual application connection**, not merely a SQL-console/replica session.
Record role attributes, membership/SET eligibility, table ownership, effective
schema/table/sequence privileges, and configuration status. No connection
strings, passwords or other secrets should be copied into chat or this document.

For an operator with the supported production SQL console, these statements
are read-only. Run the identity query through the actual application connection
as well; a console result alone is not application identity proof.

```sql
SELECT current_user, session_user,
       current_setting('transaction_read_only') AS read_only,
       r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolinherit
FROM pg_roles r WHERE r.rolname = current_user;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
FROM pg_roles WHERE rolname = 'visionclaw_rls';

SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity, c.relforcerowsecurity, p.polname,
       p.polqual IS NULL AS using_is_null,
       p.polwithcheck IS NULL AS check_is_null,
       pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relrowsecurity
ORDER BY c.relname, p.polname;
```

## Existing transaction coverage, not whole-app enforcement

Source inspection found **20 invocation sites across seven modules**, excluding
the helper definition and documentation example:

| Module | Sites | Opted-in work |
| --- | ---: | --- |
| `server/agentic/heartbeat-repair-adapter.ts` | 1 | Heartbeat repair |
| `server/lib/harness-manifest.ts` | 2 | Addendum reads and manifest persistence |
| `server/lib/skill-evolution-lessons.ts` | 2 | Skill lesson reads/writes |
| `server/lib/skill-optimizer-promotion.ts` | 6 | Promotion/version lifecycle |
| `server/lib/reasoned-review-production.ts` | 3 | Review evidence reservations/finalization |
| `server/memory/forgetting-store.ts` | 5 | Selected forgetting/erasure/archive operations |
| `server/memory/unified-context.ts` | 1 | Selected context retrieval |

This is a source call-site inventory, not measured request coverage. Nested
helpers and their tables need tracing before granting privileges. Some opted-in
work touches tables outside the 14 enabled tables; using `withTenantTx` does
not create a policy on them. Other `db`, `pool`, storage and raw-query paths do
not automatically adopt this helper merely because they carry tenant ALS.

The helper validates a positive integer, starts a transaction, sets and reads
back transaction-local `app.current_tenant`, and only with `RLS_ENFORCE=1` runs
`SET LOCAL ROLE visionclaw_rls`. Missing role fails that transaction closed.
COMMIT/ROLLBACK should restore role and tenant context; actual pooled reuse
must be demonstrated rather than inferred from the SQL statements.

The intended R125 policy in the repository is also **deliberately permissive
when tenant context is NULL or empty**. Fixing the observed empty expressions
to match that policy would still not produce a fail-closed default.
The existing availability receipt checks policy names/coverage and role
eligibility, not policy expressions, effective DML grants or wrong-tenant
behavior. An `available` receipt alone must never authorize activation.

## Development pooled-transaction proof

`tests/integration/rls-pooled-transactions-db.test.ts` exercises the actual
`withTenantTx` helper and application pool, constrained to one backend in the
isolated test process. It reads the installed development policy from
`memory_entries` and applies that expression to a session-local temporary
fixture. It uses the already-provisioned development enforcement role; it
creates no roles or persistent tables/policies and touches no customer rows.
Closing the test session removes the fixture and its grants.

Explicit invocation (development only; never point this at production):

```sh
NODE_ENV=development RUN_RLS_POOL_DB=1 npx --no-install tsx --test \
  tests/integration/rls-pooled-transactions-db.test.ts
```

This is a test-process opt-in, not a new application flag or shared configuration.
Guards require explicit development mode, no deployment marker, a non-standby
writable connection, the expected superuser development login and an existing
non-login/non-superuser/non-bypass enforcement role.

Verified with synthetic tenants 1 and 2 on the same PostgreSQL backend:

- Unfiltered reads show only the active tenant.
- Own INSERT, UPDATE and DELETE succeed.
- Foreign UPDATE and DELETE return no rows.
- Foreign INSERT and changing an own row's tenant fail with SQLSTATE 42501.
- Callback failure rolls back writes.
- Role and tenant context reset after commits, rejected statements and callback
  failure; subsequent transactions serve the other tenant correctly.
- Original owner authority and fixture write access remain usable.
- **Negative control:** the existing policy permits both tenants' reads and a
  foreign-tenant insert when context is empty, even under the enforcement role.
  The insert is rolled back. This explicitly preserves the missing-context gap.

This proves the scoped development mechanism, not production readiness,
whole-app call-site coverage, or owner/customer login continuity.
The explicit development run passed with one test, zero failures and zero
skips. A scoped TypeScript check covering the new test and its imports passed.
No production application code was changed by this verification.

## Staged provisioning and proof gates — production steps not executed

1. **Owner/writer confirmation.** Confirm the managed target, actual application
   role/configuration and writer-side policy definitions. Keep Bob's existing
   login, owner binding, privileges and current enforcement setting unchanged.
2. **Review exact provisioning separately.** Propose a non-owner NOLOGIN,
   NOSUPERUSER, NOBYPASSRLS role, explicit SET membership for the actual app
   principal if required, and least-privilege schema/table/sequence access for
   the traced operations. Review functions/triggers and default privileges too.
   Do not replay the historical R125 file: it grants all public tables and
   sequences and changes default privileges. R126 also deliberately restricts
   optimizer table mutations, so a blanket grant could undo safeguards.
3. **Bob approves exact changes.** Provision only via the supported manual
   administration path. Role creation is not enforcement. Do not replace the
   default application login, enable a flag or change policies incidentally.
4. **Development proof first.** Through the real `withTenantTx` helper and a
   deliberately reused small pool, use synthetic A/B fixtures to prove:
   own-tenant reads/writes succeed; unfiltered reads exclude the other tenant;
   foreign UPDATE/DELETE affect zero rows; foreign INSERT and changing
   `tenant_id` fail; failed writes roll back; COMMIT and ROLLBACK both restore
   role/context before the same connection serves B or owner work. Pin missing
   context behavior explicitly as a remaining gap, not a successful denial.
   **Completed on the development fixture above; production remains unproved.**
5. **Production acceptance requires separate authority.** Repeat the agreed
   matrix through the actual deployed pool only after Bob approves scoped
   synthetic fixtures and their cleanup using a supported operational flow.
   Replica SELECTs cannot prove writer DML denial or pool reset. Do not reuse
   customer rows or run the existing DDL-creating test against production.
   Verify owner login/read/write continuity and representative customer flows.
6. **Activation is a later decision.** Retain exact tested source/policy/role
   evidence and review remaining unscoped paths and missing-context behavior.
   Only then discuss a limited activation with Bob. No recommendation for
   global enforcement follows from this investigation.

**Still blocked:** writer-side confirmation, actual application privileges,
owner approval of exact provisioning, and real pooled read/write/owner-access
acceptance evidence. This task is not complete.

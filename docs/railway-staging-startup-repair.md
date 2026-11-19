# Railway staging startup repair — prepared, not applied

## Scope and approval boundary

This is a standalone operator command for the isolated Railway staging app,
not a Replit production migration. Nothing invokes it during startup, builds,
or the existing automatic pre-deploy repair. Preparing or testing this code
does **not** authorize pushing it, applying it, changing settings, or restarting.

The command requires all of:

- `ISOLATED_STAGING=1`;
- project `47d2eeee-2890-4cf8-bf3b-4f6d19cd6d16`;
- environment `a9826904-c427-4fcf-a26f-6d4920f0e75e`;
- **app** service `2e0770cc-b23c-432f-8b94-7741c06c955b`;
- the app's database URL using `visionclaw-staging-db.railway.internal`,
  a nonempty database name, and PostgreSQL's default port.

Connection-string query/fragment overrides and unknown command flags are
rejected before any connection. Do not copy credentials into commands or
override these guards to run against the workspace or Replit production.

## Confirmed problem and remaining uncertainty

Railway's PostgreSQL logs reported undefined `tool_performance` and
`spark_outbox` relations during both the previous and current app startup.
Missing `spark_outbox` interrupts Felix connector initialization and subsequent
route registration. The public `/mcp/health` endpoint returned 404 even while
`/healthz` and the landing page returned 200. The process-only `/healthz` is
not an application-readiness test.

Direct catalog access was unavailable from the workspace: the database uses
Railway private networking and has no public TCP proxy. Therefore a catalog
check **inside the existing Railway app environment** is required before
applying anything. The command refuses a non-public active schema, target
relations found in another schema, unexpected existing columns/primary keys,
defaults, foreign keys, message-length checks, or incompatible named indexes.
Resolve those discrepancies instead of
creating duplicate tables or weakening grants.

## Reviewed execution sequence, after separate authorization

First deliver this reviewed script to Railway through a separately approved
source/deployment process. It is not yet installed in the running image.
In the **app service's** shell, using its existing environment:

```sh
node scripts/railway-staging-startup-repair.cjs --check
```

Omitting the flag also means `--check`. This uses a read-only transaction
and connection setting. Exit 0 means the inspected table/index contract is
present; exit 2 means additions are needed; exit 1 means a guard or database
operation failed. This is schema readiness, not proof that routes are mounted.

Only after reviewing that check and receiving permission to apply:

```sh
node scripts/railway-staging-startup-repair.cjs --apply
node scripts/railway-staging-startup-repair.cjs --check
```

Apply creates only missing `public.spark_outbox` / `public.tool_performance`
tables, the legacy Spark `recipient` column if needed, and six required indexes.
New tables include tenant foreign keys; Spark also retains its persona and
conversation references and message-length check. Tool performance gets an
automatic integer ID and a tenant/tool unique index because the existing
`trackToolExecution` writer omits the ID and upserts on `(tenant_id, tool_name)`.
Its orphan schema declaration only describes the integer column, not those
writer requirements; a literal copy of that incomplete declaration would
still break telemetry. Existing tables without these contracts are refused,
not silently altered or certified ready.
There are no grants, ownership changes, RLS changes, deletes, or drops.
Existing rows are retained. The one possible backfill is `recipient='spark'`.

A transaction, advisory lock, bounded statement/query/lock/connect timeouts,
and post-change catalog verification protect apply. Ordinary failures roll
back all additions. A lost commit acknowledgement is explicitly **uncertain**:
run `--check` before deciding whether to retry. There are no automatic retries.
After commit, leave additive objects in place rather than deleting potentially
used data as an automatic rollback.

After a **separately approved restart**, confirm:

1. No undefined-relation errors for these tables during the new startup.
2. `/mcp/health` returns its expected JSON, not 404 or an HTML fallback.
3. The route modules after MCP registration initialize successfully.
4. Authenticated affected paths retain their existing access controls.

Do not label the whole app healthy solely because `/healthz` returns 200.

## Local verification

The independent source review identified two new safety gaps: existing-table
defaults/constraints were insufficiently checked, and cleanup could mask an
uncertain commit/rollback result. Both were corrected and regression-tested.
It also identified the existing telemetry writer's automatic-ID/upsert contract,
which the prepared staging schema now supports. Forced cleanup retains deferred
client errors on the failed outcome rather than emitting an uncaught exception.
These corrections have local PostgreSQL evidence, not a second independent
review or live staging acceptance.

```sh
env -i PATH="$PATH" HOME="$HOME" \
  node --test tests/deployment/railway-staging-startup-repair.test.cjs
```

Tests require PostgreSQL `initdb`, `pg_ctl`, and `postgres`. They discover
installed binaries and start a temporary, small PostgreSQL cluster with only
a private Unix socket, no TCP listener, and no inherited application secrets.
They replay the actual Felix bootstrap and telemetry upsert SQL, verify tenant-scoped ranking reads,
target/argument guards, data-preserving repeat execution, transaction rollback,
schema/default/constraint/index refusal, legacy recipient backfill, uncertain
commit/rollback handling, and bounded cleanup even when connections fail.
They do not connect to either live database.

/**
 * R125 — Row-Level Security ENFORCEMENT (the Phase-3 proof R120 promised).
 *
 * R120 shipped RLS in audit-only mode because the app's login role (`postgres`)
 * is a superuser with BYPASSRLS — superusers bypass RLS entirely, so the
 * policies never filtered a row for our role. R125 closes that gap by running
 * the request body under a dedicated NOLOGIN, NOSUPERUSER, NOBYPASSRLS role via
 * `SET LOCAL ROLE` inside `withTenantTx()` (see server/db.ts, env-gated by
 * RLS_ENFORCE=1, and scripts/migrations/R125-rls-enforcement-role.sql).
 *
 * This test is HERMETIC: it builds its own throwaway table + role, proves the
 * mechanism end-to-end, and tears everything down in `finally`. It does NOT
 * depend on the migration having run, so it documents and pins the mechanism
 * independently of deploy state.
 *
 * It pins three properties:
 *   1. Under the non-superuser role + a tenant context, a cross-tenant SELECT
 *      returns ONLY that tenant's rows — even with NO WHERE clause.
 *   2. The hardened policy's NULLIF cast does NOT crash on an empty
 *      `app.current_tenant` (regression for the `''::int` bug in R120's policy).
 *   3. The `postgres` superuser still bypasses RLS (sees all rows) — confirming
 *      why the SET ROLE step is the thing that actually enforces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

test("R125 RLS enforcement — SET LOCAL ROLE + app.current_tenant blocks cross-tenant reads", async () => {
  if (!process.env.DATABASE_URL) {
    console.warn("[rls-enforce-test] DATABASE_URL missing — skipping");
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = `${process.pid}_${Date.now()}`;
  const tbl = `rls_enf_tbl_${suffix}`;
  const role = `rls_enf_role_${suffix}`;
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE ${tbl} (id serial PRIMARY KEY, tenant_id int NOT NULL, body text)`,
    );
    await client.query(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
    // Same hardened policy shape as R125-rls-enforcement-role.sql.
    await client.query(
      `CREATE POLICY p ON ${tbl}
         USING (
           NULLIF(current_setting('app.current_tenant', true), '') IS NULL
           OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int
         )`,
    );
    await client.query(
      `INSERT INTO ${tbl}(tenant_id, body) VALUES (1,'a'),(1,'b'),(2,'c')`,
    );
    await client.query(`DROP ROLE IF EXISTS ${role}`);
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await client.query(`GRANT SELECT ON ${tbl} TO ${role}`);

    // (1) tenant 1 sees only its 2 rows — no WHERE clause at all.
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.current_tenant', '1', true)`);
    const r1 = await client.query(`SELECT count(*)::int AS n FROM ${tbl}`);
    assert.equal(r1.rows[0].n, 2, "tenant 1 should see only its 2 rows");
    await client.query("ROLLBACK");

    // (1b) tenant 2 sees only its 1 row.
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.current_tenant', '2', true)`);
    const r2 = await client.query(`SELECT count(*)::int AS n FROM ${tbl}`);
    assert.equal(r2.rows[0].n, 1, "tenant 2 should see only its 1 row");
    await client.query("ROLLBACK");

    // (2) empty context under the role must NOT throw (''::int regression) and
    //     fails OPEN (preserves R120 audit semantics).
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.current_tenant', '', true)`);
    const r3 = await client.query(`SELECT count(*)::int AS n FROM ${tbl}`);
    assert.equal(
      r3.rows[0].n,
      3,
      "empty context fails open (NULLIF prevents the ''::int crash)",
    );
    await client.query("ROLLBACK");

    // (3) the superuser login role bypasses RLS entirely — sees all rows.
    const r4 = await client.query(`SELECT count(*)::int AS n FROM ${tbl}`);
    assert.equal(r4.rows[0].n, 3, "postgres superuser bypasses RLS (all rows)");
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    // DROP TABLE first so the role has no dependent grants blocking DROP ROLE.
    try {
      await client.query(`DROP TABLE IF EXISTS ${tbl}`);
    } catch {}
    try {
      await client.query(`DROP ROLE IF EXISTS ${role}`);
    } catch {}
    client.release();
    await pool.end();
  }
});

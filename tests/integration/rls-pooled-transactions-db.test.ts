/**
 * Explicit DEVELOPMENT-ONLY proof of the real application's transaction helper.
 * Creates only a session-local temporary table; never provisions roles or edits
 * application rows, persistent policies, credentials, or shared configuration.
 *
 * NODE_ENV=development RUN_RLS_POOL_DB=1 npx tsx --test \
 *   tests/integration/rls-pooled-transactions-db.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { pool, withTenantTx } from "../../server/db";

test("development pool isolates tenant reads/writes and restores owner authority on commit and rollback", {
  skip: process.env.RUN_RLS_POOL_DB !== "1",
  timeout: 30_000,
}, async () => {
  assert.equal(process.env.NODE_ENV, "development", "explicit development invocation required");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "never run on a deployment");
  assert.ok(process.env.DATABASE_URL, "development database required");

  const oldFlag = process.env.RLS_ENFORCE;
  // This affects only this test process. One actual application-pool connection
  // ensures every helper invocation must reuse the same PostgreSQL backend.
  (pool as typeof pool & { options: { max: number } }).options.max = 1;
  try {
    const { rows: [initial] } = await pool.query(`
      SELECT pg_backend_pid() AS pid, current_user AS role,
             pg_is_in_recovery() AS standby, r.rolsuper AS superuser,
             NULLIF(current_setting('app.current_tenant', true), '') AS tenant,
             current_setting('transaction_read_only') AS read_only
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    assert.equal(initial.standby, false, "refuse replica connections");
    assert.equal(initial.read_only, "off", "development writer required");
    assert.equal(initial.superuser, true, "expected development-only login privilege");
    assert.equal(initial.tenant, null, "fixture connection must start unscoped");

    const { rows: [role] } = await pool.query(`
      SELECT rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles WHERE rolname = 'visionclaw_rls'
    `);
    assert.ok(role, "development enforcement role must already be provisioned");
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.equal(role.rolcanlogin, false);

    // Reuse the actual installed development policy, not an invented strict
    // replacement. The fixture has the same tenant_id type as its source.
    const { rows: [policy] } = await pool.query(`
      SELECT pg_get_expr(polqual, polrelid) AS read_filter,
             pg_get_expr(polwithcheck, polrelid) AS write_filter
      FROM pg_policy
      WHERE polrelid = 'public.memory_entries'::regclass
        AND polname = 'r120_tenant_isolation'
    `);
    assert.ok(policy?.read_filter && policy?.write_filter, "real policy expressions required");
    await pool.query(`
      CREATE TEMP TABLE rls_pool_proof (
        id integer PRIMARY KEY, tenant_id integer NOT NULL, body text NOT NULL
      )
    `);
    await pool.query("ALTER TABLE pg_temp.rls_pool_proof ENABLE ROW LEVEL SECURITY");
    // Both expressions come exclusively from the server-owned catalog above.
    await pool.query(`CREATE POLICY fixture_policy ON pg_temp.rls_pool_proof
      USING (${policy.read_filter}) WITH CHECK (${policy.write_filter})`);
    await pool.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON pg_temp.rls_pool_proof TO visionclaw_rls",
    );
    await pool.query("INSERT INTO pg_temp.rls_pool_proof VALUES (1, 1, 'owner'), (2, 2, 'customer')");

    const ownerState = async () => {
      const { rows: [state] } = await pool.query(`
        SELECT pg_backend_pid() AS pid, current_user AS role,
               NULLIF(current_setting('app.current_tenant', true), '') AS tenant
      `);
      assert.equal(state.pid, initial.pid, "proof must reuse the exact backend");
      assert.equal(state.role, initial.role, "owner role must be restored");
      assert.equal(state.tenant, null, "tenant context must not survive checkout");
    };
    const scopedState = async (tx: any, tenant: number) => {
      const { rows: [state] } = await tx.execute(sql`
        SELECT pg_backend_pid() AS pid, current_user AS role,
               current_setting('app.current_tenant', true) AS tenant
      `);
      assert.equal(state.pid, initial.pid);
      assert.equal(state.role, "visionclaw_rls");
      assert.equal(state.tenant, String(tenant));
    };
    const visibleTenants = async (tx: any) => {
      const result = await tx.execute(sql`SELECT tenant_id FROM pg_temp.rls_pool_proof ORDER BY id`);
      return result.rows.map((row: { tenant_id: number }) => row.tenant_id);
    };

    process.env.RLS_ENFORCE = "1";
    for (const tenant of [1, 2]) {
      const foreign = tenant === 1 ? 2 : 1;
      await withTenantTx(tenant, async (tx) => {
        await scopedState(tx, tenant);
        assert.deepEqual(await visibleTenants(tx), [tenant], "unfiltered SELECT must isolate");
        const updated = await tx.execute(sql`
          UPDATE pg_temp.rls_pool_proof SET body = 'forbidden'
          WHERE tenant_id = ${foreign} RETURNING id
        `);
        assert.equal(updated.rows.length, 0, "foreign UPDATE must affect zero rows");
        const deleted = await tx.execute(sql`
          DELETE FROM pg_temp.rls_pool_proof WHERE tenant_id = ${foreign} RETURNING id
        `);
        assert.equal(deleted.rows.length, 0, "foreign DELETE must affect zero rows");
        const own = await tx.execute(sql`
          UPDATE pg_temp.rls_pool_proof SET body = 'own update'
          WHERE tenant_id = ${tenant} RETURNING id
        `);
        assert.equal(own.rows.length, 1, "own UPDATE must succeed");
        await tx.execute(sql`
          INSERT INTO pg_temp.rls_pool_proof VALUES (${10 + tenant}, ${tenant}, 'own insert')
        `);
        const removed = await tx.execute(sql`
          DELETE FROM pg_temp.rls_pool_proof WHERE id = ${10 + tenant} RETURNING id
        `);
        assert.equal(removed.rows.length, 1, "own INSERT/DELETE must succeed");
      });
      await ownerState();

      for (const statement of [
        sql`INSERT INTO pg_temp.rls_pool_proof VALUES (${10 + tenant}, ${foreign}, 'forbidden')`,
        sql`UPDATE pg_temp.rls_pool_proof SET tenant_id = ${foreign} WHERE tenant_id = ${tenant}`,
      ]) {
        await assert.rejects(withTenantTx(tenant, async (tx) => {
          await scopedState(tx, tenant);
          await tx.execute(statement);
        }), (error: any) => error.code === "42501" || error.cause?.code === "42501");
        await ownerState();
      }
      await assert.rejects(withTenantTx(tenant, async (tx) => {
        await tx.execute(sql`
          INSERT INTO pg_temp.rls_pool_proof VALUES (${20 + tenant}, ${tenant}, 'rolled back')
        `);
        throw new Error("deliberate fixture rollback");
      }), /deliberate fixture rollback/);
      await ownerState();
      const { rows: [rolledBack] } = await pool.query(
        "SELECT count(*)::int AS n FROM pg_temp.rls_pool_proof WHERE id = $1", [20 + tenant],
      );
      assert.equal(rolledBack.n, 0, "callback failure must roll back own writes");
    }

    // Negative control: the existing policy is permissive without context,
    // even under the non-bypass role. Pin the gap, do not call this clearance.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE visionclaw_rls");
      await client.query("SELECT set_config('app.current_tenant', '', true)");
      const { rows } = await client.query("SELECT tenant_id FROM pg_temp.rls_pool_proof ORDER BY id");
      assert.deepEqual(rows.map(row => row.tenant_id), [1, 2]);
      const unchecked = await client.query(
        "INSERT INTO pg_temp.rls_pool_proof VALUES (99, 2, 'missing context') RETURNING id",
      );
      assert.equal(unchecked.rows.length, 1, "missing context also permits writes");
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    await ownerState();
    const { rows: [ownerWrite] } = await pool.query(`
      UPDATE pg_temp.rls_pool_proof SET body = 'owner still works'
      WHERE id = 1 RETURNING body
    `);
    assert.equal(ownerWrite.body, "owner still works");
    const { rows: [final] } = await pool.query("SELECT count(*)::int AS n FROM pg_temp.rls_pool_proof");
    assert.equal(final.n, 2, "neither tenant fixture was lost");
  } finally {
    if (oldFlag === undefined) delete process.env.RLS_ENFORCE;
    else process.env.RLS_ENFORCE = oldFlag;
    // Closing the one test session destroys the temporary table, its policy,
    // and grants even after an assertion failure; no persistent DDL to undo.
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import { autoApplyEligibleInsights } from "../../server/agentic-engines";

test("real insight SQL applies only the authorized tenant; fixtures always roll back", async () => {
  const rollback = new Error("isolation-fixture-rollback");
  const originalExecute = db.execute;
  let verified = false;
  try {
    await db.transaction(async tx => {
      const suffix = randomUUID();
      const owners: any = await tx.execute(sql`
        INSERT INTO tenants (email, name)
        VALUES (${`isolation-a-${suffix}@example.invalid`}, 'Isolation fixture A'),
               (${`isolation-b-${suffix}@example.invalid`}, 'Isolation fixture B')
        RETURNING id
      `);
      const [a, b] = owners.rows;
      await tx.execute(sql`
        INSERT INTO ai_insights (tenant_id, engine_type, category, title, summary, priority, status)
        VALUES (${a.id}, 'optimization', 'scheduling_optimization', 'Fixture A', 'Isolation test', 'low', 'new'),
               (${b.id}, 'optimization', 'scheduling_optimization', 'Fixture B', 'Isolation test', 'low', 'new')
      `);
      // This process alone uses the transaction, so fixtures never become visible
      // to the application's background workers. Low priority cannot route an LLM.
      db.execute = tx.execute.bind(tx) as typeof db.execute;
      try {
        assert.equal(await autoApplyEligibleInsights(a.id), 1);
      } finally {
        db.execute = originalExecute;
      }
      const result: any = await tx.execute(sql`
        SELECT tenant_id, status FROM ai_insights WHERE tenant_id IN (${a.id}, ${b.id})
      `);
      assert.equal(result.rows.find((r: any) => r.tenant_id === a.id)?.status, "applied");
      assert.equal(result.rows.find((r: any) => r.tenant_id === b.id)?.status, "new");
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    db.execute = originalExecute;
  }
  assert.equal(verified, true);
});

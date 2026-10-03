import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import {
  getProjectCompass,
  ProjectCompassConflictError,
  replaceProjectCompass,
} from "../../server/project-compass";

test("Project Compass reads and writes stay tenant-scoped and stale revisions fail closed", async () => {
  const marker = `compass-${process.pid}-${Date.now()}`;
  let tenantA = 0;
  let tenantB = 0;
  try {
    const tenants = await db.execute(sql`
      INSERT INTO tenants (email, name)
      VALUES (${`${marker}-a@example.invalid`}, 'Compass A'), (${`${marker}-b@example.invalid`}, 'Compass B')
      RETURNING id
    `);
    [tenantA, tenantB] = ((tenants as any).rows || tenants).map((row: any) => Number(row.id));
    const projectResult = await db.execute(sql`
      INSERT INTO projects (name, description, tenant_id)
      VALUES ('Compass isolation project', '', ${tenantA})
      RETURNING id
    `);
    const projectId = Number(((projectResult as any).rows || projectResult)[0].id);

    const created = await replaceProjectCompass(projectId, tenantA, 0, [{
      id: "goal-1",
      category: "goal",
      statement: "Keep the tenant boundary intact",
      provenance: "user_stated",
      confidence: 1,
      status: "confirmed",
    }]);
    assert.equal(created?.revision, 1);
    assert.equal((await getProjectCompass(projectId, tenantA))?.entries.length, 1);
    assert.equal(await getProjectCompass(projectId, tenantB), null);
    assert.equal(await replaceProjectCompass(projectId, tenantB, 0, []), null);
    await assert.rejects(
      replaceProjectCompass(projectId, tenantA, 0, []),
      ProjectCompassConflictError,
    );
  } finally {
    if (tenantA || tenantB) {
      await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA || -1}, ${tenantB || -1})`);
    }
    await pool.end();
  }
});
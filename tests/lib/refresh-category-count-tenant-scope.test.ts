// Category aggregates are tenant boundaries: both the counted rows and the
// updated category must belong to the caller's tenant.
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import { refreshCategoryCount } from "../../server/memory-graph";

const OWNER_TENANT = 910001;
const OTHER_TENANT = 910002;
const PREFIX = "__refresh_category_count_test__";

async function wipeTestRows() {
  await db.execute(sql`DELETE FROM memory_entries WHERE fact LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM memory_categories WHERE name LIKE ${PREFIX + "%"}`);
}

async function insertCategory(tenantId: number, suffix: string): Promise<number> {
  const result: any = await db.execute(sql`
    INSERT INTO memory_categories (name, tenant_id, memory_count)
    VALUES (${PREFIX + suffix}, ${tenantId}, 99)
    RETURNING id
  `);
  return ((result.rows || result) as any[])[0].id;
}

async function insertMemory(categoryId: number, tenantId: number, status = "active") {
  await db.execute(sql`
    INSERT INTO memory_entries (fact, category, source, status, tenant_id, category_id)
    VALUES (${PREFIX + categoryId + "-" + tenantId + "-" + status}, 'preference', 'test', ${status}, ${tenantId}, ${categoryId})
  `);
}

before(wipeTestRows);
afterEach(wipeTestRows);
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref(); });

test("refreshCategoryCount only counts and updates the requested tenant", async () => {
  const ownerCategory = await insertCategory(OWNER_TENANT, "owner");
  const otherCategory = await insertCategory(OTHER_TENANT, "other");
  await insertMemory(ownerCategory, OWNER_TENANT);
  await insertMemory(ownerCategory, OTHER_TENANT); // malformed cross-tenant row must not leak into owner count
  await insertMemory(ownerCategory, OWNER_TENANT, "archived");

  await refreshCategoryCount(ownerCategory, OWNER_TENANT);

  const result: any = await db.execute(sql`
    SELECT id, memory_count FROM memory_categories WHERE id IN (${ownerCategory}, ${otherCategory}) ORDER BY id
  `);
  const categories = (result.rows || result) as any[];
  const owner = categories.find(c => c.id === ownerCategory);
  const other = categories.find(c => c.id === otherCategory);
  assert.equal(owner.memory_count, 1, "only active entries owned by this tenant are counted");
  assert.equal(other.memory_count, 99, "another tenant's category is never updated");
});
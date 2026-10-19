import test, { after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { getDeliveryOutcomeCounts } from "../../server/agentic/outcome-audit";

after(async () => { await pool.end(); });

test("real PostgreSQL: only same-tenant complete durable receipts count; failures and unknown proof stay visible", async t => {
  await db.transaction(async tx => {
    // Connection-local shadows: no public data is read or mutated by this test.
    await tx.execute(sql`CREATE TEMP TABLE delivery_logs (
      id int, tenant_id int, status text NOT NULL, drive_file_id text,
      shareable_link text, download_link text, folder_link text, created_at timestamp
    ) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE artifact_records (
      tenant_id int, delivery_log_id int, drive_file_id text, status text
    ) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO delivery_logs VALUES
      (1,42,'completed','a','view','download','folder',NOW()),
      (2,42,'completed','b','view','download','folder',NOW()),
      (3,42,'failed',NULL,NULL,NULL,NULL,NOW()),
      (4,42,'pending',NULL,NULL,NULL,NULL,NOW()),
      (5,43,'completed','c','view','download','folder',NOW()),
      (6,42,'completed','d','view','download','folder',NOW()),
      (7,42,'completed','old','view','download','folder',NOW() - INTERVAL '100 days'),
      (8,42,'completed','empty','','download','folder',NOW()),
      (9,42,'completed','null-status','view','download','folder',NOW())`);
    await tx.execute(sql`INSERT INTO artifact_records VALUES
      (42,1,'a','durable'), (42,1,'a-companion-1','durable'), (42,1,'a-companion-2','durable'),
      (43,2,'b','durable'),
      (43,5,'c','durable'), (42,6,'d','durable'), (42,6,'companion','failed'),
      (42,7,'old','durable'), (42,8,'empty','durable'),
      (42,9,'null-status','durable'), (42,9,'companion',NULL)`);
    const mock = t.mock.method(db, "execute", tx.execute.bind(tx));
    try {
      // A three-file package is ONE delivery, never three outcomes.
      assert.deepEqual(await getDeliveryOutcomeCounts(42, 7), {
        total: 7, receiptBacked: 1, completedUnverified: 4, failed: 1, pending: 1,
      });
      assert.deepEqual(await getDeliveryOutcomeCounts(43, 7), {
        total: 1, receiptBacked: 1, completedUnverified: 0, failed: 0, pending: 0,
      });
      await assert.rejects(getDeliveryOutcomeCounts(0, 7), /Invalid/);
      await assert.rejects(getDeliveryOutcomeCounts(42, NaN), /Invalid/);
      await assert.rejects(getDeliveryOutcomeCounts(42, 91), /Invalid/);
    } finally { mock.mock.restore(); }
  });
});

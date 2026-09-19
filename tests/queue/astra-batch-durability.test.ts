import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";

import { db } from "../../server/db";
import {
  claimDueJobs,
  enqueueUniqueJob,
  reclaimExpiredLeases,
} from "../../server/job-queue";
import { recordCost } from "../../server/agentic/cost-ledger";

const KIND = "__test_astra_report_batch__";

test("concurrent Astra Batch enqueue creates one durable job and stale lease recovery reuses it", async (t) => {
  const dedupeKey = `order-${Date.now()}-${Math.random()}`;
  t.after(async () => {
    await db.execute(sql`DELETE FROM agent_jobs WHERE kind = ${KIND} AND payload->>'dedupeKey' = ${dedupeKey}`);
  });

  const ids = await Promise.all(Array.from({ length: 8 }, () => enqueueUniqueJob(
    KIND,
    dedupeKey,
    { tenantId: 1, input: { tenantId: 1 }, batch: { phase: "claimed", submissionKey: dedupeKey } },
    { tenantId: 1, maxAttempts: 10 },
  )));
  assert.equal(new Set(ids).size, 1);

  const jobId = ids[0];
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'running', attempts = 1, lease_until = NOW() - INTERVAL '1 second'
    WHERE id = ${jobId} AND tenant_id = 1
  `);
  assert.equal(await reclaimExpiredLeases(), 1);
  await db.execute(sql`UPDATE agent_jobs SET next_run_at = NOW() WHERE id = ${jobId} AND tenant_id = 1`);
  const reclaimed = (await claimDueJobs(20, 60_000)).find((job) => job.id === jobId);
  assert.ok(reclaimed);
  assert.equal(reclaimed?.payload.batch.submissionKey, dedupeKey);
  assert.equal(reclaimed?.attempts, 2);
});

test("Astra Batch accounting idempotency creates exactly one tenant ledger row", async (t) => {
  const key = `test-astra-cost-${Date.now()}-${Math.random()}`;
  t.after(async () => {
    await db.execute(sql`
      DELETE FROM agent_cost_ledger
      WHERE tenant_id = 1 AND idempotency_key = ${key}
    `);
  });
  const params = {
    tenantId: 1,
    toolName: "astra_report_batch",
    model: "gpt-6-astra:flex",
    tokensIn: 100,
    tokensOut: 20,
    operation: "batch_response",
    idempotencyKey: key,
  };
  assert.equal(await recordCost(params), true);
  assert.equal(await recordCost(params), true);
  const result: any = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM agent_cost_ledger
    WHERE tenant_id = 1 AND idempotency_key = ${key}
  `);
  assert.equal(Number((result.rows || result)[0].count), 1);
});
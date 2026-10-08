// Manual retries must only revive jobs that did not complete successfully.
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import { getJobTenantForAdmin, retryJob } from "../../server/job-queue";

const KIND_PREFIX = "__retry_job_state_test__";
const TENANT_A = 940001;
const TENANT_B = 940002;

async function wipeTestRows() {
  await db.execute(sql`DELETE FROM agent_jobs WHERE kind LIKE ${KIND_PREFIX + "%"}`);
}

async function insertTestJob(
  status: "succeeded" | "failed_terminal" | "cancelled",
  tenantId = TENANT_A,
): Promise<number> {
  const result: any = await db.execute(sql`
    INSERT INTO agent_jobs (kind, payload, tenant_id, status, attempts, max_attempts, completed_at, next_run_at)
    VALUES (${KIND_PREFIX + status}, '{}'::jsonb, ${tenantId}, ${status}, 3, 3, NOW(), NOW())
    RETURNING id
  `);
  return ((result.rows || result) as any[])[0].id;
}

async function getJob(id: number): Promise<any> {
  const result: any = await db.execute(sql`
    SELECT status, attempts, completed_at FROM agent_jobs WHERE id = ${id}
  `);
  return ((result.rows || result) as any[])[0];
}

before(wipeTestRows);
afterEach(wipeTestRows);
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref(); });

test("retryJob leaves succeeded work terminal and reports that no retry occurred", async () => {
  const id = await insertTestJob("succeeded");

  const retried = await retryJob(id, TENANT_A);

  assert.equal(retried, false);
  const job = await getJob(id);
  assert.equal(job.status, "succeeded");
  assert.equal(job.attempts, 3);
  assert.ok(job.completed_at, "successful completion remains recorded");
});

test("retryJob still revives terminal failures and cancelled jobs", async () => {
  for (const status of ["failed_terminal", "cancelled"] as const) {
    const id = await insertTestJob(status);

    assert.equal(await retryJob(id, TENANT_A), true, `${status} should remain manually retryable`);
    const job = await getJob(id);
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 0);
    assert.equal(job.completed_at, null);
  }
});

test("retryJob cannot revive another tenant's terminal job", async () => {
  const id = await insertTestJob("failed_terminal", TENANT_A);

  assert.deepEqual(await getJobTenantForAdmin(id), { tenantId: TENANT_A });
  assert.equal(await retryJob(id, TENANT_B), false);
  assert.equal((await getJob(id)).status, "failed_terminal");

  assert.equal(await retryJob(id, TENANT_A), true);
  assert.equal((await getJob(id)).status, "pending");
});
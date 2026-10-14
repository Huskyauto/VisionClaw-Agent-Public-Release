import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resumePendingApprovalRuns } from "../../server/agentic/resume-worker";

const dialect = new PgDialect();
const old = new Date(Date.now() - 3600000).toISOString();

function harness(row: Record<string, unknown>, allowWrite = true) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const database = {
    async execute(query: Parameters<typeof dialect.sqlToQuery>[0]) {
      const compiled = dialect.sqlToQuery(query);
      if (compiled.sql.trimStart().startsWith("SELECT")) return { rows: [row] };
      writes.push(compiled);
      // Model a competing completion/lease renewal that wins the CAS.
      return { rows: allowWrite ? [{ id: row.run_id }] : [] };
    },
  };
  return { writes, database: database as Parameters<typeof resumePendingApprovalRuns>[0] };
}

test("expired claim records uncertainty without stopping a live worker or clearing its claim", async () => {
  const h = harness({ run_id: 41, tenant_id: 2, run_status: "running",
    resume_claimed_at: old, resume_lease_until: old });
  const result = await resumePendingApprovalRuns(h.database);
  assert.equal(result.reviewRequired, 1);
  assert.equal(h.writes.length, 1);
  const write = h.writes[0];
  assert.doesNotMatch(write.sql.split("WHERE")[0], /SET status|status =|completed_at|error =|-\s*'resumeClaimedAt'/);
  assert.match(write.sql, /tenant_id = \$\d+/);
  assert.match(write.sql, /AND status = 'running'/);
  assert.match(write.sql, /resumeClaimedAt' = \$\d+/);
  assert.match(write.sql, /resumeLeaseUntil' IS NOT DISTINCT FROM/);
  assert.match(write.sql, /restartRecovery'->>'interruptedClaimAt' IS DISTINCT FROM/);
  assert.ok(write.params.includes(2));
  assert.ok(write.params.some(p => typeof p === "string" && p.includes('"replayed":false')));
});

test("a live foreign lease or completed run causes no recovery writes", async () => {
  for (const row of [
    { run_status: "running", resume_lease_until: new Date(Date.now() + 60000).toISOString() },
    { run_status: "completed", resume_lease_until: old },
  ]) {
    const h = harness({ run_id: 42, tenant_id: 2, resume_claimed_at: old, ...row });
    assert.equal((await resumePendingApprovalRuns(h.database)).orphaned, 0);
    assert.equal(h.writes.length, 0);
  }
});

test("a competing terminal mutation is not counted as recovered", async () => {
  const h = harness({ run_id: 43, tenant_id: 2, run_status: "running",
    resume_claimed_at: old, resume_lease_until: old }, false);
  assert.equal((await resumePendingApprovalRuns(h.database)).reviewRequired, 0);
});

test("offline approval waits for a live waiter, then preserves its original identity", async () => {
  const row = { run_id: 44, tenant_id: 2, run_status: "paused",
    resume_claimed_at: null, approval_id: 9, approval_status: "approved" };
  const recent = harness({ ...row, decided_at: new Date() });
  assert.equal((await resumePendingApprovalRuns(recent.database)).orphaned, 0);
  assert.equal(recent.writes.length, 0);
  const expired = harness({ ...row, decided_at: old });
  assert.equal((await resumePendingApprovalRuns(expired.database)).orphaned, 1);
  assert.match(expired.writes[0].sql, /pendingApprovalId' = \$\d+/);
  assert.ok(expired.writes[0].params.some(p => typeof p === "string" && p.includes('"lastApprovalId":9')));
});

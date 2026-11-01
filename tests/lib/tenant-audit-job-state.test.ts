import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { auditJobIdentity, auditJobState, continueAuditJob, deferAuditCapacity, recordAuditFailure, backoffAuditJob } from "../../server/lib/tenant-audit-job-state";

test("standalone runs do not acquire scheduled job authority", async () => {
  assert.equal(auditJobIdentity({}), null);
  assert.throws(() => auditJobIdentity({ TENANT_AUDIT_JOB_ID: "3" }), /authority/);
  assert.throws(() => auditJobIdentity({ TENANT_AUDIT_JOB_ID: "3x", TENANT_AUDIT_JOB_ATTEMPT: "1" }), /authority/);
  assert.equal(await auditJobState(undefined, undefined, null, async () => { throw Error("must not query"); }), undefined);
});
test("cancelled, wrong-tenant or reclaimed claims cannot read/write checkpoints", async () => {
  const dialect = new PgDialect();
  for (const value of [undefined, { sourceHash: "saved", completed: {} }]) {
    await assert.rejects(() => auditJobState("auditCheckpoint", value, { id: 9, attempt: 2 }, async query => {
      const compiled = dialect.sqlToQuery(query);
      assert.match(compiled.sql, /tenant_id=1/);
      assert.match(compiled.sql, /kind='tenant_isolation_audit'/);
      assert.match(compiled.sql, /status='running'/);
      assert.match(compiled.sql, /attempts=\$/);
      assert.match(compiled.sql, /lease_until > now\(\)/);
      assert.ok(compiled.params.includes(9));
      assert.ok(compiled.params.includes(2));
      return { rows: [] }; // models every fence mismatch, not a fake live tenant
    }), /lease lost/);
  }
});
test("retained exact checkpoints survive processes and completed writes are awaited", async () => {
  const checkpoint = { sourceHash: "exact-source", completed: { 0: [] } };
  const restored = await auditJobState("auditCheckpoint", undefined, { id: 9, attempt: 2 },
    async () => ({ rows: [{ payload: { auditCheckpoint: checkpoint } }] }));
  assert.deepEqual(restored, checkpoint);
  await assert.rejects(() => auditJobState("auditCheckpoint", checkpoint, { id: 9, attempt: 2 },
    async () => { throw Error("database unavailable"); }), /database unavailable/);
});
test("real-work continuation requires a live claim and never decrements the attempt fence", async () => {
  await assert.rejects(() => continueAuditJob({ id: 9, attempt: 2 }, async query => {
    const compiled = new PgDialect().sqlToQuery(query);
    assert.match(compiled.sql, /kind='tenant_isolation_audit'/);
    assert.match(compiled.sql, /lease_until > now\(\)/);
    assert.doesNotMatch(compiled.sql.split("WHERE")[0], /attempts\s*=/);
    return { rows: [] };
  }), /continuation fenced/);
});
test("pre-work capacity deferral also checks kind and live lease", async () => {
  await assert.rejects(() => deferAuditCapacity({ id: 9, attempt: 2 }, async query => {
    const compiled = new PgDialect().sqlToQuery(query);
    assert.match(compiled.sql, /tenant_id=1/);
    assert.match(compiled.sql, /kind='tenant_isolation_audit'/);
    assert.match(compiled.sql, /lease_until > now\(\)/);
    return { rows: [] };
  }), /capacity deferral fenced/);
});
test("third real failure is a stop, never permission for 384 provider retries", async () => {
  for (const failures of [1, 2])
    await recordAuditFailure({ id: 9, attempt: 40 }, async () => ({ rows: [{ failures }] }));
  await assert.rejects(() => recordAuditFailure({ id: 9, attempt: 40 },
    async () => ({ rows: [{ failures: 3 }] })), /stopped after three failures/);
});

test("provider recovery has fenced exponential backoff and never refunds real attempts", async () => {
  let count = 0;
  await backoffAuditJob({ id: 9, attempt: 4 }, async query => {
    count++;
    const { sql: text, params } = new PgDialect().sqlToQuery(query);
    assert.match(text, /tenant_id=1/);
    assert.match(text, /kind='tenant_isolation_audit'/);
    assert.match(text, /status='running'/);
    assert.match(text, /lease_until > now\(\)/);
    assert.match(text, /LEAST\(3600,300\*power/);
    assert.doesNotMatch(text.split("WHERE")[0], /attempts\s*=/);
    assert.ok(params.includes(9) && params.includes(4));
    return { rows: [{ id: 9 }] };
  });
  assert.equal(count, 1);
  await assert.rejects(() => backoffAuditJob({ id: 9, attempt: 4 },
    async () => ({ rows: [] })), /recovery fenced/);
});

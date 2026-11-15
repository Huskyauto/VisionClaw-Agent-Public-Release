import test from "node:test";
import assert from "node:assert/strict";
import { auditScheduleDecision, auditCarryForward, auditDailyChunkTarget, auditWeekWindow } from "../../server/lib/tenant-audit-schedule-policy";
import { claimAuditDailyBatch } from "../../server/lib/tenant-audit-job-state";
import { PgDialect } from "drizzle-orm/pg-core";

test("one complete weekly campaign covers its week, not just its completion day", () => {
  const job = { status: "succeeded", createdAt: "2026-11-09T01:00:00Z",
    window: "2026-11-09", sourceHash: "same", complete: true };
  assert.deepEqual(auditScheduleDecision(new Date("2026-11-12T10:00:00Z"), [job], "same"),
    { window: "2026-11-09", enqueue: false, warning: null });
  assert.equal(auditScheduleDecision(new Date("2026-11-16T00:00:00Z"), [job], "same").enqueue, true);
});

test("daily admission serializes across jobs and defers a consumed day without losing progress", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const store = async (work: (execute: (query: any) => Promise<any>) => Promise<boolean>) =>
    work(async query => {
      const compiled = new PgDialect().sqlToQuery(query);
      calls.push(compiled);
      if (compiled.sql.includes("SELECT id FROM agent_jobs")) return { rows: [{ id: 12 }] };
      return { rows: [{ id: 9 }] };
    });
  assert.equal(await claimAuditDailyBatch({ id: 9, attempt: 3 }, store), false);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[1].sql, /tenant_id=1/);
  assert.match(calls[1].sql, /auditBatchDay/);
  const deferred = calls[2].sql;
  assert.match(deferred, /status='pending'/);
  assert.match(deferred, /AT TIME ZONE 'UTC'/);
  assert.match(deferred, /attempts=\$/);
  assert.match(deferred, /lease_until > now\(\)/);
  assert.doesNotMatch(deferred, /payload=|attempts=GREATEST|auditCheckpoint/);
});

test("new daily reservation is fenced and never refunds a real attempt", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const store = async (work: (execute: (query: any) => Promise<any>) => Promise<boolean>) =>
    work(async query => {
      const q = new PgDialect().sqlToQuery(query); calls.push(q);
      return { rows: q.sql.includes("SELECT id FROM agent_jobs") ? [] : [{ id: 9 }] };
    });
  assert.equal(await claimAuditDailyBatch({ id: 9, attempt: 3 }, store), true);
  assert.match(calls[2].sql, /auditBatchDay/);
  assert.match(calls[2].sql, /auditSlices/);
  assert.match(calls[2].sql, /status='running'/);
  assert.match(calls[2].sql, /lease_until > now\(\)/);
  assert.ok(calls[2].params.includes(3));
  assert.doesNotMatch(calls[2].sql, /attempts=GREATEST/);
});

test("planned daily wait is not a stall; overdue campaigns cannot overlap a fresh week", () => {
  const job = { status: "pending", createdAt: "2026-11-09T01:00:00Z",
    window: "2026-11-09", nextRunAt: "2026-11-13T00:00:00Z" };
  assert.deepEqual(auditScheduleDecision(new Date("2026-11-12T10:00:00Z"), [job]),
    { window: "2026-11-09", enqueue: false, warning: "batch_scheduled" });
  assert.deepEqual(auditScheduleDecision(new Date("2026-11-16T10:00:00Z"), [job]),
    { window: "2026-11-16", enqueue: false, warning: "overdue" });
});

test("new campaigns carry saved evidence, never old completion or scheduling authority", () => {
  const checkpoint = { completed: { "0": [] } };
  assert.deepEqual(auditCarryForward({ auditCheckpoint: checkpoint, auditPrecision: { saved: true },
    auditPaidAttempts: { receipt: true }, auditReport: { degraded: false },
    auditBatchDay: "today", auditSlices: 999, tenantId: 8, sourceHash: "forged" }),
  { auditCheckpoint: checkpoint, auditPrecision: { saved: true }, auditPaidAttempts: { receipt: true } });
});

test("daily target is one seventh of the whole corpus, rounded up and strictly validated", () => {
  assert.equal(auditDailyChunkTarget(353), 51);
  assert.equal(auditDailyChunkTarget(7), 1);
  assert.equal(auditDailyChunkTarget(1), 1);
  for (const n of [0, -1, NaN, Infinity, 1.5])
    assert.throws(() => auditDailyChunkTarget(n), /chunk count/);
});

test("weekly identity handles Sunday and the year boundary without daily resets", () => {
  assert.equal(auditWeekWindow(new Date("2027-01-03T23:59:59Z")), "2026-12-28");
  assert.equal(auditWeekWindow(new Date("2027-01-04T00:00:00Z")), "2027-01-04");
  assert.throws(() => auditWeekWindow(new Date("invalid")), /clock/);
});

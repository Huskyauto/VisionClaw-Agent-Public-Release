import test from "node:test";
import assert from "node:assert/strict";
import { auditPaidRequestKey, auditPaidAttemptExists, reserveAuditPaidAttempt } from "../../scripts/lib/tenant-audit-paid-attempts";
import { auditRoutes, runAuditFallback, AuditContentError, AuditProvidersExhausted } from "../../scripts/lib/tenant-audit-fallback";
import { assertAuditReceiptCapacity } from "../../scripts/lib/tenant-audit-unit-ledger";
import { auditProgressFingerprint } from "../../server/lib/tenant-audit-runner";
import { deferAuditDeadline, TenantAuditStop, auditJobState } from "../../server/lib/tenant-audit-job-state";
import { PgDialect } from "drizzle-orm/pg-core";

test("late admission writes atomically merge paid markers instead of erasing newer request keys", async () => {
  let queryText = "";
  let bodyParameters = 0;
  await auditJobState("auditPaidAttempts", { ["a".repeat(64)]: 10 }, { id: 1, attempt: 2 },
    async query => {
      const compiled = new PgDialect().sqlToQuery(query);
      queryText = compiled.sql;
      bodyParameters = compiled.params.filter(p => typeof p === "string" && p.includes("a".repeat(64))).length;
      return { rows: [{ payload: { auditPaidAttempts: {} } }] };
    });
  assert.match(queryText, /COALESCE\(payload->'auditPaidAttempts','\{\}'::jsonb\) \|\|/);
  assert.match(queryText, /tenant_id=1/);
  assert.match(queryText, /lease_until > now\(\)/);
  assert.equal(bodyParameters, 1, "large state body must be bound only once");
});

test("a paid request stays attempted across prefix/contract resets and cannot dispatch twice", async () => {
  const route = auditRoutes()[4];
  const key = auditPaidRequestKey(route, "system", "source", 16000);
  let durable: unknown, calls = 0;
  const ports = { read: async () => durable, write: async (x: unknown) => { durable = structuredClone(x); }, now: () => 10 };
  await reserveAuditPaidAttempt(key, ports);
  calls++; // Kill/ambiguous completion after dispatch, before any coverage receipt.
  await assert.rejects(() => reserveAuditPaidAttempt(key, ports), /already attempted/);
  assert.equal(calls, 1);
  assert.equal(auditPaidRequestKey(route, "system", "source", 8192), key);
  assert.notEqual(auditPaidRequestKey(route, "system", "edited source", 8192), key);
});
test("failed paid-attempt persistence is not a provider failure and never dispatches a backup", async () => {
  let calls = 0, failures = 0;
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 4, beforeAttempt: async () => {},
    beforeDispatch: async () => reserveAuditPaidAttempt("a".repeat(64), {
      read: async () => undefined, write: async () => { throw new Error("lost storage fence"); },
    }),
    invoke: async () => { calls++; }, failed: () => { failures++; },
  }), /lost storage fence/);
  assert.equal(calls, 0); assert.equal(failures, 0);
});
test("content-only exhaustion is not labeled a provider outage", async () => {
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 0, beforeAttempt: async () => {},
    invoke: async () => { throw new AuditContentError("bad content"); },
  }), AuditContentError);
});
test("one content failure does not declare all cooled-down or untried routes exhausted", async () => {
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 0, beforeAttempt: async () => {},
    available: async route => route.providerLane === "standard-compute",
    invoke: async () => { throw new AuditContentError("bad content"); },
  }), AuditProvidersExhausted);
});
test("an already attempted paid request is skipped while free routes are down, never a terminal content failure", async () => {
  const paid = auditRoutes()[4], key = auditPaidRequestKey(paid, "s", "u", 100);
  const durable = { [key]: 10 };
  let dispatched = 0;
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 4, beforeAttempt: async () => {},
    available: async route => route.providerLane === "cheaperinference"
      ? !await auditPaidAttemptExists(key, async () => durable) : false,
    invoke: async () => { dispatched++; },
  }), AuditProvidersExhausted);
  assert.equal(dispatched, 0);
});
test("corrupt paid-attempt state and receipt capacity reject before inference", async () => {
  for (const state of [[], null, { bad: 1 }, { ["a".repeat(64)]: "now" }])
    await assert.rejects(() => reserveAuditPaidAttempt("a".repeat(64), {
      read: async () => state, write: async () => { assert.fail("invalid state must not be saved"); },
    }), /Invalid durable/);
  assert.throws(() => assertAuditReceiptCapacity({ data: "x".repeat(6 * 1024 * 1024 - 512 * 1024) }, {}), /before dispatch/);
  assert.throws(() => assertAuditReceiptCapacity({}, { data: "x".repeat(8 * 1024 * 1024 - 1024 * 1024) }), /before dispatch/);
});
test("cursor, health and heartbeat writes are not completed work; repeated deadline stalls stop", async () => {
  const before = { auditCheckpoint: { completed: {}, pending: { completed: {}, nextRoute: 0 } } };
  assert.equal(auditProgressFingerprint(before), auditProgressFingerprint({
    ...before, auditProgressAt: "new", auditProviderHealth: { unavailable: true },
    auditCheckpoint: { completed: {}, pending: { completed: {}, nextRoute: 4 } },
  }));
  assert.notEqual(auditProgressFingerprint(before), auditProgressFingerprint({
    auditCheckpoint: { completed: { "0": [] } },
  }));
  let writes = 0;
  await deferAuditDeadline({ id: 1, attempt: 3 }, 0, async () => { writes++; return { rows: [{ id: 1 }] }; });
  assert.equal(writes, 1);
  await assert.rejects(() => deferAuditDeadline({ id: 1, attempt: 4 }, 2,
    async () => { assert.fail("third stalled deadline must stop"); }), TenantAuditStop);
});

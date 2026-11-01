import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { recordAuditNotice } from "../../server/lib/tenant-audit-notices";

test("warning, resolution and recurrence preserve history and stay scoped to the owner", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = async (query: any) => {
    calls.push(new PgDialect().sqlToQuery(query));
    return { rows: [] };
  };
  const store = { execute, transaction: async (work: (run: typeof execute) => Promise<void>) => work(execute) };
  await recordAuditNotice({ window: "2026-10-24", warning: "incomplete" }, "source-one", store);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[1].sql, /metadata=metadata-'resolvedAt'/);
  assert.match(calls[2].sql, /WHERE NOT EXISTS/);
  assert.match(calls[2].sql, /'\/operator'/);
  assert.ok(calls[2].params.some(p => String(p).includes("source-one")));
  calls.length = 0;
  await recordAuditNotice({ window: "2026-10-24", warning: null }, "source-one", store);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET type='info'/);
  assert.match(calls[0].sql, /resolvedAt/);
  assert.match(calls[0].sql, /tenant_id=1/);
  assert.doesNotMatch(calls[0].sql, /DELETE/);
  calls.length = 0;
  await recordAuditNotice({ window: "2026-10-24", warning: "incomplete" }, "source-two", store);
  assert.ok(calls[2].params.some(p => String(p).includes("source-two")));
});

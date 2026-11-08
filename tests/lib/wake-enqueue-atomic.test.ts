import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

function runner(execute: (q: any) => Promise<any>, route: (...args: any[]) => Promise<void>) {
  const source = readFileSync("server/agentic/wake-scheduler.ts", "utf8");
  const body = source.slice(source.indexOf("export async function runDueWakes"));
  const compiled = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { exports: {} as any, db: { execute }, sql, dispatchPersistedEvent: route, logSilentCatch: () => {}, console: { error: () => {} } };
  vm.runInNewContext(compiled, context);
  return context.exports.runDueWakes;
}
const dialect = new PgDialect();

test("wake handoff creates the durable event and completes its owner in one statement", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const routes: any[][] = [];
  const run = runner(async q => {
    const rendered = dialect.sqlToQuery(q);
    queries.push(rendered);
    return { rows: /INSERT INTO event_log/.test(rendered.sql)
      ? [{ id: 8, tenant_id: 37, event_id: 91, event_data: { wakeId: 8 } }] : [] };
  }, async (...args) => { routes.push(args); });
  const result = await run(4);
  const handoff = queries.find(q => /INSERT INTO event_log/.test(q.sql));
  assert.ok(handoff, "a persisted wake event is required");
  assert.match(handoff.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(handoff.sql, /UPDATE agent_wake_schedules/);
  assert.match(handoff.sql, /status = 'fired'/);
  assert.match(handoff.sql, /w\.tenant_id = e\.tenant_id/);
  assert.match(handoff.sql, /attempts = w\.attempts \+ 1/);
  assert.doesNotMatch(handoff.sql, /SET status = 'firing'/);
  assert.ok(handoff.params.includes(4));
  assert.equal(result.fired, 1);
  assert.equal(result.failed, false);
  assert.equal(routes.length, 1);
  assert.equal(routes[0][0], 91);
  assert.equal(routes[0][1].tenantId, 37);
  assert.equal(routes[0][1].type, "agent.wake");
  assert.equal(routes[0][1].data.wakeId, 8);
});

test("routing failure leaves the committed event pending without creating another wake event", async () => {
  let inserts = 0;
  const run = runner(async q => {
    const rendered = dialect.sqlToQuery(q);
    if (/INSERT INTO event_log/.test(rendered.sql)) {
      inserts++;
      return { rows: [{ id: 8, tenant_id: 37, event_id: 91 }] };
    }
    assert.doesNotMatch(rendered.sql, /SET status = 'pending'/);
    return { rows: [] };
  }, async () => { throw new Error("channel unavailable"); });
  const result = await run();
  assert.equal(inserts, 1);
  assert.equal(result.fired, 1, "fired means durable handoff, not final delivery");
  assert.equal(result.errors, 1);
  assert.equal(result.failed, true);
});

test("ambiguous legacy firing claims become visible failures, never automatic replays", async () => {
  const queries: string[] = [];
  const run = runner(async q => {
    const query = dialect.sqlToQuery(q).sql;
    queries.push(query);
    return { rows: /legacy_firing_outcome_unknown/.test(query) ? [{ id: 9 }] : [] };
  }, async () => { assert.fail("no new event was persisted"); });
  const result = await run();
  const recovery = queries.find(q => /legacy_firing_outcome_unknown/.test(q));
  assert.ok(recovery);
  assert.match(recovery, /status = 'failed'/);
  assert.match(recovery, /status = 'firing'/);
  assert.match(recovery, /interval '10 minutes'/);
  assert.match(recovery, /LIMIT/);
  assert.equal(result.errors, 1);
  assert.equal(result.failed, true);
});

test("database rejection cannot route an uncommitted wake", async () => {
  const run = runner(async q => {
    if (/INSERT INTO event_log/.test(dialect.sqlToQuery(q).sql)) throw new Error("DB unavailable");
    return { rows: [] };
  }, async () => { assert.fail("no committed event"); });
  const result = await run();
  assert.equal(result.fired, 0);
  assert.equal(result.failed, true);
});

test("invalid batch limits fail before a database call", async () => {
  const run = runner(async () => { assert.fail("invalid limit must not query"); }, async () => {});
  for (const limit of [0, -1, 1.5, NaN, Infinity, 101, "10", null]) {
    const result = await run(limit);
    assert.equal(result.fired, 0);
    assert.equal(result.failed, true);
  }
});

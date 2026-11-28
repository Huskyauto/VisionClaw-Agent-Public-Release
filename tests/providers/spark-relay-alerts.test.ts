import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { createSparkRelayAlerts, sparkRelayAlertConfiguration, type RelayAlertState } from "../../server/legion/spark-relay-alerts";
import { createSparkRelayAlertUpdater, RELAY_ALERT_KIND } from "../../server/legion/spark-relay-alert-store";
import { createSparkRelayStore } from "../../server/legion/spark-relay-store";
import { RELAY_WORKER_KIND } from "../../server/legion/spark-relay-contract";

test("only a sustained stale installed worker generates one offline and one recovery notice", async () => {
  let now = 1_800_000;
  const state: RelayAlertState = {};
  let seenAt = new Date(now - 300_000).toISOString();
  const notices: string[] = [];
  const config = sparkRelayAlertConfiguration({
    LEGION_SPARK_RELAY_ALERTS_ENABLED: "1", LEGION_SPARK_RELAY_INSTALLED: "1",
    LEGION_SPARK_RELAY_ALERT_ENVIRONMENT: "production",
  });
  const check = createSparkRelayAlerts({
    configuration: () => config, permitted: () => true, now: () => now,
    observe: async () => ({ enabled: true, environment: "production", worker: { seenAt } }),
    update: async (_env, fn) => fn(state),
    send: async notice => { notices.push(notice.kind); },
  });
  await check(1);
  assert.deepEqual(notices, []);
  now += 15 * 60_000;
  await check(1);
  await check(1);
  assert.deepEqual(notices, ["offline"]);
  seenAt = new Date(now).toISOString();
  await check(1);
  await check(1);
  assert.deepEqual(notices, ["offline", "recovery"]);
});

const enabledEnv = {
  LEGION_SPARK_RELAY_ALERTS_ENABLED: "1", LEGION_SPARK_RELAY_INSTALLED: "1",
  LEGION_SPARK_RELAY_ALERT_ENVIRONMENT: "production",
};
function fixture() {
  const f = {
    now: 10_000_000, state: {} as RelayAlertState, env: { ...enabledEnv } as Record<string, string | undefined>,
    permitted: true, observations: 0, updates: 0, sends: [] as string[], failSend: false,
    observation: { enabled: true, environment: "production",
      worker: { seenAt: new Date(0).toISOString(), ready: false } as { seenAt: string; ready?: boolean } | null },
  };
  let queue = Promise.resolve();
  const deps = {
    configuration: () => sparkRelayAlertConfiguration(f.env),
    permitted: () => f.permitted, now: () => f.now,
    observe: async () => { f.observations++; return f.observation; },
    update: async <T,>(_env: string, fn: (state: RelayAlertState) => T): Promise<T> => {
      const prior = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await prior;
      try { f.updates++; return fn(f.state); } finally { release(); }
    },
    send: async (notice: { kind: string }) => {
      f.sends.push(notice.kind);
      if (f.failSend) throw Error("accepted but inbox unverified");
    },
  };
  return { f, check: createSparkRelayAlerts(deps), restart: () => createSparkRelayAlerts(deps) };
}
test("fresh recovery followed immediately by a new outage can alert after cooldown", async () => {
  const { f, check } = fixture();
  await check(1); f.now += 900_000; await check(1);
  f.observation.worker!.seenAt = new Date(f.now).toISOString();
  await check(1); // Only one fresh pass, then another sustained outage.
  f.now += 300_000; await check(1);
  f.now += 21_600_000; await check(1);
  assert.deepEqual(f.sends, ["offline", "recovery", "offline"]);
});

test("missing installation, opt-in, owner, environment and relay permission suppress all work", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>["f"]) => { delete f.env.LEGION_SPARK_RELAY_INSTALLED; },
    (f: ReturnType<typeof fixture>["f"]) => { f.env.LEGION_SPARK_RELAY_ALERTS_ENABLED = "true"; },
    (f: ReturnType<typeof fixture>["f"]) => { f.env.LEGION_SPARK_RELAY_ALERT_ENVIRONMENT = "development"; },
    (f: ReturnType<typeof fixture>["f"]) => { f.permitted = false; },
  ]) {
    const { f, check } = fixture(); mutate(f);
    await check(1); assert.equal(f.observations, 0); assert.equal(f.updates, 0);
  }
  const { f, check } = fixture();
  await check(2); assert.equal(f.observations, 0);
  f.observation.enabled = false; await check(1); assert.equal(f.updates, 0);
  f.observation.enabled = true; f.observation.environment = "development";
  await check(1); assert.equal(f.updates, 0);
});

test("configuration is exact opt-in and invalid thresholds disable mail", () => {
  assert.equal(sparkRelayAlertConfiguration({}).enabled, false);
  for (const [key, values] of [
    ["LEGION_SPARK_RELAY_ALERT_STALE_MINUTES", ["", "4", "121", "NaN", "15.5", "-1", "Infinity"]],
    ["LEGION_SPARK_RELAY_ALERT_COOLDOWN_MINUTES", ["", "29", "1441", "NaN", "60oops"]],
  ] as const) for (const value of values) {
    assert.equal(sparkRelayAlertConfiguration({ ...enabledEnv, [key]: value }).enabled, false, `${key}=${value}`);
  }
  for (const value of ["5", "120"]) assert.equal(sparkRelayAlertConfiguration({
    ...enabledEnv, LEGION_SPARK_RELAY_ALERT_STALE_MINUTES: value,
  }).enabled, true);
});

test("never-installed, malformed and future worker evidence cannot send or continue a stale streak", async () => {
  const { f, check } = fixture();
  for (const worker of [null, { seenAt: "bad" }, { seenAt: new Date(f.now + 86_400_000).toISOString() }]) {
    f.observation.worker = worker;
    await check(1); f.now += 900_000; await check(1);
    assert.deepEqual(f.sends, []);
  }
  f.observation.worker = { seenAt: new Date(0).toISOString() };
  await check(1); f.now += 899_999; await check(1); assert.deepEqual(f.sends, []);
  f.now++; await check(1); assert.deepEqual(f.sends, ["offline"]);
});

test("fresh but busy polls reset a brief stale streak without inference or email", async () => {
  const { f, check } = fixture();
  await check(1); f.now += 899_999;
  f.observation.worker = { seenAt: new Date(f.now).toISOString(), ready: false };
  await check(1);
  f.now += 300_000; await check(1);
  f.now += 899_999; await check(1); assert.deepEqual(f.sends, []);
  f.now++; await check(1); assert.deepEqual(f.sends, ["offline"]);
});

test("concurrent checks and a restarted monitor preserve the same incident and cooldown", async () => {
  const { f, check, restart } = fixture();
  await check(1); f.now += 900_000;
  await Promise.all(Array.from({ length: 8 }, () => restart()(1)));
  assert.deepEqual(f.sends, ["offline"]);
  f.now += 86_400_000; await restart()(1); assert.deepEqual(f.sends, ["offline"]);
  f.observation.worker!.seenAt = new Date(f.now).toISOString();
  await Promise.all([check(1), restart()(1)]);
  assert.deepEqual(f.sends, ["offline", "recovery"]);
  f.now += 300_000; await check(1); f.now += 900_000; await check(1);
  assert.deepEqual(f.sends, ["offline", "recovery", "offline"]);
  f.observation.worker!.seenAt = new Date(f.now).toISOString(); await check(1);
  f.now += 300_000; await check(1); f.now += 900_000; await check(1);
  assert.deepEqual(f.sends, ["offline", "recovery", "offline", "recovery"]);
});

test("ambiguous mail outcome is not retried or followed by a false recovery", async () => {
  const { f, check, restart } = fixture();
  await check(1); f.now += 900_000; f.failSend = true;
  await assert.rejects(check(1), /unverified/);
  assert.equal(f.state.outcome, "uncertain");
  f.now += 86_400_000; await restart()(1);
  f.observation.worker!.seenAt = new Date(f.now).toISOString(); await check(1);
  assert.deepEqual(f.sends, ["offline"]);
});

test("an abandoned pre-send claim cannot resend, but stops blocking later incidents after cooldown", async () => {
  const { f, check } = fixture();
  f.state = { pending: "interrupted", pendingAt: f.now, offlineAttempted: true, lastAttemptAt: f.now };
  await check(1); assert.deepEqual(f.sends, []);
  f.now += 21_600_000;
  f.observation.worker!.seenAt = new Date(f.now).toISOString(); await check(1);
  f.now += 300_000; await check(1); f.now += 900_000; await check(1);
  assert.deepEqual(f.sends, ["offline"]);
});

test("a worker poll between stale samples restarts the sustained-stale period", async () => {
  const { f, check } = fixture();
  await check(1); f.now += 899_999;
  f.observation.worker!.seenAt = new Date(f.now - 160_000).toISOString();
  await check(1); f.now++; await check(1);
  assert.deepEqual(f.sends, []);
  f.now += 899_999; await check(1);
  assert.deepEqual(f.sends, ["offline"]);
});

test("alert state updates commit owner/environment-scoped inert rows, never queue work", async () => {
  const dialect = new PgDialect();
  const queries: { sql: string; params: unknown[] }[] = [];
  let saved: any;
  let commits = 0;
  const db = {
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query); queries.push(q);
      if (q.sql.startsWith("SELECT id,payload")) return { rows: saved ? [{ id: 71, payload: saved }] : [] };
      if (q.sql.startsWith("INSERT") || q.sql.startsWith("UPDATE")) {
        saved = JSON.parse(q.params.find(p => typeof p === "string" && p.startsWith('{"environment"')) as string);
      }
      return { rows: [] };
    },
    transaction: async <T,>(fn: (tx: any) => Promise<T>) => { const r = await fn(db); commits++; return r; },
  };
  const update = createSparkRelayAlertUpdater(db);
  await assert.rejects(update("development", () => {}), /production scope/);
  assert.equal(queries.length, 0);
  await update("production", state => { state.offlineAttempted = true; });
  await update("production", state => { assert.equal(state.offlineAttempted, true); state.offlineVerified = true; });
  assert.equal(commits, 2);
  assert.equal(saved.state.offlineVerified, true);
  assert.equal(queries.filter(q => q.sql.includes("pg_advisory_xact_lock")).length, 2);
  for (const q of queries.filter(q => /^(SELECT id|UPDATE)/.test(q.sql))) {
    assert.match(q.sql, /tenant_id=1/);
    assert.match(q.sql, /payload->>'environment'=/);
    assert.ok(q.params.includes("production"));
    assert.ok(q.params.includes(RELAY_ALERT_KIND));
  }
  const insert = queries.find(q => q.sql.startsWith("INSERT"))!;
  assert.match(insert.sql, /VALUES \(1,/);
  assert.match(insert.sql, /'relay_worker'/);
  assert.doesNotMatch(insert.sql, /'pending'|'running'|'relay_queued'/);
});

test("structured worker freshness is a read-only owner/environment query without job mutation", async () => {
  const dialect = new PgDialect();
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = {
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query); queries.push(q);
      return { rows: [{ payload: { seenAt: new Date(1000).toISOString(), ready: false, workerId: "fixture" } }] };
    },
    transaction: async <T,>(_fn: (tx: any) => Promise<T>): Promise<T> => { throw Error("must not write"); },
  };
  const store = createSparkRelayStore(db, { environment: () => "production", enabled: () => true, now: () => 2000, screen: () => true });
  await assert.rejects(store.workerFreshness(2), /Owner relay scope/);
  assert.equal(queries.length, 0);
  const result = await store.workerFreshness(1);
  assert.equal(result.worker?.ready, false);
  assert.equal(result.worker?.seenAt, new Date(1000).toISOString());
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT payload/);
  assert.match(queries[0].sql, /tenant_id=/);
  assert.deepEqual(queries[0].params, [1, RELAY_WORKER_KIND, "production"]);
});

test("claim persistence failure prevents transport; permission revocation after claim does too", async () => {
  for (const revoke of [false, true]) {
    let permitted = true;
    let calls = 0;
    let now = 10_000_000;
    const state: RelayAlertState = {};
    const check = createSparkRelayAlerts({
      configuration: () => sparkRelayAlertConfiguration(enabledEnv), permitted: () => permitted, now: () => now,
      observe: async () => ({ enabled: true, environment: "production", worker: { seenAt: new Date(0).toISOString() } }),
      update: async (_environment, fn) => {
        const result = fn(state);
        if (state.pending) {
          if (revoke) permitted = false;
          else throw Error("commit refused");
        }
        return result;
      },
      send: async () => { calls++; },
    });
    await check(1); now += 900_000;
    if (revoke) await check(1);
    else await assert.rejects(check(1), /commit refused/);
    assert.equal(calls, 0);
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Client } from "pg";
import {
  DIRECT_RESERVATION_KIND, RELAY_JOB_KIND, RELAY_WORKER_KIND, SPARK_RELAY, relayHash,
} from "../../server/legion/spark-relay-contract";
import { createSparkRelayStore, RelayConflict, type RelayDatabase } from "../../server/legion/spark-relay-store";
import { guardLocalMessages, LEGION_MODEL } from "../../server/legion/model-policy";
import { migrateSparkRelaySchema, checkSparkRelaySchema } from "../../server/legion/spark-relay-schema";

const disposableDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/visionclaw_test";
  } catch { return false; }
})();
const requested = process.env.RUN_SPARK_RELAY_DB === "1" || disposableDatabase;
const safeDevelopment = !process.env.REPLIT_DEPLOYMENT && (process.env.NODE_ENV === "development" ||
  (process.env.NODE_ENV === "test" && disposableDatabase));
if (requested && !safeDevelopment) {
  throw new Error("Spark relay DB tests require development NODE_ENV and no REPLIT_DEPLOYMENT");
}
const runDb = requested && safeDevelopment;
const dialect = new PgDialect();

function requestBody(response_format?: Record<string, unknown>) {
  return {
    model: LEGION_MODEL, stream: false, temperature: 0, max_tokens: 64,
    messages: guardLocalMessages([{ role: "user", content: "Return the answer." }]),
    ...(response_format ? { response_format } : {}),
  };
}
function completion(content = "42", extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: LEGION_MODEL, done: true, done_reason: "stop",
    message: { role: "assistant", content }, prompt_eval_count: 7, eval_count: 1, ...extra,
  });
}

async function fixture(t: import("node:test").TestContext, clock = { value: Date.now() }) {
  if (!process.env.DATABASE_URL) throw new Error("RUN_SPARK_RELAY_DB=1 requires development DATABASE_URL");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE TEMP TABLE agent_jobs (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, kind text NOT NULL, status text NOT NULL,
    payload jsonb NOT NULL, result jsonb, max_attempts integer, attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT NOW(), started_at timestamptz, completed_at timestamptz,
    lease_until timestamptz, rollback_note text,
    CONSTRAINT agent_jobs_status_check CHECK
      (status IN ('pending','running','succeeded','failed','failed_terminal','cancelled'))
  )`);
  assert.equal((await checkSparkRelaySchema(client)).ready, false);
  assert.equal((await migrateSparkRelaySchema(client)).ready, true);
  assert.deepEqual(await migrateSparkRelaySchema(client), { ready: true, changed: false });

  // A dedicated connection is serialized because a PostgreSQL connection cannot
  // run overlapping transactions. TEMP agent_jobs shadows every permanent table.
  let tail: Promise<void> = Promise.resolve();
  const locked = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };
  const rawExecute = async (query: any) => {
    const rendered = dialect.sqlToQuery(query);
    return client.query(rendered.sql, rendered.params);
  };
  const txExecute = async (query: any) => {
    const rendered = dialect.sqlToQuery(query);
    if (zeroStartUpdate && rendered.sql.includes("SET status='relay_running'") &&
        rendered.sql.includes("RETURNING id")) return { rows: [] };
    return client.query(rendered.sql, rendered.params);
  };
  const db: RelayDatabase = {
    execute: query => locked(() => rawExecute(query)),
    transaction: fn => locked(async () => {
      await client.query("BEGIN");
      const tx: RelayDatabase = {
        execute: txExecute,
        transaction: async nested => nested(tx),
      };
      try {
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }),
  };
  let environment = "development";
  let enabled = true;
  let zeroStartUpdate = false;
  const store = createSparkRelayStore(db, {
    environment: () => environment, enabled: () => enabled, now: () => clock.value,
    screen: () => true,
  });
  t.after(async () => {
    try { await client.query("DROP TABLE IF EXISTS pg_temp.agent_jobs"); } finally { await client.end(); }
  });
  return {
    client, db, store, clock,
    setEnvironment: (value: string) => { environment = value; },
    setEnabled: (value: boolean) => { enabled = value; },
    setZeroStartUpdate: (value: boolean) => { zeroStartUpdate = value; },
  };
}

async function enqueue(store: ReturnType<typeof createSparkRelayStore>, workId = randomUUID(), body = requestBody()) {
  return store.enqueue(1, body, "compile-runbook", workId);
}
async function claim(store: ReturnType<typeof createSparkRelayStore>, apiKeyId = 41, workerId = "worker_0001") {
  const value = await store.poll(1, apiKeyId, workerId, true);
  assert.ok(value, "ready worker should claim the queued relay job");
  return value;
}
function binding(job: Awaited<ReturnType<typeof claim>>) {
  return {
    protocol: SPARK_RELAY.protocol, workerId: "worker_0001", requestId: job.requestId,
    digest: job.digest, claimToken: job.claimToken,
  };
}

test("relay DB suite is opt-in and refuses non-development deployments", { skip: !runDb }, () => {
  assert.equal(runDb, true);
});

test("status migration repairs altered literals instead of approving an incompatible CHECK", { skip: !runDb }, async t => {
  const { client } = await fixture(t);
  const { rows } = await client.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pg_temp.agent_jobs'::regclass AND conname='agent_jobs_status_check'`);
  const altered = rows[0].definition.replace("'relay_running'", "'relay_ running'");
  await client.query(`ALTER TABLE pg_temp.agent_jobs DROP CONSTRAINT agent_jobs_status_check,
    ADD CONSTRAINT agent_jobs_status_check ${altered}`);
  assert.equal((await checkSparkRelaySchema(client)).ready, false);
  assert.deepEqual(await migrateSparkRelaySchema(client), { ready: true, changed: true });
  assert.equal((await checkSparkRelaySchema(client)).ready, true);
});

test("failed constraint validation rolls back without changing the prior CHECK or records", { skip: !runDb }, async t => {
  const { client } = await fixture(t);
  await client.query(`ALTER TABLE pg_temp.agent_jobs DROP CONSTRAINT agent_jobs_status_check,
    ADD CONSTRAINT agent_jobs_status_check CHECK (status IN ('pending','legacy_custom'))`);
  await client.query(`INSERT INTO pg_temp.agent_jobs (tenant_id,kind,status,payload,max_attempts)
    VALUES (1,'fixture','legacy_custom','{}'::jsonb,1)`);
  await assert.rejects(migrateSparkRelaySchema(client), (e: any) => e.code === "23514");
  const saved = await client.query(`SELECT status FROM pg_temp.agent_jobs`);
  assert.deepEqual(saved.rows, [{ status: "legacy_custom" }]);
  const constraint = await client.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pg_temp.agent_jobs'::regclass AND conname='agent_jobs_status_check'`);
  assert.match(constraint.rows[0].definition, /legacy_custom/);
});

test("tenant, environment, claim, digest, worker, key and token bindings isolate jobs", { skip: !runDb }, async t => {
  const { store, setEnvironment } = await fixture(t);
  const row = await enqueue(store, "binding-test");
  await assert.rejects(store.get(2, row.id), RelayConflict);
  setEnvironment("production");
  assert.equal(await store.get(1, row.id), undefined, "environment-bound row is inaccessible elsewhere");
  assert.equal((await store.status(1)).jobs.length, 0);
  setEnvironment("development");
  assert.equal((await store.get(1, row.id)).id, row.id);
  const c = await claim(store);
  const b = binding(c);
  await store.start(1, 41, row.id, b);
  await assert.rejects(store.result(1, 42, row.id, b, "uncertain"), RelayConflict);
  await assert.rejects(store.result(1, 41, row.id, { ...b, digest: "0".repeat(64) }, "uncertain"), RelayConflict);
});

test("enqueue is idempotent, generic pending jobs remain untouched, and concurrent polls claim once", { skip: !runDb }, async t => {
  const { client, store } = await fixture(t);
  const row = await enqueue(store, "same-work");
  const duplicate = await enqueue(store, "same-work");
  assert.equal(duplicate.id, row.id);
  assert.equal(duplicate.payload.requestKey, row.payload.requestKey);
  await client.query(
    "INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts) VALUES (1,'generic-work','pending','{}',3)",
  );
  const claims = await Promise.all([
    store.poll(1, 41, "worker_0001", true), store.poll(1, 42, "worker_0002", true),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const rows = await client.query("SELECT kind,status FROM agent_jobs ORDER BY id");
  assert.equal(rows.rows.find((r: any) => r.kind === "generic-work").status, "pending");
  assert.ok(rows.rows.some((r: any) => r.kind === RELAY_WORKER_KIND));
  assert.equal((await store.status(1)).jobs.length, 1, "generic jobs must not appear in relay status");
});

test("find returns only the matching owner/environment/work/task/request digest identity", { skip: !runDb }, async t => {
  const { store, setEnvironment } = await fixture(t);
  const body = requestBody();
  const row = await enqueue(store, "find-exact", body);
  assert.equal((await store.find(1, body, "compile-runbook", "find-exact")).id, row.id);
  assert.equal(await store.find(1, body, "compile-runbook", "different-work"), undefined);
  assert.equal(await store.find(1, requestBody({ type: "json_object" }), "compile-runbook", "find-exact"), undefined);
  await assert.rejects(store.find(2, body, "compile-runbook", "find-exact"), RelayConflict);
  setEnvironment("production");
  assert.equal(await store.find(1, body, "compile-runbook", "find-exact"), undefined);
});

test("disabled relay rejects new admission but accepts an already-started result for recovery", { skip: !runDb }, async t => {
  const { store, setEnabled } = await fixture(t);
  const row = await enqueue(store, "result-after-disable");
  const c = await claim(store), b = binding(c);
  await store.start(1, 41, row.id, b);
  setEnabled(false);
  await assert.rejects(enqueue(store, "disabled-new-job"), /Spark relay disabled/);
  await assert.rejects(store.poll(1, 42, "worker_0002", true), /Spark relay disabled/);
  assert.equal(
    (await store.result(1, 41, row.id, b, "complete", completion())).accepted,
    true,
    "post-disable result delivery records real completion instead of losing evidence",
  );
  assert.equal((await store.get(1, row.id)).status, "relay_complete");
});

test("start requires exact claim identity and only a successful first start authorizes inference", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const row = await enqueue(store, "identity");
  const c = await claim(store);
  const b = binding(c);
  const invalid = [
    { ...b, protocol: "wrong-protocol" }, { ...b, workerId: "worker_0002" },
    { ...b, requestId: randomUUID() }, { ...b, digest: "0".repeat(64) },
    { ...b, claimToken: randomUUID() },
  ];
  for (const candidate of invalid) {
    await assert.rejects(store.start(1, 41, row.id, candidate), RelayConflict);
  }
  await assert.rejects(store.start(1, 42, row.id, b), RelayConflict, "claim is bound to API key identity");
  assert.deepEqual(await store.start(1, 41, row.id, b), { started: true });
  await assert.rejects(store.start(1, 41, row.id, b), RelayConflict, "repeat/ambiguous start never reauthorizes inference");
});

test("start and cancellation races serialize: cancel-first blocks start, start-first becomes uncertain", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const cancelFirstJob = await enqueue(store, "cancel-first-race");
  const firstClaim = await claim(store), firstBinding = binding(firstClaim);
  const [cancelled, refusedStart] = await Promise.allSettled([
    store.cancel(1, cancelFirstJob.id),
    store.start(1, 41, cancelFirstJob.id, firstBinding),
  ]);
  assert.equal(cancelled.status, "fulfilled");
  assert.equal(refusedStart.status, "rejected");
  assert.ok(refusedStart.status === "rejected" && refusedStart.reason instanceof RelayConflict);
  assert.equal((await store.get(1, cancelFirstJob.id)).status, "relay_cancelled");

  const startFirstJob = await enqueue(store, "start-first-race");
  const secondClaim = await claim(store), secondBinding = binding(secondClaim);
  const [started, cancelledAfterStart] = await Promise.allSettled([
    store.start(1, 41, startFirstJob.id, secondBinding),
    store.cancel(1, startFirstJob.id),
  ]);
  assert.equal(started.status, "fulfilled");
  assert.deepEqual(started.status === "fulfilled" ? started.value : undefined, { started: true });
  assert.equal(cancelledAfterStart.status, "fulfilled");
  assert.equal((await store.get(1, startFirstJob.id)).status, "relay_uncertain");
});

test("start never authorizes inference when its conditional running update returns zero rows", { skip: !runDb }, async t => {
  const { store, setZeroStartUpdate } = await fixture(t);
  const row = await enqueue(store, "zero-start-update");
  const c = await claim(store), b = binding(c);
  setZeroStartUpdate(true);
  await assert.rejects(store.start(1, 41, row.id, b), /Relay running reservation was not acquired/);
  setZeroStartUpdate(false);
  assert.equal((await store.get(1, row.id)).status, "relay_claimed");
  assert.deepEqual(await store.start(1, 41, row.id, b), { started: true });
});

test("direct Lenovo advisory-lock contention rejects start without inferring success", { skip: !runDb }, async t => {
  const { client, store } = await fixture(t);
  const row = await enqueue(store, "admission-lock");
  const c = await claim(store), b = binding(c);
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(872631,1)");
    await assert.rejects(store.start(1, 41, row.id, b), /Lenovo inference busy/);
    assert.equal((await store.get(1, row.id)).status, "relay_claimed");
  } finally {
    await holder.query("ROLLBACK");
    await holder.end();
  }
  assert.deepEqual(await store.start(1, 41, row.id, b), { started: true });
  void client;
});

test("direct reservations block claims, expire to prioritized uncertainty, require release, then allow claims", { skip: !runDb }, async t => {
  const { client, store, clock } = await fixture(t);
  const queued = await enqueue(store, "held-by-direct-inference");
  const markerDeadline = new Date(clock.value + 1_000).toISOString();
  const inserted = await client.query(
    `INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
     VALUES (1,$1,'relay_running',$2,1) RETURNING id`,
    [DIRECT_RESERVATION_KIND, JSON.stringify({
      environment: "development", deadlineAt: markerDeadline,
    })],
  );
  const markerId = inserted.rows[0].id as number;

  assert.equal(await store.poll(1, 41, "worker_0001", true), null);
  await assert.rejects(store.release(1, markerId), /Only uncertain work can be released/);
  clock.value += 1_001;
  const status = await store.status(1);
  assert.equal(status.jobs[0].id, markerId, "uncertain direct work is prioritized in sanitized status");
  assert.equal(status.jobs[0].status, "uncertain");
  assert.equal(status.jobs[0].transport, "direct");
  await store.release(1, markerId);
  assert.equal((await store.get(1, queued.id)).status, "relay_queued");
  assert.equal((await store.poll(1, 41, "worker_0001", true))?.jobId, queued.id);
});

test("production direct reservations block development poll/start without exposing production job content", { skip: !runDb }, async t => {
  const { client, store } = await fixture(t);
  const productionJob = await client.query(
    `INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
     VALUES (1,$1,'relay_queued',$2,1) RETURNING id`,
    [RELAY_JOB_KIND, JSON.stringify({
      environment: "production", task: "compile-runbook", requestId: randomUUID(),
      requestJson: "PRODUCTION_PRIVATE_TASK_TEXT",
      deadlineAt: new Date(Date.now() + SPARK_RELAY.deadlineMs).toISOString(),
    })],
  );
  const productionJobId = productionJob.rows[0].id as number;
  const directMarker = await client.query(
    `INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
     VALUES (1,$1,'relay_running',$2,1) RETURNING id`,
    [DIRECT_RESERVATION_KIND, JSON.stringify({
      environment: "production", marker: "PRODUCTION_PRIVATE_RESERVATION",
      deadlineAt: new Date(Date.now() + SPARK_RELAY.deadlineMs).toISOString(),
    })],
  );
  const directId = directMarker.rows[0].id as number;
  const queued = await enqueue(store, "production-reservation-blocks-development");
  assert.equal(await store.poll(1, 41, "worker_0001", true), null);
  assert.equal(await store.get(1, productionJobId), undefined);
  assert.equal(await store.get(1, directId), undefined);
  const status = await store.status(1);
  assert.equal(status.jobs.some(job => job.id === productionJobId || job.id === directId), false);
  assert.equal(JSON.stringify(status).includes("PRODUCTION_PRIVATE"), false);

  await client.query("UPDATE agent_jobs SET status='relay_released' WHERE id=$1", [directId]);
  const c = await claim(store), b = binding(c);
  assert.equal(c.jobId, queued.id);
  await client.query("UPDATE agent_jobs SET status='relay_running' WHERE id=$1", [directId]);
  await assert.rejects(store.start(1, 41, queued.id, b), /Lenovo relay reservation unresolved/);
  assert.equal((await store.get(1, queued.id)).status, "relay_claimed");
});

test("direct reservation inserted between claim and start refuses Spark start", { skip: !runDb }, async t => {
  const { client, store } = await fixture(t);
  const queued = await enqueue(store, "direct-before-start");
  const c = await claim(store), b = binding(c);
  await client.query(
    `INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
     VALUES (1,$1,'relay_running',$2,1)`,
    [DIRECT_RESERVATION_KIND, JSON.stringify({
      environment: "development", deadlineAt: new Date(Date.now() + SPARK_RELAY.deadlineMs).toISOString(),
    })],
  );
  await assert.rejects(store.start(1, 41, queued.id, b), /Lenovo relay reservation unresolved/);
  assert.equal((await store.get(1, queued.id)).status, "relay_claimed");
});

test("deadlines expire queued work as failed-before-send and running work as uncertain; late completion records evidence", { skip: !runDb }, async t => {
  const { store, clock } = await fixture(t);
  const queued = await enqueue(store, "expire-queued");
  clock.value += SPARK_RELAY.deadlineMs + 1;
  await store.status(1);
  assert.equal((await store.get(1, queued.id)).status, "relay_failed_before_send");

  clock.value = Date.now();
  const running = await enqueue(store, "expire-running");
  const c = await claim(store), b = binding(c);
  await store.start(1, 41, running.id, b);
  clock.value += SPARK_RELAY.deadlineMs + 1;
  await store.status(1);
  assert.equal((await store.get(1, running.id)).status, "relay_uncertain");
  assert.equal((await store.result(1, 41, running.id, b, "complete", completion())).accepted, true);
  assert.equal((await store.get(1, running.id)).status, "relay_complete");
});

test("cancellation distinguishes unsent work from running uncertainty and uncertain reservations block claims", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const queued = await enqueue(store, "cancel-queued");
  await store.cancel(1, queued.id);
  assert.equal((await store.get(1, queued.id)).status, "relay_cancelled");
  const running = await enqueue(store, "cancel-running");
  const c = await claim(store), b = binding(c);
  await store.start(1, 41, running.id, b);
  await store.cancel(1, running.id);
  assert.equal((await store.get(1, running.id)).status, "relay_uncertain");
  await enqueue(store, "blocked-by-uncertain");
  assert.equal(await store.poll(1, 42, "worker_0002", true), null);
});

test("identical saved results are idempotent, conflicting results fail, and completion evidence is validated", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const row = await enqueue(store, "results");
  const c = await claim(store), b = binding(c);
  await store.start(1, 41, row.id, b);
  assert.equal((await store.result(1, 41, row.id, b, "complete", completion())).duplicate, false);
  assert.equal((await store.result(1, 41, row.id, b, "complete", completion())).duplicate, true);
  await assert.rejects(store.result(1, 41, row.id, b, "complete", completion("different")), RelayConflict);

  const invalids = [
    completion("42", { model: "not-the-approved-model" }),
    completion("42", { eval_count: undefined }),
    completion("42", { prompt_eval_count: -1 }),
    completion("42", { message: { role: "assistant", content: "42", tool_calls: [{ id: "x" }] } }),
    completion("42", { message: { role: "assistant", content: "42", refusal: "blocked" } }),
  ];
  for (const response of invalids) {
    const job = await enqueue(store, `bad-${randomUUID()}`);
    const claimForJob = await claim(store);
    const jobBinding = binding(claimForJob);
    await store.start(1, 41, job.id, jobBinding);
    await assert.rejects(store.result(1, 41, job.id, jobBinding, "complete", response), /contract refused/);
    assert.equal((await store.result(1, 41, job.id, jobBinding, "uncertain")).accepted, true);
    await store.release(1, job.id); // Explicit owner acknowledgement is required before another claim.
  }
});

test("response format/schema mismatches are not accepted as native completion", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const schema = {
    type: "json_schema", json_schema: {
      name: "answer", schema: { type: "object", properties: { ok: { type: "boolean" } },
        required: ["ok"], additionalProperties: false },
    },
  };
  const row = await enqueue(store, "schema-mismatch", requestBody(schema));
  const c = await claim(store), b = binding(c);
  await store.start(1, 41, row.id, b);
  await assert.rejects(
    store.result(1, 41, row.id, b, "complete", completion('{"unexpected":true}')),
    /contract refused/,
    "completion must satisfy the requested format schema",
  );
});

test("hourly and waiting caps cannot be bypassed by a distinct work identity", { skip: !runDb }, async t => {
  const { client, store } = await fixture(t);
  for (let i = 0; i < SPARK_RELAY.maxWaiting; i++) await enqueue(store, `waiting-${i}`);
  await assert.rejects(enqueue(store, "waiting-over-cap"), /capacity unavailable/);
  await client.query("DELETE FROM agent_jobs");
  for (let i = 0; i < SPARK_RELAY.maxPerHour; i++) {
    await client.query(
      "INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts) VALUES (1,$1,'relay_complete',$2,1)",
      [RELAY_JOB_KIND, JSON.stringify({ environment: "development", requestKey: `hourly-${i}` })],
    );
  }
  await assert.rejects(enqueue(store, "hourly-over-cap"), /capacity unavailable/);
});

test("relay hashes use the exact UTF-8 request JSON digest", { skip: !runDb }, async t => {
  const { store } = await fixture(t);
  const row = await enqueue(store, "digest-exact");
  assert.equal(row.payload.digest, relayHash(row.payload.requestJson));
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readdirSync, mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

function postgresBin() {
  const candidates = (process.env.PATH || "").split(":");
  if (existsSync("/usr/lib/postgresql")) {
    candidates.push(...readdirSync("/usr/lib/postgresql").map(v => `/usr/lib/postgresql/${v}/bin`));
  }
  if (existsSync("/nix/store")) {
    candidates.push(...readdirSync("/nix/store")
      .filter(n => /-postgresql-\d/.test(n)).map(n => `/nix/store/${n}/bin`));
  }
  return candidates.find(p => ["initdb", "pg_ctl", "postgres"].every(n => existsSync(join(p, n))));
}

function fixtureEnv() {
  const { TARGET } = require("../../scripts/railway-staging-startup-repair.cjs");
  return {
    ISOLATED_STAGING: "1",
    RAILWAY_PROJECT_ID: TARGET.project,
    RAILWAY_ENVIRONMENT_ID: TARGET.environment,
    RAILWAY_SERVICE_ID: TARGET.service,
    DATABASE_URL: `postgresql://fixture:unused@${TARGET.hostname}:5432/railway`,
  };
}

test("repair refuses non-staging execution before creating a database client", async () => {
  const { runRepair } = require("../../scripts/railway-staging-startup-repair.cjs");
  let connected = false;
  await assert.rejects(
    runRepair({
      env: {},
      args: ["--apply"],
      clientFactory() { connected = true; throw Error("Unexpected database access"); },
    }),
    /isolated Railway staging/,
  );
  assert.equal(connected, false);
});

test("unknown flags, wrong targets, and connection overrides never reach a database", async () => {
  const { runRepair } = require("../../scripts/railway-staging-startup-repair.cjs");
  const cases = [
    { args: ["--dry-run"] },
    { args: ["--apply", "--check"] },
    { env: { ISOLATED_STAGING: "true" } },
    { env: { RAILWAY_PROJECT_ID: "different-project" } },
    { env: { RAILWAY_ENVIRONMENT_ID: "production" } },
    { env: { RAILWAY_SERVICE_ID: "different-service" } },
    { env: { DATABASE_URL: "postgresql://fixture:unused@production.example/db" } },
    { env: { DATABASE_URL: `${fixtureEnv().DATABASE_URL}?host=production.example` } },
    { env: { DATABASE_URL: `${fixtureEnv().DATABASE_URL}#override` } },
    { env: { DATABASE_URL: fixtureEnv().DATABASE_URL.replace(":5432", ":5433") } },
  ];
  for (const c of cases) {
    let reached = false;
    await assert.rejects(runRepair({
      env: { ...fixtureEnv(), ...c.env }, args: c.args || ["--apply"],
      clientFactory() { reached = true; throw Error("Unexpected database access"); },
    }));
    assert.equal(reached, false, JSON.stringify(c));
  }
});

test("repair against a disposable PostgreSQL cluster", async t => {
  const bin = postgresBin();
  assert.ok(bin, "PostgreSQL initdb/pg_ctl are required for migration replay");
  const dir = mkdtempSync(join(tmpdir(), "staging-repair-"));
  const data = join(dir, "db");
  // No inherited application secrets, PG* overrides, loader hooks, or TCP listener.
  const env = { PATH: process.env.PATH, HOME: dir, LANG: "C" };
  const run = (name, args) => execFileSync(join(bin, name), args, {
    env, encoding: "utf8", timeout: 30_000, stdio: "pipe",
  });
  run("initdb", ["-D", data, "-A", "trust", "-U", "fixture", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", join(dir, "postgres.log"), "-o",
    `-F -k ${dir} -c listen_addresses='' -c shared_buffers=16MB -c max_connections=10`, "-w", "start"]);
  const config = { host: dir, port: 5432, user: "fixture", database: "postgres" };
  const db = new Client(config);
  t.after(async () => {
    try { await db.end(); }
    finally {
      run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  await db.connect();
  await db.query(`
    CREATE TABLE public.tenants (id integer PRIMARY KEY);
    CREATE TABLE public.personas (id integer PRIMARY KEY);
    CREATE TABLE public.conversations (id integer PRIMARY KEY);
    INSERT INTO public.tenants VALUES (101), (202);
  `);
  const { runRepair } = require("../../scripts/railway-staging-startup-repair.cjs");
  // Inject only this disposable unix-socket connection; never use workspace DATABASE_URL.
  const clientFactory = options => new Client({ ...options, connectionString: undefined, ...config });

  await t.test("default check reports missing tables without creating them", async () => {
    const report = await runRepair({ env: fixtureEnv(), clientFactory });
    assert.equal(report.mode, "check");
    assert.equal(report.ready, false);
    assert.deepEqual(report.missingTables, ["spark_outbox", "tool_performance"]);
    assert.equal((await db.query("SELECT to_regclass('public.spark_outbox') AS name")).rows[0].name, null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tenants")).rows[0].n, 2);
  });

  await t.test("explicit repair enables the actual Felix bootstrap and tenant-scoped ranking reads", async () => {
    const report = await runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory });
    assert.equal(report.ready, true);
    const source = readFileSync(join(__dirname, "../../server/felix-connector/schema.ts"), "utf8");
    const bootstrap = source.match(/await db\.execute\(sql`([\s\S]+?)`\)/);
    assert.ok(bootstrap, "Actual Felix bootstrap SQL must be replayed");
    await db.query(bootstrap[1]);
    assert.equal((await db.query("SELECT to_regclass('public.felix_line_audit') AS name")).rows[0].name,
      "felix_line_audit");
    await db.query(`
      INSERT INTO public.personas VALUES (11);
      INSERT INTO public.spark_outbox (tenant_id, persona_id, message) VALUES (101, 11, 'fixture');
      INSERT INTO public.tool_performance (id, tenant_id, tool_name) VALUES
        (1, 101, 'tenant-a-tool'), (2, 202, 'tenant-b-tool');
    `);
    const ranking = await db.query(`
      SELECT tool_name, success_count, fail_count, last_success_at, last_failure_at
      FROM public.tool_performance WHERE tenant_id = $1
    `, [101]);
    assert.deepEqual(ranking.rows.map(r => r.tool_name), ["tenant-a-tool"]);
    assert.equal((await db.query("SELECT recipient FROM public.spark_outbox WHERE tenant_id=$1", [101]))
      .rows[0].recipient, "spark");
    await assert.rejects(db.query(
      "INSERT INTO public.tool_performance (id, tenant_id, tool_name) VALUES (3, 999, 'invalid')",
    ), { code: "23503" });
  });

  await t.test("repeated apply preserves existing rows and the read-only check reports ready", async () => {
    const before = await db.query("SELECT * FROM public.spark_outbox ORDER BY id");
    assert.equal((await runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory })).ready, true);
    assert.deepEqual((await db.query("SELECT * FROM public.spark_outbox ORDER BY id")).rows, before.rows);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tool_performance")).rows[0].n, 2);
    assert.equal((await runRepair({ env: fixtureEnv(), clientFactory })).ready, true);
  });

  await t.test("a failure after the first table creation rolls the whole repair back", async () => {
    await db.query("DROP TABLE public.spark_outbox, public.tool_performance");
    const failingFactory = options => {
      const client = clientFactory(options);
      const query = client.query.bind(client);
      client.query = (sql, ...values) => {
        if (typeof sql === "string" && sql.includes("CREATE TABLE IF NOT EXISTS public.tool_performance")) {
          return Promise.reject(Object.assign(new Error("fixture DDL failure"), { code: "XX000" }));
        }
        return query(sql, ...values);
      };
      return client;
    };
    await assert.rejects(runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory: failingFactory }),
      /fixture DDL failure/);
    const result = await db.query(`
      SELECT to_regclass('public.spark_outbox') AS spark, to_regclass('public.tool_performance') AS perf
    `);
    assert.deepEqual(result.rows[0], { spark: null, perf: null });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tenants")).rows[0].n, 2);
  });

  await t.test("an alternate-schema relation is refused instead of creating a duplicate", async () => {
    await db.query("CREATE SCHEMA shadow; CREATE TABLE shadow.spark_outbox (id integer)");
    await assert.rejects(runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory }), /outside public/);
    assert.equal((await db.query("SELECT to_regclass('public.spark_outbox') AS name")).rows[0].name, null);
    await db.query("DROP SCHEMA shadow CASCADE");
  });

  await t.test("an unexpected existing table shape is refused without partial repair", async () => {
    await db.query("CREATE TABLE public.tool_performance (id serial PRIMARY KEY)");
    await assert.rejects(runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory }),
      /Unexpected existing column contract/);
    assert.equal((await db.query("SELECT to_regclass('public.spark_outbox') AS name")).rows[0].name, null);
    await db.query("DROP TABLE public.tool_performance");
  });

  await t.test("legacy Spark rows receive the default recipient without being lost", async () => {
    await runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory });
    await db.query(`
      ALTER TABLE public.spark_outbox DROP COLUMN recipient;
      INSERT INTO public.spark_outbox (tenant_id, persona_id, message) VALUES (101, 11, 'legacy fixture')
    `);
    const check = await runRepair({ env: fixtureEnv(), clientFactory });
    assert.deepEqual(check.missingColumns, ["spark_outbox.recipient"]);
    await runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory });
    assert.deepEqual((await db.query("SELECT message, recipient FROM public.spark_outbox WHERE tenant_id=$1", [101]))
      .rows, [{ message: "legacy fixture", recipient: "spark" }]);
  });

  await t.test("an ambiguous commit is reported as uncertain and resolved by a read-only check", async () => {
    const ambiguousFactory = options => {
      const client = clientFactory(options);
      const query = client.query.bind(client);
      client.query = async (sql, ...values) => {
        const result = await query(sql, ...values);
        if (sql === "COMMIT") throw Error("fixture lost commit acknowledgement");
        return result;
      };
      return client;
    };
    await assert.rejects(
      runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory: ambiguousFactory }),
      /outcome is uncertain.*--check/,
    );
    assert.equal((await runRepair({ env: fixtureEnv(), clientFactory })).ready, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.spark_outbox")).rows[0].n, 1);
  });

  await t.test("existing tables without required defaults, foreign keys, or checks cannot be certified ready", async () => {
    const mutations = [
      ["ALTER TABLE public.tool_performance DROP CONSTRAINT tool_performance_tenant_id_fkey",
        "ALTER TABLE public.tool_performance ADD FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)"],
      ["ALTER TABLE public.tool_performance ALTER COLUMN success_count DROP DEFAULT",
        "ALTER TABLE public.tool_performance ALTER COLUMN success_count SET DEFAULT 0"],
      ["ALTER TABLE public.spark_outbox DROP CONSTRAINT spark_outbox_message_length",
        "ALTER TABLE public.spark_outbox ADD CONSTRAINT spark_outbox_message_length CHECK (char_length(message) BETWEEN 1 AND 4000)"],
    ];
    for (const [mutate, restore] of mutations) {
      await db.query(mutate);
      try {
        await assert.rejects(runRepair({ env: fixtureEnv(), clientFactory }), /Unexpected existing/);
      } finally { await db.query(restore); }
    }
  });

  await t.test("cleanup errors cannot replace an uncertain commit warning", async () => {
    const brokenCloseFactory = options => {
      const client = clientFactory(options);
      const query = client.query.bind(client);
      const end = client.end.bind(client);
      client.query = async (sql, ...values) => {
        const result = await query(sql, ...values);
        if (sql === "COMMIT") throw Error("fixture lost commit acknowledgement");
        return result;
      };
      client.end = async () => { await end(); throw Error("fixture cleanup failure"); };
      return client;
    };
    await assert.rejects(
      runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory: brokenCloseFactory }),
      /outcome is uncertain.*--check/,
    );
  });

  await t.test("rollback uncertainty survives a second failure during connection cleanup", async () => {
    const brokenRollbackFactory = options => {
      const client = clientFactory(options);
      const query = client.query.bind(client);
      const end = client.end.bind(client);
      client.query = async (sql, ...values) => {
        if (sql.includes("pg_advisory_xact_lock")) throw Error("fixture operation failure");
        const result = await query(sql, ...values);
        if (sql === "ROLLBACK") throw Error("fixture rollback acknowledgement lost");
        return result;
      };
      client.end = async () => { await end(); throw Error("fixture cleanup failure"); };
      return client;
    };
    await assert.rejects(
      runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory: brokenRollbackFactory }),
      /rollback could not be confirmed.*cleanup also failed/,
    );
  });

  await t.test("stalled cleanup is bounded and reports the committed outcome", async () => {
    const stalledFactory = options => {
      const client = clientFactory(options);
      client.end = () => new Promise(() => {});
      return client;
    };
    const start = Date.now();
    await assert.rejects(
      runRepair({ env: fixtureEnv(), args: ["--apply"], clientFactory: stalledFactory }),
      /Changes committed.*cleanup also failed/,
    );
    assert.ok(Date.now() - start < 10_000, "Cleanup must have a bounded deadline");
  });

  await t.test("actual telemetry upserts work without an explicit ID and remain tenant-scoped", async () => {
    const source = readFileSync(join(__dirname, "../../server/skill-evolution.ts"), "utf8");
    const statements = [...source.matchAll(/await db\.execute\(sql`([\s\S]+?)`\)/g)].slice(0, 2);
    assert.equal(statements.length, 2);
    async function replay(statement, tenantId, durationMs = 5) {
      const values = { tenantId, toolName: "writer-fixture", durationMs, "failureReason || null": "fixture failure" };
      const params = [];
      const query = statement.replace(/\$\{([^}]+)\}/g, (_match, key) => {
        assert.ok(Object.hasOwn(values, key), `Unexpected writer input: ${key}`);
        params.push(values[key]);
        return `$${params.length}`;
      });
      await db.query(query, params);
    }
    await replay(statements[0][1], 101);
    await replay(statements[0][1], 101);
    await replay(statements[1][1], 101, 3);
    await replay(statements[0][1], 202);
    const rows = (await db.query(`
      SELECT tenant_id, success_count, fail_count, total_duration_ms::int
      FROM public.tool_performance WHERE tool_name=$1 ORDER BY tenant_id
    `, ["writer-fixture"])).rows;
    assert.deepEqual(rows, [
      { tenant_id: 101, success_count: 2, fail_count: 1, total_duration_ms: 13 },
      { tenant_id: 202, success_count: 1, fail_count: 0, total_duration_ms: 5 },
    ]);
  });

  await t.test("a nonunique replacement for the writer conflict index cannot pass readiness", async () => {
    await db.query(`DROP INDEX public.idx_tool_performance_tenant_tool;
      CREATE INDEX idx_tool_performance_tenant_tool ON public.tool_performance (tenant_id, tool_name)`);
    try {
      await assert.rejects(runRepair({ env: fixtureEnv(), clientFactory }), /Unexpected existing index contract/);
    } finally {
      await db.query(`DROP INDEX public.idx_tool_performance_tenant_tool;
        CREATE UNIQUE INDEX idx_tool_performance_tenant_tool ON public.tool_performance (tenant_id, tool_name)`);
    }
  });
});

"use strict";

// Standalone operator command. Deliberately NOT called by app startup/pre-deploy.
const TARGET = Object.freeze({
  project: "47d2eeee-2890-4cf8-bf3b-4f6d19cd6d16",
  environment: "a9826904-c427-4fcf-a26f-6d4920f0e75e",
  service: "2e0770cc-b23c-432f-8b94-7741c06c955b",
  hostname: "visionclaw-staging-db.railway.internal",
});

class RepairError extends Error {}

const COLUMNS = {
  spark_outbox: {
    id: ["int4", true], tenant_id: ["int4", true], persona_id: ["int4", true],
    conversation_id: ["int4", false], message: ["text", true], recipient: ["text", true],
    created_at: ["timestamp", true],
  },
  tool_performance: {
    id: ["int4", true], tenant_id: ["int4", true], tool_name: ["text", true],
    success_count: ["int4", true], fail_count: ["int4", true],
    total_duration_ms: ["int8", true], last_failure_reason: ["text", false],
    last_success_at: ["timestamptz", false], last_failure_at: ["timestamptz", false],
    created_at: ["timestamptz", true], updated_at: ["timestamptz", true],
  },
};

const INDEXES = {
  idx_spark_outbox_tenant_id: ["spark_outbox", ["tenant_id", "id"]],
  idx_spark_outbox_tenant_created: ["spark_outbox", ["tenant_id", "created_at"]],
  idx_spark_outbox_persona: ["spark_outbox", ["persona_id"]],
  idx_spark_outbox_conversation: ["spark_outbox", ["conversation_id"]],
  idx_spark_outbox_recipient_cursor: ["spark_outbox", ["tenant_id", "recipient", "id"]],
  idx_tool_performance_tenant_tool: ["tool_performance", ["tenant_id", "tool_name"], true],
};

const DEFAULTS = {
  spark_outbox: { recipient: ["'spark'::text"], created_at: ["now()", "CURRENT_TIMESTAMP"] },
  tool_performance: {
    success_count: ["0"], fail_count: ["0"], total_duration_ms: ["0", "'0'::bigint"],
    created_at: ["now()", "CURRENT_TIMESTAMP"], updated_at: ["now()", "CURRENT_TIMESTAMP"],
  },
};
const FOREIGN_KEYS = [
  ["spark_outbox", "tenant_id", "tenants", "c"],
  ["spark_outbox", "persona_id", "personas", "a"],
  ["spark_outbox", "conversation_id", "conversations", "n"],
  ["tool_performance", "tenant_id", "tenants", "a"],
];

const CREATE_TABLE = {
  spark_outbox: `
    CREATE TABLE IF NOT EXISTS public.spark_outbox (
      id serial PRIMARY KEY,
      tenant_id integer NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
      persona_id integer NOT NULL REFERENCES public.personas(id),
      conversation_id integer REFERENCES public.conversations(id) ON DELETE SET NULL,
      message text NOT NULL,
      recipient text NOT NULL DEFAULT 'spark',
      created_at timestamp NOT NULL DEFAULT pg_catalog.now(),
      CONSTRAINT spark_outbox_message_length CHECK (pg_catalog.char_length(message) BETWEEN 1 AND 4000)
    )
  `,
  tool_performance: `
    CREATE TABLE IF NOT EXISTS public.tool_performance (
      id serial PRIMARY KEY,
      tenant_id integer NOT NULL REFERENCES public.tenants(id),
      tool_name text NOT NULL,
      success_count integer NOT NULL DEFAULT 0,
      fail_count integer NOT NULL DEFAULT 0,
      total_duration_ms bigint NOT NULL DEFAULT 0,
      last_failure_reason text,
      last_success_at timestamptz,
      last_failure_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
    )
  `,
};

async function inspect(client) {
  const context = await client.query("SELECT current_schema() AS schema");
  if (context.rows[0]?.schema !== "public") {
    throw new RepairError("Expected public as the active schema; inspect search_path before repairing");
  }
  const dependencies = await client.query(`
    SELECT name, to_regclass(format('public.%I', name)) IS NOT NULL AS present
    FROM unnest($1::text[]) AS wanted(name)
  `, [["tenants", "personas", "conversations"]]);
  if (dependencies.rows.some(r => !r.present)) {
    throw new RepairError("Staging base tables are missing; refusing a partial startup repair");
  }
  const catalog = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind AS relation_kind, a.attname AS column_name,
      ty.typname AS type_name, a.attnotnull AS not_null,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr,
      (a.attidentity <> '' OR (
        left(pg_catalog.pg_get_expr(d.adbin, d.adrelid), 8) = 'nextval(' AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_depend dep
          WHERE dep.classid = 'pg_catalog.pg_attrdef'::regclass AND dep.objid = d.oid
            AND dep.refclassid = 'pg_catalog.pg_class'::regclass
            AND dep.refobjid = pg_catalog.to_regclass(
              pg_catalog.pg_get_serial_sequence(pg_catalog.format('%I.%I', n.nspname, c.relname), a.attname))
        ))) AS auto_id,
      EXISTS (SELECT 1 FROM pg_catalog.pg_constraint co
        WHERE co.conrelid = c.oid AND co.contype = 'p'
          AND co.conkey = ARRAY[a.attnum]::smallint[]) AS primary_key
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.relname = ANY($1::text[]) AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  `, [Object.keys(COLUMNS)]);
  if (catalog.rows.some(r => r.schema_name !== "public")) {
    throw new RepairError("Target relations exist outside public; resolve schema ambiguity before repairing");
  }
  const missingTables = [];
  const missingColumns = [];
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const rows = catalog.rows.filter(r => r.table_name === table);
    if (!rows.length) { missingTables.push(table); continue; }
    for (const [column, [type, notNull]] of Object.entries(columns)) {
      const row = rows.find(r => r.column_name === column);
      if (!row && table === "spark_outbox" && column === "recipient") {
        missingColumns.push("spark_outbox.recipient");
        continue;
      } else if (!row || !["r", "p"].includes(row.relation_kind) || row.type_name !== type || row.not_null !== notNull
        || (column === "id" && !row.primary_key)) {
        throw new RepairError(`Unexpected existing column contract: public.${table}.${column}`);
      }
      const defaults = DEFAULTS[table][column];
      if (column === "id" ? !row.auto_id
        : defaults ? !defaults.includes(row.default_expr) : row.default_expr !== null) {
        throw new RepairError(`Unexpected existing default contract: public.${table}.${column}`);
      }
    }
  }
  const foreignKeys = await client.query(`
    SELECT ct.relname AS table_name, np.nspname AS parent_schema, cp.relname AS parent,
      co.confdeltype AS on_delete, co.confupdtype AS on_update, co.convalidated AS valid,
      ARRAY(SELECT a.attname::text FROM unnest(co.conkey) WITH ORDINALITY k(num, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = ct.oid AND a.attnum = k.num ORDER BY k.ord) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(co.confkey) WITH ORDINALITY k(num, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = cp.oid AND a.attnum = k.num ORDER BY k.ord) AS parent_columns
    FROM pg_catalog.pg_constraint co
    JOIN pg_catalog.pg_class ct ON ct.oid = co.conrelid
    JOIN pg_catalog.pg_namespace nt ON nt.oid = ct.relnamespace
    JOIN pg_catalog.pg_class cp ON cp.oid = co.confrelid
    JOIN pg_catalog.pg_namespace np ON np.oid = cp.relnamespace
    WHERE co.contype = 'f' AND nt.nspname = 'public' AND ct.relname = ANY($1::text[])
  `, [Object.keys(COLUMNS)]);
  for (const [table, column, parent, onDelete] of FOREIGN_KEYS) {
    if (missingTables.includes(table)) continue;
    if (!foreignKeys.rows.some(r => r.table_name === table && r.parent_schema === "public"
      && r.parent === parent && r.on_delete === onDelete && r.on_update === "a" && r.valid
      && JSON.stringify(r.columns) === JSON.stringify([column])
      && JSON.stringify(r.parent_columns) === '["id"]')) {
      throw new RepairError(`Unexpected existing foreign-key contract: public.${table}.${column}`);
    }
  }
  if (!missingTables.includes("spark_outbox")) {
    const checks = await client.query(`
      SELECT pg_catalog.pg_get_constraintdef(co.oid) AS definition
      FROM pg_catalog.pg_constraint co
      WHERE co.conrelid = 'public.spark_outbox'::regclass AND co.contype = 'c' AND co.convalidated
    `);
    if (!checks.rows.some(r => r.definition.replace(/[\s()"]/g, "").replace(/pg_catalog\./g, "").toLowerCase()
      === "checkchar_lengthmessage>=1andchar_lengthmessage<=4000")) {
      throw new RepairError("Unexpected existing message-length constraint: public.spark_outbox");
    }
  }
  const indexes = await client.query(`
    SELECT ci.relname AS name, ct.relname AS table_name, i.indisvalid AS valid,
      i.indisunique AS unique, i.indimmediate AS immediate,
      (i.indpred IS NULL AND i.indexprs IS NULL) AS plain,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = ct.oid AND a.attnum = k.attnum
        ORDER BY k.ord) AS columns
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = ci.relnamespace
    JOIN pg_catalog.pg_class ct ON ct.oid = i.indrelid
    WHERE n.nspname = 'public' AND ci.relname = ANY($1::text[])
  `, [Object.keys(INDEXES)]);
  const missingIndexes = [];
  for (const [name, [table, columns, unique]] of Object.entries(INDEXES)) {
    const row = indexes.rows.find(r => r.name === name);
    if (!row) missingIndexes.push(name);
    else if (row.table_name !== table || !row.valid || !row.plain || !row.immediate || row.unique !== !!unique
      || JSON.stringify(row.columns) !== JSON.stringify(columns)) {
      throw new RepairError(`Unexpected existing index contract: public.${name}`);
    }
  }
  return { missingTables, missingColumns, missingIndexes,
    ready: !missingTables.length && !missingColumns.length && !missingIndexes.length };
}

async function runRepair({ env = process.env, args = [], clientFactory } = {}) {
  if (env.ISOLATED_STAGING !== "1"
    || env.RAILWAY_PROJECT_ID !== TARGET.project
    || env.RAILWAY_ENVIRONMENT_ID !== TARGET.environment
    || env.RAILWAY_SERVICE_ID !== TARGET.service) {
    throw new RepairError("Refusing repair outside the approved isolated Railway staging service");
  }
  if (args.length > 1 || (args.length && !["--check", "--apply"].includes(args[0]))) {
    throw new RepairError("Usage: node scripts/railway-staging-startup-repair.cjs [--check|--apply]");
  }
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new RepairError("Invalid staging database URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== TARGET.hostname
    || url.search || url.hash || (url.port && url.port !== "5432") || url.pathname.length < 2) {
    throw new RepairError("Database URL must target the approved private staging database without overrides");
  }
  const mode = args[0] === "--apply" ? "apply" : "check";
  const factory = clientFactory || (options => new (require("pg").Client)(options));
  const client = factory({
    connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000, query_timeout: 15_000,
    application_name: "railway-staging-startup-repair",
    options: `-c statement_timeout=10000 -c lock_timeout=3000${mode === "check" ? " -c default_transaction_read_only=on" : ""}`,
  });
  let transaction = false;
  let committing = false;
  let operationError;
  try {
    await client.connect();
    await client.query(mode === "check" ? "BEGIN READ ONLY" : "BEGIN");
    transaction = true;
    if (mode === "apply") await client.query("SELECT pg_advisory_xact_lock(7134682990041)");
    let report = await inspect(client);
    if (mode === "apply") {
      for (const table of report.missingTables) await client.query(CREATE_TABLE[table]);
      if (report.missingColumns.includes("spark_outbox.recipient")) {
        await client.query("ALTER TABLE public.spark_outbox ADD COLUMN recipient text NOT NULL DEFAULT 'spark'");
      }
      for (const name of report.missingIndexes) {
        const [table, columns, unique] = INDEXES[name];
        // Identifiers come exclusively from the fixed INDEXES contract above.
        await client.query(`CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ON public.${table} (${columns.join(", ")})`);
      }
      report = await inspect(client);
      if (!report.ready) throw new RepairError("Post-repair verification failed; transaction will be rolled back");
    }
    committing = true;
    await client.query("COMMIT");
    transaction = false;
    committing = false;
    return { mode, ...report };
  } catch (error) {
    let rollbackError;
    if (transaction) {
      try { await client.query("ROLLBACK"); }
      catch (failure) { rollbackError = failure; }
    }
    if (committing) {
      operationError = new RepairError("Commit acknowledgement failed; outcome is uncertain. Run --check before retrying", { cause: error });
    } else if (rollbackError) {
      operationError = new RepairError("Repair failed and rollback could not be confirmed; inspect the staging database", {
        cause: new AggregateError([error, rollbackError]),
      });
    } else {
      operationError = error;
    }
    throw operationError;
  } finally {
    let closeTimer;
    try {
      await Promise.race([
        Promise.resolve().then(() => client.end()),
        new Promise((_, reject) => {
          closeTimer = setTimeout(() => reject(new Error("Connection cleanup timed out")), 3_000);
        }),
      ]);
    } catch (closeError) {
      const cleanupErrors = new AggregateError([operationError, closeError].filter(Boolean));
      // Forced teardown can emit a later pg Client error. Retain it on the
      // already-failed outcome rather than causing an uncaught exception.
      client.on("error", error => cleanupErrors.errors.push(error));
      // pg has no separate public force-close method; destroy a stalled socket.
      try { client.connection?.stream?.destroy(); }
      catch (forceError) { cleanupErrors.errors.push(forceError); }
      const message = operationError instanceof RepairError ? operationError.message
        : operationError ? "Database operation failed; run --check before retrying"
          : mode === "apply" ? "Changes committed; run --check before continuing"
            : "Read-only check completed; run --check before continuing";
      throw new RepairError(`${message}; connection cleanup also failed`, {
        cause: cleanupErrors,
      });
    } finally {
      clearTimeout(closeTimer);
    }
  }
}

module.exports = { runRepair, TARGET };

if (require.main === module) {
  runRepair({ args: process.argv.slice(2) }).then(report => {
    console.log(JSON.stringify(report));
    if (!report.ready) process.exitCode = 2;
  }).catch(error => {
    const safeCode = typeof error?.code === "string"
      && (/^[A-Z0-9]{5}$/.test(error.code) || ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(error.code));
    const code = safeCode ? ` (${error.code})` : "";
    console.error(`[staging-startup-repair] ${error instanceof RepairError ? error.message : `Database operation failed${code}`}`);
    process.exitCode = 1;
  });
}

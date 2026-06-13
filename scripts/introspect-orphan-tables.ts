#!/usr/bin/env tsx
// R105.2 — One-shot introspection of orphan DB tables (live in DB, not in
// shared/schema.ts) into a generated Drizzle schema file. Lets the rest of the
// codebase get type safety for tables previously created via raw psql ALTER.
//
// Run: npx tsx scripts/introspect-orphan-tables.ts
// Emits: shared/schema-orphans.ts (overwrites)
//
// Safety: read-only — only queries information_schema + pg_indexes. Never
// mutates the database. Generated file declares tables but does NOT alter
// them; existing raw-SQL call sites continue to work unchanged.

import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const ORPHANS = [
  "agent_evals", "browser_workflows", "calendar_feeds", "contact_submissions",
  "contracts", "crew_agents", "crew_flows", "crew_tasks", "customer_interactions",
  "delegation_scratchpad", "flow_steps", "graph_memory", "graph_memory_links",
  "key_value_store", "knowledge_nudges", "knowledge_triples", "kpi_metrics",
  "marketing_calendar", "marketing_results", "mcp_api_keys", "mind_events",
  "mind_tickets", "minds", "pending_deliveries", "presenter_slide_images",
  "scheduled_posts", "sculptor_sessions", "security_scan_results", "sessions",
  "skill_rag_decisions", "storefront_checkout_hits", "tool_optimizations",
  "tool_performance", "user_profiles", "webhook_events", "wellbeing_interventions",
];

interface ColInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  is_identity: string;
}

function camelize(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function mapPgTypeToDrizzle(col: ColInfo): { fn: string; needsImport: string } {
  const t = col.udt_name.toLowerCase();
  const isArray = t.startsWith("_");
  const base = isArray ? t.slice(1) : t;
  let fn: string;
  let imp: string;
  switch (base) {
    case "int2":
    case "int4":
      fn = `integer("${col.column_name}")`;
      imp = "integer";
      break;
    case "int8":
      fn = `bigint("${col.column_name}", { mode: "number" })`;
      imp = "bigint";
      break;
    case "serial":
      fn = `serial("${col.column_name}")`;
      imp = "serial";
      break;
    case "text":
      fn = `text("${col.column_name}")`;
      imp = "text";
      break;
    case "varchar":
    case "bpchar":
      fn = col.character_maximum_length
        ? `varchar("${col.column_name}", { length: ${col.character_maximum_length} })`
        : `varchar("${col.column_name}")`;
      imp = "varchar";
      break;
    case "bool":
      fn = `boolean("${col.column_name}")`;
      imp = "boolean";
      break;
    case "timestamp":
    case "timestamptz":
      fn = `timestamp("${col.column_name}"${base === "timestamptz" ? `, { withTimezone: true }` : ""})`;
      imp = "timestamp";
      break;
    case "date":
      fn = `date("${col.column_name}")`;
      imp = "date";
      break;
    case "json":
    case "jsonb":
      fn = `jsonb("${col.column_name}")`;
      imp = "jsonb";
      break;
    case "uuid":
      fn = `uuid("${col.column_name}")`;
      imp = "uuid";
      break;
    case "numeric":
    case "decimal":
      fn = `numeric("${col.column_name}")`;
      imp = "numeric";
      break;
    case "float4":
    case "float8":
      fn = `doublePrecision("${col.column_name}")`;
      imp = "doublePrecision";
      break;
    case "bytea":
      fn = `customType<{ data: Buffer }>({ dataType: () => "bytea" })("${col.column_name}")`;
      imp = "customType";
      break;
    case "vector":
      fn = `customType<{ data: number[]; driverData: string }>({ dataType: () => "vector" })("${col.column_name}")`;
      imp = "customType";
      break;
    default:
      // Fallback for unknown types — keep as text() with a warning comment.
      fn = `text("${col.column_name}")  /* TODO: pg-type=${col.udt_name} (review) */`;
      imp = "text";
  }
  if (isArray) fn = `${fn}.array()`;
  return { fn, needsImport: imp };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
  const pool = new Pool({ connectionString: url });

  const imports = new Set<string>(["pgTable"]);
  const blocks: string[] = [];

  for (const tbl of ORPHANS) {
    const colsRes = await pool.query<ColInfo>(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default,
             character_maximum_length, is_identity
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position
    `, [tbl]);
    if (colsRes.rowCount === 0) {
      blocks.push(`// ${tbl}: NOT FOUND in DB at introspection time (skipped)\n`);
      continue;
    }
    const pkRes = await pool.query<{ column_name: string }>(`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1::regclass) AND i.indisprimary
    `, [tbl]);
    const pkCols = new Set(pkRes.rows.map(r => r.column_name));

    const lines: string[] = [];
    for (const col of colsRes.rows) {
      const { fn, needsImport } = mapPgTypeToDrizzle(col);
      imports.add(needsImport);
      let line = `  ${camelize(col.column_name)}: ${fn}`;
      if (pkCols.has(col.column_name) && pkCols.size === 1) line += `.primaryKey()`;
      if (col.is_nullable === "NO" && !line.includes(".primaryKey()")) line += `.notNull()`;
      // Defaults — preserve sql expressions (now(), nextval, etc.) verbatim.
      if (col.column_default !== null) {
        const d = col.column_default;
        if (/^nextval\(/.test(d)) {
          // serial-ish — leave as-is (declared as integer() since serial()
          // would re-create the sequence on push).
        } else if (/^now\(\)$/i.test(d) || /^CURRENT_TIMESTAMP/i.test(d)) {
          line += `.defaultNow()`;
          imports.add("sql");
        } else if (/^(true|false)$/i.test(d)) {
          line += `.default(${d.toLowerCase()})`;
        } else if (/^-?\d+(\.\d+)?$/.test(d)) {
          // numeric/decimal columns require string defaults in Drizzle; integer
          // columns accept number defaults. Check the udt to decide.
          if (col.udt_name === "numeric" || col.udt_name === "decimal") {
            line += `.default("${d}")`;
          } else {
            line += `.default(${d})`;
          }
        } else if (/^'.*'(::[a-z_ ]+)?$/.test(d)) {
          // String/jsonb default — strip cast suffix, keep quoted literal.
          const stripped = d.replace(/::[a-z_ ]+$/i, "");
          line += `.default(sql\`${stripped}\`)`;
          imports.add("sql");
        } else {
          line += `.default(sql\`${d.replace(/`/g, "\\`")}\`)`;
          imports.add("sql");
        }
      }
      line += ",";
      lines.push(line);
    }
    // Composite PK
    let pkConstraint = "";
    if (pkCols.size > 1) {
      const cols = [...pkCols].map(c => `t.${camelize(c)}`).join(", ");
      pkConstraint = `, (t) => ({ pk: primaryKey({ columns: [${cols}] }) })`;
      imports.add("primaryKey");
    }
    const camelTbl = camelize(tbl);
    blocks.push(`export const ${camelTbl} = pgTable("${tbl}", {\n${lines.join("\n")}\n}${pkConstraint});\n`);
  }

  await pool.end();

  const importList = [...imports].filter(i => i !== "sql" && i !== "customType" && i !== "pgTable").sort().join(", ");
  const extraImports: string[] = [];
  if (imports.has("sql")) extraImports.push(`import { sql } from "drizzle-orm";`);
  if (imports.has("customType")) extraImports.push(`import { customType } from "drizzle-orm/pg-core";`);

  const header = `// AUTO-GENERATED by scripts/introspect-orphan-tables.ts on ${new Date().toISOString()}.
// DO NOT HAND-EDIT. Re-run the script when the DB schema for these tables
// changes. These 34 tables existed in the live DB but were not previously
// declared in shared/schema.ts (Bob's preferred migration path is direct
// psql ALTER per replit.md). This file gives them Drizzle type safety so
// future code can use typed queries instead of raw \`db.execute(sql\`...\`)\`.
//
// Tables: ${ORPHANS.join(", ")}.

import { pgTable, ${importList} } from "drizzle-orm/pg-core";
${extraImports.join("\n")}

`;

  const out = header + blocks.join("\n");
  const outPath = path.join(process.cwd(), "shared", "schema-orphans.ts");
  fs.writeFileSync(outPath, out, "utf8");
  console.log(`✓ wrote ${outPath} (${blocks.length} tables)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

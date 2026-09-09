#!/usr/bin/env tsx
/**
 * Fast, deterministic gate for the Replit Publish flow.
 *
 * This intentionally does not run an LLM audit. It checks the development
 * catalog for database shapes that PostgreSQL accepts locally but the publish
 * schema serializer may not be able to recreate safely.
 */
import { Pool } from "pg";

type CatalogRow = {
  child_table: string;
  constraint_name: string;
  parent_table: string;
  definition: string;
};

// Exact legacy shapes already present before this gate was introduced. They are
// warnings, not release blockers. The full definition is part of the key so any
// column/order/action change becomes a new fail-closed finding.
const REVIEWED_LEGACY_PARENT_INDEX_KEYS = new Set([
  JSON.stringify([
    "eval_runs",
    "eval_runs_harness_manifest_tenant_fk",
    "harness_manifests",
    "FOREIGN KEY (tenant_id, harness_manifest_id) REFERENCES harness_manifests(tenant_id, id) ON DELETE CASCADE",
  ]),
  JSON.stringify([
    "model_harness_deltas",
    "model_harness_deltas_harness_manifest_tenant_fk",
    "harness_manifests",
    "FOREIGN KEY (tenant_id, harness_manifest_id) REFERENCES harness_manifests(tenant_id, id) ON DELETE CASCADE",
  ]),
]);

function parentIndexKey(row: CatalogRow): string {
  return JSON.stringify([
    row.child_table,
    row.constraint_name,
    row.parent_table,
    row.definition,
  ]);
}

const FK_PARENT_KEY_QUERY = `
  SELECT
    child.relname AS child_table,
    fk.conname AS constraint_name,
    parent.relname AS parent_table,
    pg_get_constraintdef(fk.oid) AS definition
  FROM pg_constraint fk
  JOIN pg_class child ON child.oid = fk.conrelid
  JOIN pg_class parent ON parent.oid = fk.confrelid
  WHERE fk.contype = 'f'
    AND fk.connamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint parent_key
      WHERE parent_key.conrelid = fk.confrelid
        AND parent_key.contype IN ('p', 'u')
        AND parent_key.conkey = fk.confkey
    )
  ORDER BY child.relname, fk.conname
`;

const INVALID_CONSTRAINT_QUERY = `
  SELECT conrelid::regclass::text AS relation_name,
         conname AS constraint_name,
         pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
    AND NOT convalidated
  ORDER BY conrelid::regclass::text, conname
`;

const INSPECTION_TIMEOUT_MS = 8000;

function fail(message: string): never {
  console.error(`[publish-preflight] BLOCKED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is missing; refusing to certify an uninspected database");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    statement_timeout: 5000,
    options: "-c lock_timeout=1000ms",
    query_timeout: 6000,
  });

  try {
    let deadline: NodeJS.Timeout | undefined;
    const inspection = Promise.all([
      pool.query<CatalogRow>(FK_PARENT_KEY_QUERY),
      pool.query<{ relation_name: string; constraint_name: string; definition: string }>(
        INVALID_CONSTRAINT_QUERY,
      ),
    ]);
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error(`catalog inspection exceeded ${INSPECTION_TIMEOUT_MS}ms`)),
        INSPECTION_TIMEOUT_MS,
      );
    });
    const [foreignKeys, invalidConstraints] = await Promise.race([inspection, timeout]);
    if (deadline) clearTimeout(deadline);

    const newParentIndexRisks = foreignKeys.rows.filter(
      (row) => !REVIEWED_LEGACY_PARENT_INDEX_KEYS.has(parentIndexKey(row)),
    );
    const reviewedLegacyRisks = foreignKeys.rows.filter(
      (row) => REVIEWED_LEGACY_PARENT_INDEX_KEYS.has(parentIndexKey(row)),
    );

    if (newParentIndexRisks.length > 0) {
      const details = newParentIndexRisks
        .map((row) => `${row.child_table}.${row.constraint_name} → ${row.parent_table}: ${row.definition}`)
        .join("; ");
      fail(
        `foreign key parent key(s) are backed only by standalone indexes, not table constraints: ${details}`,
      );
    }

    if (reviewedLegacyRisks.length > 0) {
      console.warn(
        `[publish-preflight] WARNING: ${reviewedLegacyRisks.length} exact reviewed legacy ` +
          "standalone-index FK shape(s) remain; changed or new shapes still block",
      );
    }

    if (invalidConstraints.rows.length > 0) {
      const details = invalidConstraints.rows
        .map((row) => `${row.relation_name}.${row.constraint_name}: ${row.definition}`)
        .join("; ");
      fail(`unvalidated constraint(s) would make the publish schema unsafe: ${details}`);
    }

    console.log(
      "[publish-preflight] READY: development database reachable; " +
        "no new non-portable foreign-key parent keys; all public constraints validated",
    );
  } catch (error) {
    if (process.exitCode !== 1) {
      process.exitCode = 1;
      console.error(
        `[publish-preflight] BLOCKED: database inspection failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } finally {
    await pool.end();
  }
}

void main();
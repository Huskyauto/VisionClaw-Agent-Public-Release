import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../../server/db";
import { ensureDefaultDeliverableContracts } from "../../server/deliverable-verifier";

test("delivery verification bootstraps its required contracts on a fresh deployment", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/deliverable-verifier.ts"), "utf8");

  assert.match(source, /export async function ensureDefaultDeliverableContracts/);
  assert.match(source, /await ensureDefaultDeliverableContracts\(\);\s+const contract = await getContract/);
  assert.match(source, /ON CONFLICT \(deliverable_type\) DO NOTHING/);
  assert.doesNotMatch(source, /ON CONFLICT \(deliverable_type\) DO UPDATE/);
  assert.match(source, /type: "word_document"/);
  assert.match(source, /type: "text_document"/);
});

test("delivery-contract bootstrap binds each required extension as a PostgreSQL text[] element", async () => {
  const originalExecute = db.execute;
  const capturedQueries: any[] = [];
  (db as any).execute = async (query: any) => {
    capturedQueries.push(query);
    return { rows: [] };
  };

  try {
    await ensureDefaultDeliverableContracts();
  } finally {
    (db as any).execute = originalExecute;
  }

  assert.equal(capturedQueries.length, 11, "every built-in delivery contract should be seeded");
  const firstQuery = new PgDialect().sqlToQuery(capturedQueries[0]);
  assert.match(
    firstQuery.sql,
    /ARRAY\[\$2, \$3\]::text\[\]/,
    "required_extensions must be a comma-separated PostgreSQL text[] expression",
  );
  assert.deepEqual(
    firstQuery.params.slice(0, 3),
    ["html_page", ".html", ".htm"],
    "each extension must remain an independently parameterized scalar",
  );
});
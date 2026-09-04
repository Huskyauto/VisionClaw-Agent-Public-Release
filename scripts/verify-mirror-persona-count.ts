#!/usr/bin/env tsx
/**
 * Fail-closed guard: the public mirror's docs/personas.md must list exactly as
 * many personas as the platform has ACTIVE personas in the DB. Personas live in
 * TWO source files (server/seed-persona-prompts.ts for the original 16,
 * server/seed.ts object literals for 17+ e.g. Hermes/Echo); a new source
 * location silently drops agents from the mirror (Task #83 incident). This
 * check compares generated-doc count vs the DB truth so the NEXT drift fails
 * the mirror build instead of shipping an incomplete index.
 *
 * Exit codes: 0 = counts match; 1 = mismatch OR doc/DB unreadable (fail closed).
 */
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { checkPersonasDoc } from "./lib/mirror-doc-guards";

async function main(): Promise<number> {
  const docPath = path.join(process.cwd(), "docs/personas.md");
  if (!fs.existsSync(docPath)) {
    console.error(`✗ persona-count guard: ${docPath} missing — run scripts/generate-public-docs.ts first`);
    return 1;
  }
  const doc = fs.readFileSync(docPath, "utf8");

  if (!process.env.DATABASE_URL) {
    console.error("✗ persona-count guard: DATABASE_URL not set — cannot verify active persona count (fail closed)");
    return 1;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let activeCount: number;
  try {
    const res = await pool.query("SELECT count(*)::int AS n FROM personas WHERE is_active = true");
    activeCount = res.rows[0].n;
  } catch (err) {
    console.error(`✗ persona-count guard: DB query failed — ${(err as Error).message} (fail closed)`);
    return 1;
  } finally {
    await pool.end();
  }

  const result = checkPersonasDoc(doc, activeCount);
  if (!result.ok) {
    console.error(`✗ persona-count guard: ${result.message}`);
    return 1;
  }
  console.log(`✓ persona-count guard: ${result.message}`);
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`✗ persona-count guard: unexpected error — ${err}`);
  process.exit(1);
});

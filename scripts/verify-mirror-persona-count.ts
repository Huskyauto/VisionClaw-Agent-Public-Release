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

async function main(): Promise<number> {
  const docPath = path.join(process.cwd(), "docs/personas.md");
  if (!fs.existsSync(docPath)) {
    console.error(`✗ persona-count guard: ${docPath} missing — run scripts/generate-public-docs.ts first`);
    return 1;
  }
  const doc = fs.readFileSync(docPath, "utf8");
  // Count the per-persona section headers ("## <n>. <Name>") — structural, not
  // the prose "**N personas**" line, so a header/body drift is also caught.
  const sectionCount = (doc.match(/^## \d+\.\s+\S/gm) || []).length;
  const headerMatch = doc.match(/\*\*(\d+) personas\*\*/);
  const headerCount = headerMatch ? parseInt(headerMatch[1], 10) : -1;
  if (headerCount !== sectionCount) {
    console.error(`✗ persona-count guard: personas.md internally inconsistent — header says ${headerCount}, ${sectionCount} sections found`);
    return 1;
  }

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

  if (sectionCount !== activeCount) {
    console.error(
      `✗ persona-count guard: docs/personas.md lists ${sectionCount} personas but the platform has ${activeCount} active personas.\n` +
      `  A persona was likely added in a source file scripts/generate-public-docs.ts does not parse\n` +
      `  (it reads server/seed-persona-prompts.ts + server/seed.ts). Fix the extractor, regenerate, and re-run the mirror build.`
    );
    return 1;
  }
  console.log(`✓ persona-count guard: docs/personas.md (${sectionCount}) matches active personas in DB (${activeCount})`);
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`✗ persona-count guard: unexpected error — ${err}`);
  process.exit(1);
});

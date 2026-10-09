/**
 * Owner-operated structural baseline. No writes, LLM calls, or customer content.
 * Usage: npx tsx scripts/knowledge-quality-check.ts --tenant-id=1
 * An explicit tenant ID is mandatory; do not silently default to the admin tenant.
 */
import { checkKnowledgeQuality } from "./lib/knowledge-quality-check";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^--tenant-id=[1-9]\d*$/.test(args[0])) {
    throw new Error("Usage: npx tsx scripts/knowledge-quality-check.ts --tenant-id=<positive integer>");
  }
  const tenantId = Number(args[0].slice("--tenant-id=".length));
  if (!Number.isSafeInteger(tenantId)) throw new Error("Invalid tenant ID");
  const { db, pool } = await import("../server/db");
  try {
    const report = await checkKnowledgeQuality(tenantId, (statement) => db.execute(statement));
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), ...report }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[knowledge-quality-check] failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
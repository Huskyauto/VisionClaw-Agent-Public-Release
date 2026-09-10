#!/usr/bin/env -S npx tsx
// Fork a tenant's CONFIG into a brand-new tenant (no data/memory copied).
//
// Usage:
//   npx tsx scripts/fork-tenant.ts --source <id> --name "<name>" --email <email> [--plan <plan>]
//
// Exit codes: 0 success · 2 bad args · 1 runtime/fork error.
import { forkTenant } from "../server/tenant-fork";
import { pool } from "../server/db";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sourceRaw = arg("--source");
  const name = arg("--name");
  const email = arg("--email");
  const plan = arg("--plan");

  if (!sourceRaw || !name || !email) {
    console.error(
      "[fork-tenant] missing args. Required: --source <id> --name \"<name>\" --email <email>. Optional: --plan <plan>.",
    );
    process.exit(2);
  }
  const sourceTenantId = parseInt(sourceRaw, 10);
  if (!Number.isInteger(sourceTenantId) || sourceTenantId <= 0) {
    console.error(`[fork-tenant] --source must be a positive integer (got "${sourceRaw}").`);
    process.exit(2);
  }

  try {
    const result = await forkTenant(sourceTenantId, { name, email, plan });
    console.log(
      `[fork-tenant] OK — forked tenant ${result.sourceTenantId} → new tenant ${result.newTenantId} (${result.totalRows} config rows copied)`,
    );
    for (const [table, count] of Object.entries(result.copied)) {
      console.log(`  ${table}: ${count}`);
    }
    process.exit(0);
  } catch (err: any) {
    console.error(`[fork-tenant] FAILED: ${err?.message || err}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();

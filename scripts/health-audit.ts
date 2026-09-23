#!/usr/bin/env tsx
/**
 * R70 — Health Audit CLI
 *
 * Usage:
 *   npx tsx scripts/health-audit.ts          # dry-run, report only
 *   npx tsx scripts/health-audit.ts --apply  # also archive stale proposals/heartbeats
 *   npx tsx scripts/health-audit.ts --json   # machine-readable
 */
import { runFullAudit } from "../server/health-audit";

async function main() {
  const apply = process.argv.includes("--apply");
  const asJson = process.argv.includes("--json");
  const report = await runFullAudit({ apply });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.totals.high > 0 ? 1 : 0);
  }

  console.log("=".repeat(70));
  console.log(`HEALTH AUDIT — ${report.generatedAt}`);
  console.log("=".repeat(70));
  console.log("Totals:", report.totals);
  if (apply) console.log("Applied:", report.applied);
  console.log("");

  const grouped: Record<string, typeof report.findings> = {};
  for (const f of report.findings) {
    grouped[f.category] = grouped[f.category] || [];
    grouped[f.category].push(f);
  }
  for (const [cat, items] of Object.entries(grouped)) {
    console.log(`--- ${cat} (${items.length}) ---`);
    for (const f of items.slice(0, 30)) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.message}`);
    }
    if (items.length > 30) console.log(`  ... and ${items.length - 30} more`);
    console.log("");
  }
  process.exit(report.totals.high > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("[health-audit] FAILED:", err);
  process.exit(2);
});

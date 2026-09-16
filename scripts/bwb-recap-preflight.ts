/**
 * Built With Bob — WEEKLY RECAP preflight, standalone.
 *
 *   npx tsx scripts/bwb-recap-preflight.ts
 *
 * Reads the same env the build will see and prints every precondition with an
 * exact fix for any failure. Exit codes: 0 = ready, 1 = blocked, 2 = crash.
 * Run it before a manual build, or wire it into a pre-render check.
 */
import { preflightWeeklyRecap } from "./lib/bwb-recap-preflight";

(async () => {
  const report = preflightWeeklyRecap();
  console.log("\nBuilt With Bob — Weekly Recap preflight\n");
  for (const c of report.checks) {
    const icon = c.ok ? "✓" : c.severity === "block" ? "✗" : "⚠";
    console.log(`  ${icon} ${c.label}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`      FIX: ${c.fix}`);
  }
  console.log("\n" + report.summary + "\n");
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error("[bwb-recap-preflight] crashed:", (e as any)?.message || e);
  process.exit(2);
});

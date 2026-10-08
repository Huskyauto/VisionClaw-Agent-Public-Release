#!/usr/bin/env tsx
/**
 * Advisory review of existing durable research memory.
 * Usage:
 *   npx tsx scripts/research-revisit.ts
 *   npx tsx scripts/research-revisit.ts --need "tool output losing evidence"
 *   npx tsx scripts/research-revisit.ts --json
 * This never changes the inventory, opens links, or applies recommendations.
 */
import { loadResearchRevisitReport } from "./lib/research-revisit-inventory";

const args = process.argv.slice(2);
const needIndex = args.indexOf("--need");
if (args.some((arg, index) => !["--need", "--json"].includes(arg) && index !== needIndex + 1)
    || (needIndex !== -1 && (!args[needIndex + 1] || args[needIndex + 1].startsWith("--")))) {
  console.error('Usage: npx tsx scripts/research-revisit.ts [--need "current problem"] [--json]');
  process.exit(2);
}

try {
  const report = loadResearchRevisitReport({
    need: needIndex === -1 ? undefined : args[needIndex + 1], now: new Date(),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Research revisit (${report.mode}): ${report.candidates.length} candidates from ${report.eligible} eligible topics (${report.total} indexed)`);
    for (const item of report.candidates) {
      console.log(`- ${item.title} [${item.status}; ${item.reason}] — .agents/memory/${item.path}`);
      console.log(`  ${item.summary}`);
      if (item.revisitWhen) console.log(`  Revisit when: ${item.revisitWhen}`);
      if (item.matchedTerms.length) console.log(`  Matched: ${item.matchedTerms.join(", ")}`);
    }
    if (report.omitted) console.log(report.mode === "weekly"
      ? `${report.omitted} other eligible topics rotate into later weeks.`
      : `${report.omitted} more matches omitted; narrow the need or review the inventory directly.`);
    console.log(report.note);
  }
} catch (error) {
  console.error(`Research revisit unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 2;
}
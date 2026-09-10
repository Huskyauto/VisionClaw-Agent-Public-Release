#!/usr/bin/env tsx
// One-shot replay of historical high-value research findings through the
// (fixed) generateCodeProposal pipeline. Idempotent — uses
// research_experiments.replayed_at to skip already-processed rows.
//
// Usage: tsx scripts/replay-research-proposals.ts [--min=6] [--limit=200] [--dry]
import { replayHighValueFindings } from "../server/research-engine";

async function main() {
  const args = process.argv.slice(2);
  const minScore = parseInt(args.find(a => a.startsWith("--min="))?.split("=")[1] || "6", 10);
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "200", 10);
  const dryRun = args.includes("--dry");
  const tenantId = 1;

  console.log(`[replay] start: minScore=${minScore} limit=${limit} dryRun=${dryRun} tenantId=${tenantId}`);
  const t0 = Date.now();
  const summary = await replayHighValueFindings({ minScore, limit, tenantId, dryRun });
  console.log(`[replay] done in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error("[replay] FAILED", err);
  process.exit(1);
});

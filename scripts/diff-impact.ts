#!/usr/bin/env tsx
import { computeDiffImpact } from "../server/lib/codebase-graph";

async function main() {
  const baseRef = process.argv[2] || process.env.DIFF_BASE || "HEAD~1";
  const depth = parseInt(process.env.DIFF_DEPTH || "3", 10);
  const out = await computeDiffImpact({ baseRef, depth });
  if ((out as any).error) { console.error("[diff-impact]", (out as any).error); process.exit(2); }
  console.log(JSON.stringify(out, null, 2));
  console.log("\n--- summary ---");
  console.log(`changed: ${out.changedFiles.length}  in-graph: ${out.changedInGraph.length}  out-of-graph: ${out.changedOutOfGraph.length}`);
  console.log(`direct callers: ${out.directCallerCount}  transitive (≤depth ${out.depth}): ${out.transitiveCallerCount}`);
  console.log(`layers affected:`, out.layersAffected);
  if (out.riskNotes.length) {
    console.log("risk notes:");
    for (const n of out.riskNotes) console.log("  - " + n);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

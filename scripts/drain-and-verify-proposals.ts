/**
 * One-off: drain remaining ≥8-score research findings into code_proposals,
 * then run the proposal-verifier on every unverified proposal so safeApplyProposal
 * stops blocking. Run with: tsx scripts/drain-and-verify-proposals.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { replayHighValueFindings } from "../server/research-engine";
import { verifyProposalById } from "../server/proposal-verifier";

async function main() {
  console.log("=== STEP 1: Drain remaining ≥8-score findings into code_proposals ===");
  const replayResult = await replayHighValueFindings({
    minScore: 8,
    limit: 200,
    tenantId: 1,
    dryRun: false,
  });
  console.log("Replay result:", JSON.stringify(replayResult, null, 2));

  console.log("\n=== STEP 2: Run verifier on every unverified proposal ===");
  const unverified = await db.execute(sql`
    SELECT id, title FROM code_proposals
    WHERE verification_status = 'unverified' OR verification_status IS NULL
    ORDER BY id
  `);
  const rows = ((unverified as any).rows || unverified) as Array<{ id: number; title: string }>;
  console.log(`Found ${rows.length} unverified proposals to verify.`);

  let passed = 0;
  let failed = 0;
  let errored = 0;
  const failureSummary: Array<{ id: number; title: string; reason: string }> = [];

  for (const row of rows) {
    process.stdout.write(`  #${row.id} ${row.title.slice(0, 60)}... `);
    try {
      const result = await verifyProposalById(row.id);
      if (result.status === "passed") {
        passed++;
        console.log("PASSED");
      } else {
        failed++;
        console.log(`FAILED: ${(result.details || "").slice(0, 100)}`);
        failureSummary.push({
          id: row.id,
          title: row.title,
          reason: (result.details || "no details").slice(0, 200),
        });
      }
    } catch (e: any) {
      errored++;
      console.log(`ERROR: ${e.message}`);
      failureSummary.push({ id: row.id, title: row.title, reason: `verifier crashed: ${e.message}` });
    }
  }

  console.log("\n=== FINAL TALLY ===");
  console.log(`Passed verification: ${passed}`);
  console.log(`Failed verification: ${failed}`);
  console.log(`Verifier errored:    ${errored}`);

  // Final state snapshot
  const finalState = await db.execute(sql`
    SELECT verification_status, count(*) as n
    FROM code_proposals
    GROUP BY verification_status
    ORDER BY n DESC
  `);
  console.log("\nFinal verification_status distribution:");
  for (const r of ((finalState as any).rows || finalState) as Array<{ verification_status: string; n: number }>) {
    console.log(`  ${r.verification_status || "(null)"}: ${r.n}`);
  }

  if (failureSummary.length > 0) {
    console.log("\n=== FAILURE DETAILS (top 10) ===");
    for (const f of failureSummary.slice(0, 10)) {
      console.log(`  #${f.id} ${f.title.slice(0, 80)}`);
      console.log(`     ${f.reason.slice(0, 180)}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Script crashed:", e);
  process.exit(1);
});

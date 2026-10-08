// Explicit owner-run, synthetic source fixture. Does not call a model: both
// units have deterministic outcomes. Writes one tenant-scoped audit observation.
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { observeFinalOutput } from "../server/lib/evidence-bound-runtime";
import { observationMatches } from "../server/lib/evidence-bound-observation";

async function main() {
  const i = process.argv.indexOf("--tenant");
  const tenantId = Number(i >= 0 ? process.argv[i + 1] : NaN);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("Use --tenant <owned tenant ID>; this records one synthetic audit fixture.");
  }
  const input = {
    tenantId, output: "Revenue was $900. Profit was $120.",
    sources: [{
      id: "fixture-ledger", title: "Synthetic ledger fixture (not customer data)",
      text: "Revenue was $800. Profit was $120.", tenantId,
      provenance: "supplied_context" as const,
    }],
  };
  const receipt = await observeFinalOutput({ ...input, subject: "ensemble_answer" });
  assert.equal(receipt.units[0].status, "possible_conflict");
  assert.equal(receipt.units[1].status, "exact_source_match");
  assert.equal(receipt.semanticReview, "not_run");
  assert.equal(receipt.audit.persisted, true);
  assert.equal(receipt.verified, false);
  assert.equal(observationMatches(receipt, input), true);
  const result = await db.execute(sql`
    SELECT metadata FROM agent_activity
    WHERE tenant_id = ${tenantId} AND id = ${receipt.audit.activityId}
      AND activity_type = 'evidence_observation'
  `);
  const metadata = (result.rows[0] as any)?.metadata;
  assert.equal(metadata?.outputSha256, receipt.outputSha256);
  assert.equal(metadata?.sourcePackSha256, receipt.sourcePackSha256);
  assert.equal(metadata?.verified, false);
  assert.equal(metadata?.units?.[0]?.status, "possible_conflict");
  assert.equal(metadata?.sources?.[0]?.id, "fixture-ledger");
  console.log(JSON.stringify({
    passed: true, activityId: receipt.audit.activityId, tenantScoped: true,
    outputBound: true, sourceBound: true, modelCalls: 0, verified: false,
    statuses: receipt.units.map(u => u.status),
  }));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Observation smoke failed");
  process.exitCode = 1;
}).finally(() => pool.end());
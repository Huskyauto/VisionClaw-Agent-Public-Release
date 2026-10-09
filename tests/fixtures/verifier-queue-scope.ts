import assert from "node:assert/strict";
const { db, pool } = await import("../../server/db");
const { PgDialect } = await import("drizzle-orm/pg-core");
const queries: string[] = [];
const dialect = new PgDialect();
(db as any).execute = async (query: any) => {
  queries.push(dialect.sqlToQuery(query).sql);
  return { rows: [] };
};
const { claimDueJobs, reclaimExpiredLeases } = await import("../../server/job-queue");
try {
  for (const scope of ["only-verifier", "exclude-verifier", "all"] as const) {
    queries.length = 0;
    await claimDueJobs(1, 300_000, scope);
    await reclaimExpiredLeases(scope);
    assert.equal(queries.length, 3);
    for (const query of queries) {
      if (scope === "all") assert.doesNotMatch(query, /AND kind (?:NOT )?IN/);
      else {
        assert.match(query, scope === "only-verifier" ? /AND kind IN/ : /AND kind NOT IN/);
        assert.match(query, /'research_proposal_verification', 'source_repair_verification'/);
      }
    }
  }
  console.log("VERIFIER_QUEUE_SCOPE_PASS");
} finally { await pool.end(); }
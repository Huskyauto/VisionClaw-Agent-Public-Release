/**
 * Read-only operator report. No model requests and no settings changes.
 * npx tsx scripts/jev-fact-prefilter-report.ts --tenant 1 --days 7
 */
import { parseFactPrefilterReportArgs, factPrefilterReportQuery } from "../server/lib/typesafe-prefilter-report";

async function main() {
  // Reject malformed arguments before importing anything that opens a database.
  const { tenantId, days } = parseFactPrefilterReportArgs(process.argv.slice(2));
  const { db, pool } = await import("../server/db");
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute("SET TRANSACTION READ ONLY");
      await tx.execute("SET LOCAL statement_timeout = '5s'");
      const result = await tx.execute(factPrefilterReportQuery(tenantId, days));
      return result.rows;
    });
    console.log(JSON.stringify({
      tenantId, days, version: "jev-session-fact-prefilter-v2", groups: rows,
      dollarsSaved: null, avoidedExtractorTokens: null,
      limits: [
        "Actual skips are avoided extractor invocations, not proven dollar savings.",
        "Shadow empty candidates are proposals; no call was avoided.",
        "Missed-fact candidates compare with the extractor, not independent human labels.",
        "Failed, pending and legacy observations cannot establish successful savings.",
        "Extractor token costs, retries and independent quality labels are not captured here.",
        "At most 100 mode/model groups are returned; a full page may be incomplete.",
      ],
    }, null, 2));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("Jev report failed: check explicit tenant/days, database access and the staged schema. No model calls were made.");
  process.exitCode = 1;
});

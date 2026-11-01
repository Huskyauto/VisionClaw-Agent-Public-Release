/** Read-only bounded status observer. Never dispatches, retries or changes jobs. */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const id = Number(process.argv[2]), watch = process.argv[3] === "--watch";
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Supply an owner package ID");
  const deadline = Date.now() + (watch ? 10 * 60_000 : 0);
  let previous = "";
  do {
    const result: any = await db.execute(sql`SELECT id,status,
      payload->'state'->>'phase' AS phase, payload->'state'->>'round' AS round,
      payload->'state'->>'stopReason' AS reason, payload->'state'->>'error' AS error,
      (SELECT COALESCE(SUM(value::bigint),0) FROM jsonb_each_text(COALESCE(payload->'packageSpend','{}'::jsonb))) AS reserved_micros,
      (SELECT jsonb_object_agg(key,jsonb_build_object('status',value->>'status','response',value ? 'response','failure',value->'failure'))
        FROM jsonb_each(COALESCE(payload->'compilerRuns','{}'::jsonb))) AS compilers,
      (SELECT jsonb_object_agg(key,jsonb_build_object('responseRetained',value->'raw' IS NOT NULL,'approved',value->'approved','report',value->'report'))
        FROM jsonb_each(COALESCE(payload->'packageContentReview'->'packets','{}'::jsonb))) AS overall,
      payload->'fulfillment'->>'success' AS artifact_ready
      FROM agent_jobs WHERE tenant_id=1 AND ((id=${id} AND kind='company_report_package') OR
        (kind='business_report_review' AND payload->'input'->>'paidJuryBatch'=${`company-package:${id}`})) ORDER BY id`);
    const rows = result.rows || result, encoded = JSON.stringify(rows);
    if (encoded !== previous) { console.log(new Date().toISOString(), encoded); previous = encoded; }
    if (!watch || !rows.some((r: any) => ["pending", "running"].includes(r.status)) ||
        rows.find((r: any) => r.id === id)?.phase === "blocked") break;
    if (Date.now() >= deadline) { console.log("Observation window ended; no retry or mutation performed."); break; }
    await new Promise(resolve => setTimeout(resolve, 15_000));
  } while (true);
}
main().then(() => process.exit(0)).catch(() => { console.error("Status query failed"); process.exit(1); });

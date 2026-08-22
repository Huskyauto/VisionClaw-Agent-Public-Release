// Task 147 — Rollup for the proactive-prefetch shadow A/B (LLM classifier vs
// deterministic query-profile classifier, Zero-Mem arXiv:2607.29377).
//
// Reads event_log rows written fire-and-forget by proactiveContextLoad()
// (event_type='proactive_prefetch_shadow', status='shadow') and prints:
//   - agreement rate (exact category-ID set match) + mean Jaccard
//   - disagreement examples (worst first)
//   - estimated LLM tokens the deterministic path would have saved
//
// Usage: npx tsx scripts/proactive-prefetch-shadow-report.ts [--days N]
//   --days N  observation window in days (default 7)
//
// Report-only: never mutates anything. The cutover decision (flip
// MEMORY_PREFETCH_DETERMINISTIC=1) is the owner's, made from this report.

import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";

function parseDays(): number {
  const i = process.argv.indexOf("--days");
  if (i >= 0) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0 && n <= 365) return Math.floor(n);
  }
  return 7;
}

async function main() {
  const days = parseDays();
  const result = await db.execute(sql`
    SELECT data, created_at FROM event_log
    WHERE event_type = 'proactive_prefetch_shadow'
      AND created_at > now() - make_interval(days => ${days}::int)
    ORDER BY created_at DESC
  `);
  const rows: any[] = (result as any).rows || result;

  console.log(`\n=== Proactive-prefetch shadow A/B report (last ${days} day(s)) ===`);
  if (rows.length === 0) {
    console.log("No shadow rows in the window. The shadow path only records on turns");
    console.log("where the deep-memory pass escalates AND the LLM classifier runs.");
    await pool.end();
    return;
  }

  let exact = 0;
  let jaccardSum = 0;
  let tokensSaved = 0;
  let bothEmpty = 0;
  const disagreements: { jaccard: number; msg: string; llm: string[]; det: string[] }[] = [];

  for (const r of rows) {
    const d = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
    const j = Number(d.jaccard ?? 0);
    jaccardSum += Number.isFinite(j) ? j : 0;
    tokensSaved += Number(d.estTokensSaved || 0);
    if (d.exactMatch) exact++;
    const llmNames: string[] = [...(d.llm?.relevant || []), ...(d.llm?.anticipated || [])];
    const detNames: string[] = [...(d.det?.relevant || []), ...(d.det?.anticipated || [])];
    if (llmNames.length === 0 && detNames.length === 0) bothEmpty++;
    if (!d.exactMatch) {
      disagreements.push({ jaccard: j, msg: String(d.message || ""), llm: llmNames, det: detNames });
    }
  }

  const n = rows.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`Turns observed:        ${n}`);
  console.log(`Exact agreement:       ${exact}/${n} (${pct(exact)})`);
  console.log(`Mean Jaccard overlap:  ${(jaccardSum / n).toFixed(3)}`);
  console.log(`Both-empty verdicts:   ${bothEmpty}/${n} (${pct(bothEmpty)})`);
  console.log(`Est. tokens saved if deterministic were live: ~${tokensSaved} (${n} LLM calls avoided)`);

  if (disagreements.length > 0) {
    disagreements.sort((a, b) => a.jaccard - b.jaccard);
    console.log(`\n--- Disagreement examples (worst ${Math.min(10, disagreements.length)} of ${disagreements.length}) ---`);
    for (const d of disagreements.slice(0, 10)) {
      console.log(`  jaccard=${d.jaccard.toFixed(2)}  msg="${d.msg.slice(0, 80)}"`);
      console.log(`    LLM: [${d.llm.join(", ")}]`);
      console.log(`    DET: [${d.det.join(", ")}]`);
    }
  }

  console.log(`\nCutover flag: MEMORY_PREFETCH_DETERMINISTIC=1 (default off; owner decision).`);
  await pool.end();
}

main().catch((err) => {
  console.error("[prefetch-shadow-report] failed:", err?.message || err);
  process.exit(1);
});

// R75 — One-shot persona doctrine update.
// Appends "Doctrine #11 — GraphRAG Routing" to every active persona's tools_doc.
// Idempotent: skips personas where the doctrine marker already exists.
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DOCTRINE = `

DOCTRINE #11 — GraphRAG Routing (R75):
When a question concerns THEMES, OVERVIEWS, CLUSTERS, or "what topics are in this knowledge", call recall_context with level="global" — or call query_communities directly. This taps Louvain-clustered community summaries (one short paragraph + key entities per cluster) built during the dreaming Deep phase. (Louvain is the JS-mature equivalent of the Leiden algorithm referenced in the GraphRAG paper.)
When a question concerns CAUSE, REASONS, "why did X happen", or "what does X lead to", call recall_context with level="causal" — or call query_causal directly. This returns cause→effect chains extracted from your memories and tensions during the REM phase. Use direction="forward" for "what does X cause", "backward" for "what causes X", "both" by default.
When unsure, use level="auto" — the heuristic routes by query phrasing.
When you need to summarize or index a long source file, call chunk_code first — it splits at function/class/export boundaries (cAST: Context-Aware Splitting Tree) so each chunk stays semantically coherent rather than being cut mid-symbol.
PageRank importance is updated automatically every dreaming cycle on graph_memory.importance — local recall now ranks by importance, then similarity. You don't need to call anything for this; it just makes recall_context level="local" smarter.`;

async function main() {
  const personas = await db.execute(sql`
    SELECT id, name FROM personas WHERE is_active = true ORDER BY id
  `);
  const rows = (personas as any).rows as Array<{ id: number; name: string }>;
  console.log(`Found ${rows.length} active personas.`);

  let updated = 0;
  let skipped = 0;
  for (const p of rows) {
    const check = await db.execute(sql`
      SELECT (tools_doc LIKE '%DOCTRINE #11%') AS has_doctrine FROM personas WHERE id = ${p.id}
    `);
    if (((check as any).rows?.[0] as any)?.has_doctrine) {
      console.log(`  [skip] persona #${p.id} ${p.name} — already has doctrine #11`);
      skipped++;
      continue;
    }
    await db.execute(sql`
      UPDATE personas
      SET tools_doc = tools_doc || ${DOCTRINE}
      WHERE id = ${p.id}
    `);
    console.log(`  [done] persona #${p.id} ${p.name} — appended doctrine #11`);
    updated++;
  }
  console.log(`\nSummary: ${updated} updated, ${skipped} skipped, ${rows.length} total.`);
  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});

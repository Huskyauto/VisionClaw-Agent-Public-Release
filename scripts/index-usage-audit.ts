#!/usr/bin/env tsx
/**
 * R120 — Index usage audit
 *
 * Surfaces never-used and rarely-used indexes from pg_stat_user_indexes so we
 * can drop dead indexes that burn write amplification + cache footprint on the
 * 511 production indexes. Gemini-3.5-Flash-Extended review flagged "managing
 * 177 tables and 511 production indexes on a unified relational architecture
 * introduces massive maintenance overhead" — this script makes that visible.
 *
 * Exit codes:
 *   0 — audit complete, report written to data/index-usage-audit.json
 *   2 — DATABASE_URL missing
 *   3 — DB connection failed
 *
 * Wired into weekly-maintenance Pass 10 (R120).
 */
import { Pool } from "pg";
import fs from "fs";
import path from "path";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[index-audit] DATABASE_URL missing");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let rows: any[];
  try {
    const result = await pool.query(`
      SELECT
        s.schemaname,
        s.relname    AS table_name,
        s.indexrelname AS index_name,
        s.idx_scan,
        s.idx_tup_read,
        s.idx_tup_fetch,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
        pg_relation_size(s.indexrelid) AS index_bytes,
        idx.indisunique AS is_unique,
        idx.indisprimary AS is_primary
      FROM pg_stat_user_indexes s
      JOIN pg_index idx ON idx.indexrelid = s.indexrelid
      WHERE s.schemaname = 'public'
      ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;
    `);
    rows = result.rows;
  } catch (err: any) {
    console.error("[index-audit] query failed:", err.message);
    await pool.end();
    process.exit(3);
  }

  await pool.end();

  const total = rows.length;
  const neverUsed = rows.filter((r) => Number(r.idx_scan) === 0 && !r.is_primary && !r.is_unique);
  const rarelyUsed = rows.filter((r) => Number(r.idx_scan) > 0 && Number(r.idx_scan) < 10 && !r.is_primary);
  const totalBytes = rows.reduce((s, r) => s + Number(r.index_bytes), 0);
  const neverUsedBytes = neverUsed.reduce((s, r) => s + Number(r.index_bytes), 0);

  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      total_indexes: total,
      never_used: neverUsed.length,
      rarely_used_lt_10_scans: rarelyUsed.length,
      total_index_bytes: totalBytes,
      total_index_size_mb: (totalBytes / 1024 / 1024).toFixed(2),
      never_used_bytes: neverUsedBytes,
      never_used_size_mb: (neverUsedBytes / 1024 / 1024).toFixed(2),
      reclaimable_pct: total > 0 ? ((neverUsedBytes / totalBytes) * 100).toFixed(1) : "0",
    },
    never_used_candidates_for_drop: neverUsed.slice(0, 50).map((r) => ({
      table: r.table_name,
      index: r.index_name,
      size: r.index_size,
    })),
    rarely_used: rarelyUsed.slice(0, 30).map((r) => ({
      table: r.table_name,
      index: r.index_name,
      scans: Number(r.idx_scan),
      size: r.index_size,
    })),
  };

  const outDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "index-usage-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`[index-audit] ${total} indexes scanned`);
  console.log(`[index-audit]   never used (non-PK/UQ): ${neverUsed.length}`);
  console.log(`[index-audit]   rarely used (<10 scans): ${rarelyUsed.length}`);
  console.log(`[index-audit]   total index size: ${report.summary.total_index_size_mb} MB`);
  console.log(`[index-audit]   reclaimable from drops: ${report.summary.never_used_size_mb} MB (${report.summary.reclaimable_pct}%)`);
  console.log(`[index-audit] report → ${outPath}`);

  if (neverUsed.length > 0) {
    console.log(`[index-audit] top 5 drop candidates:`);
    neverUsed.slice(0, 5).forEach((r) => {
      console.log(`  • ${r.table_name}.${r.index_name} (${r.index_size})`);
    });
  }
}

main().catch((err) => {
  console.error("[index-audit] fatal:", err);
  process.exit(1);
});

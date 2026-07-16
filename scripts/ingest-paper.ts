#!/usr/bin/env tsx
/**
 * scripts/ingest-paper.ts — operator-facing CLI to ingest a PDF or arXiv
 * source tarball into the knowledge library so future ensemble_query /
 * Neptune / Robert can cite it.
 *
 * Usage:
 *   npx tsx scripts/ingest-paper.ts <path> [<path> ...]
 *   TENANT_ID=1 npx tsx scripts/ingest-paper.ts attached_assets/foo.pdf
 *
 * Exit codes:
 *   0 — all files ingested or already-ingested
 *   1 — at least one extraction failed (see stderr)
 *   2 — invalid arguments
 *
 * Notes:
 *   - Idempotent: re-running on the same file is a no-op (skip with warning).
 *   - Tenant defaults to env TENANT_ID, then 1 (owner). Replit.md hard rule
 *     forbids defaults on insert, but a CLI invocation IS the explicit
 *     intent — the script must surface the resolved tenant before insert.
 */
import { ingestPaper } from "../server/lib/paper-ingest";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: tsx scripts/ingest-paper.ts <path> [<path> ...]");
    process.exit(2);
  }
  const tenantId = Number(process.env.TENANT_ID || "1");
  if (!Number.isFinite(tenantId) || tenantId < 1) {
    console.error(`invalid TENANT_ID: ${process.env.TENANT_ID}`);
    process.exit(2);
  }
  console.error(`[ingest-paper] tenant=${tenantId}, files=${args.length}`);

  let anyFail = false;
  for (const p of args) {
    console.error(`\n[ingest-paper] → ${p}`);
    try {
      const res = await ingestPaper({ filePath: p, tenantId });
      const status = res.ok ? "OK" : "FAIL";
      console.error(
        `[ingest-paper] ${status} title="${res.title}" source=${res.sourceLabel} ` +
          `chunks=${res.chunksWritten} embedded=${res.chunksEmbedded} chars=${res.totalChars}`,
      );
      for (const w of res.warnings) console.error(`  ⚠ ${w}`);
      if (!res.ok) anyFail = true;
      console.log(JSON.stringify({ file: p, ...res }));
    } catch (err: any) {
      anyFail = true;
      console.error(`[ingest-paper] EXCEPTION on ${p}: ${err?.message || err}`);
    }
  }

  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error("[ingest-paper] fatal:", err);
  process.exit(1);
});

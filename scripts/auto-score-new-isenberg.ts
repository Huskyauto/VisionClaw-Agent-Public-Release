/**
 * Daily auto-score for new Isenberg / Idea Browser projects.
 *
 * Designed for a Replit Scheduled Deployment (daily 06:00 UTC). Idempotent:
 * the underlying prioritize script skips any project that already has
 * `metadata.priority`, so this job only scores genuinely-new entries.
 *
 * Flow:
 *   1. Count unscored isenberg projects (tag = 'isenberg' OR 'isenberg-iotd').
 *   2. If zero new → exit 0, no work.
 *   3. Otherwise spawn `prioritize-isenberg-portfolio.ts` (inherits stdio).
 *   4. After completion, query for any S/A-tier projects scored in the last
 *      24h. Print a digest. (Wire owner-notification later if desired.)
 *
 * Exit codes:
 *   0 — success (zero new OR scored cleanly)
 *   1 — score subprocess failed
 *   2 — db query failed
 */
import { spawnSync } from "child_process";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TENANT_ID = 1;

(async () => {
  try {
    const unscoredRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM projects
      WHERE tenant_id = ${TENANT_ID}
        AND ('isenberg' = ANY(tags) OR 'isenberg-iotd' = ANY(tags))
        AND NOT (metadata ? 'priority')
    `);
    const unscored = ((unscoredRes.rows || unscoredRes)[0] || {}).n || 0;
    console.log(`[auto-score] unscored isenberg projects: ${unscored}`);

    if (unscored === 0) {
      console.log("[auto-score] nothing to do");
      process.exit(0);
    }

    console.log("[auto-score] invoking prioritize-isenberg-portfolio.ts…");
    const r = spawnSync("npx", ["tsx", "scripts/prioritize-isenberg-portfolio.ts"], {
      stdio: "inherit",
      env: process.env,
    });
    if (r.status !== 0) {
      console.error(`[auto-score] subprocess exited ${r.status}`);
      process.exit(1);
    }

    const sinceRes: any = await db.execute(sql`
      SELECT id, name,
             metadata->'priority'->>'tier' AS tier,
             (metadata->'priority'->>'composite')::int AS composite,
             metadata->'priority'->>'buyer_hypothesis' AS buyer
      FROM projects
      WHERE tenant_id = ${TENANT_ID}
        AND metadata ? 'priority'
        AND metadata->'priority'->>'tier' IN ('S','A')
        AND (created_at > NOW() - INTERVAL '24 hours' OR updated_at > NOW() - INTERVAL '24 hours')
      ORDER BY composite DESC
    `);
    const fresh = sinceRes.rows || sinceRes;
    console.log(`\n[auto-score] ${fresh.length} S/A-tier items scored or updated in last 24h:`);
    for (const f of fresh) {
      console.log(`  [${f.tier} ${f.composite}] ${f.name} — ${f.buyer || "buyer TBD"}`);
    }

    process.exit(0);
  } catch (e: any) {
    console.error("[auto-score] FATAL:", e.message);
    process.exit(2);
  }
})();

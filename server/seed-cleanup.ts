import { db } from "./db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "./tenant-utils";

export async function cleanupRunawayDelegationTasks() {
  try {
    const countResult = await db.execute(sql`
      SELECT count(*) as cnt FROM heartbeat_tasks 
      WHERE enabled = true AND type = 'delegation'
    `);
    const countRows = (countResult as any).rows || countResult;
    const count = parseInt(countRows[0]?.cnt || '0');
    
    if (count > 10) {
      await db.execute(sql`
        UPDATE heartbeat_tasks SET enabled = false 
        WHERE type = 'delegation' AND enabled = true
      `);
      console.log(`[seed] Disabled ${count} runaway delegation tasks`);
    }

    // Self-Reflection runs every 2h (token audit 2026-07-30, Bob decision:
    // halve the standing cadence of the hourly/2-hourly routines). History:
    // */30 → hourly (Bob 2026-06-06, DB-starvation incident) → every 2h.
    // Paired with the 45-min hard floor + fast model in server/heartbeat.ts.
    // This reconciler is the canonical cron source, so it must agree with the
    // desired cadence or it reverts the schedule on every boot.
    await db.execute(sql`
      UPDATE heartbeat_tasks SET cron_expression = '0 */2 * * *'
      WHERE name = 'Self-Reflection' AND tenant_id = ${ADMIN_TENANT_ID} AND cron_expression != '0 */2 * * *'
    `);
    await db.execute(sql`
      UPDATE heartbeat_tasks SET cron_expression = '0 */4 * * *'
      WHERE name = 'Memory Consolidation' AND tenant_id = ${ADMIN_TENANT_ID} AND cron_expression NOT IN ('0 */4 * * *')
    `);
    // Commitment Drafter: hourly → every 2h (token audit 2026-07-30). The seed
    // in heartbeat.ts only applies to fresh DBs; this reconciles existing rows
    // (prod included) so the cadence change actually lands.
    await db.execute(sql`
      UPDATE heartbeat_tasks SET cron_expression = '20 */2 * * *'
      WHERE type = 'commitment_drafter' AND tenant_id = ${ADMIN_TENANT_ID} AND cron_expression != '20 */2 * * *'
    `);

    const duplicateResult = await db.execute(sql`
      SELECT count(*) as cnt FROM heartbeat_tasks 
      WHERE enabled = true AND name ILIKE '%session%logger%'
    `);
    const dupRows = (duplicateResult as any).rows || duplicateResult;
    const dupCount = parseInt(dupRows[0]?.cnt || '0');
    if (dupCount > 0) {
      await db.execute(sql`
        UPDATE heartbeat_tasks SET enabled = false 
        WHERE name ILIKE '%session%logger%' AND enabled = true
      `);
      console.log(`[seed] Disabled ${dupCount} session-logger delegation tasks`);
    }

    const examineResult = await db.execute(sql`
      SELECT count(*) as cnt FROM heartbeat_tasks 
      WHERE enabled = true AND (
        name ILIKE '%examine repository%' OR
        name ILIKE '%analyze repository%' OR 
        name ILIKE '%check repository%' OR
        name ILIKE '%verify repository%' OR
        name ILIKE '%grant repository%' OR
        name ILIKE '%open PR%' OR
        name ILIKE '%resume PR%' OR
        name ILIKE '%search open PRs%'
      )
    `);
    const examRows = (examineResult as any).rows || examineResult;
    const examCount = parseInt(examRows[0]?.cnt || '0');
    if (examCount > 0) {
      await db.execute(sql`
        UPDATE heartbeat_tasks SET enabled = false 
        WHERE (
          name ILIKE '%examine repository%' OR
          name ILIKE '%analyze repository%' OR 
          name ILIKE '%check repository%' OR
          name ILIKE '%verify repository%' OR
          name ILIKE '%grant repository%' OR
          name ILIKE '%open PR%' OR
          name ILIKE '%resume PR%' OR
          name ILIKE '%search open PRs%'
        ) AND enabled = true
      `);
      console.log(`[seed] Disabled ${examCount} orphaned repo-examination tasks`);
    }
  } catch (err) {
    console.error("[seed] Cleanup error:", err);
  }
}

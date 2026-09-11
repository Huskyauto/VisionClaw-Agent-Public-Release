import { storage, ALL_TENANTS } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getNextCronRun } from "./cron-utils";
import { seedSystemHeartbeatTasks } from "./heartbeat-seed";
import { isProductionRuntime } from "./lib/runtime-env";

export async function prepareHeartbeatStartup() {
  try {
    const fixed = await storage.fixStaleBackupSchedules();
    if (fixed > 0) {
      console.log(`[heartbeat] Fixed ${fixed} backup task(s) with stale next_run_at`);
    }
  } catch (err) {
    console.warn("[heartbeat] Could not fix stale schedules:", err);
  }
  try {
    const allTasks = await storage.getHeartbeatTasks(undefined, ALL_TENANTS);
    let cleaned = 0;
    for (const t of allTasks) {
      if (!t.enabled) continue;
      if (t.type === "delegation" || (t.runOnce && t.parentTaskId)) {
        await storage.updateHeartbeatTask(t.id, { enabled: false });
        cleaned++;
        console.log(`[heartbeat] Startup cleanup: disabled delegation task "${t.name}" (#${t.id})`);
      }
    }
    if (cleaned > 0) {
      console.log(`[heartbeat] Startup cleanup: disabled ${cleaned} delegation/run-once task(s)`);
    }
    for (const t of allTasks) {
      if (!t.enabled || !t.cronExpression) continue;
      // maintenance_script crons are production-only; don't let a dev restart
      // (sharing this DB) advance their next_run_at and "burn" a run that the
      // production deploy hasn't claimed yet.
      if (t.type === "maintenance_script" && !isProductionRuntime()) continue;
      // autonomous_closer applies code to the working tree + persists via Auto
      // Git Push — DEV/workspace only. The prod deploy shares this DB but runs a
      // bundle on an ephemeral FS; let it ignore the row entirely so the
      // workspace stays the single executor (no shared-DB "burned run").
      if (t.type === "autonomous_closer" && isProductionRuntime()) continue;
      // ideabrowser_autobuild writes a package file to the working tree + relies
      // on Auto Git Push to persist — DEV/workspace only, same rationale as the
      // autonomous_closer above. Prod (ephemeral FS, bundle) must ignore the row.
      if (t.type === "ideabrowser_autobuild" && isProductionRuntime()) continue;
      // ideabrowser_ingest is the PROD-safe counterpart: DB + network only (Gmail
      // read → idea-stage projects → in-process scoring), NO FS/git. It runs ONLY
      // on the always-on prod deploy (single ingest executor); skip in dev without
      // advancing next_run_at — the dev-only ideabrowser_autobuild already
      // ingests+scores+builds — so prod still sees the row as due.
      if (t.type === "ideabrowser_ingest" && !isProductionRuntime()) continue;
      // ideabrowser_dev_sync is DEV/workspace-only (Task 160): keeps the dev DB's
      // IdeaBrowser folder fresh (prod is canonical; separate DBs). Prod must
      // ignore the row entirely.
      if (t.type === "ideabrowser_dev_sync" && isProductionRuntime()) continue;
      // bwb_weigh_in_reminder is seeded prod-only (shared DB); a dev box must not
      // fire the prod row and double-email Bob.
      if (t.type === "bwb_weigh_in_reminder" && !isProductionRuntime()) continue;
      // mission_opportunity_scan is seeded prod-only (shared DB); single executor
      // on the always-on prod deploy. Skip in dev without advancing next_run_at.
      if (t.type === "mission_opportunity_scan" && !isProductionRuntime()) continue;
      // mission_reply_intake is seeded prod-only (shared DB); Gmail-read + DB
      // only, single executor on the always-on prod deploy. Skip in dev.
      if (t.type === "mission_reply_intake" && !isProductionRuntime()) continue;
      // model_scout benefits from a frontier model. Reflection must stay LIGHT
      // and FAST: Bob 2026-06-06 — heavy claude-sonnet-4 reflections were taking
      // 80–112s each and starving the DB connection pool, destabilizing the whole
      // app (check_system_status timeouts, /api/activity/pulse 3–5s). Force
      // reflection onto a fast/light model; only upgrade model_scout to sonnet.
      // Token audit 2026-07-30 (Bob decision): all heartbeat tasks stay on the
      // $0 modelfarm lane. The old dated claude-sonnet-4 (2025-05-14) id was metered
      // AND retirement-prone (ideabrowser-scorer-stale-model failure mode).
      // This replaces the old model_scout claude-sonnet-4-5 upgrade — Bob's
      // standing $0 directive wins over per-task model upgrades.
      if (t.model && t.model.startsWith("claude-")) {
        await db.execute(sql`UPDATE heartbeat_tasks SET model = 'gpt-5-mini' WHERE id = ${t.id}`);
        console.log(`[heartbeat] Startup fix: "${t.name}" model normalized from ${t.model} to gpt-5-mini ($0 lane — token audit 2026-07-30)`);
      }
      if (t.type === "reflection" && t.model && t.model !== "gemini-2.5-flash") {
        await db.execute(sql`UPDATE heartbeat_tasks SET model = 'gemini-2.5-flash' WHERE id = ${t.id}`);
        console.log(`[heartbeat] Startup fix: "${t.name}" model normalized from ${t.model} to gemini-2.5-flash (fast/light reflection — stability)`);
      }
      const correctNext = getNextCronRun(t.cronExpression);
      const nextRunDate = t.nextRunAt ? new Date(t.nextRunAt) : new Date(0);
      const isOverdue = nextRunDate < new Date();
      const isRunaway = nextRunDate < new Date(Date.now() + 30 * 60 * 1000) && correctNext > new Date(Date.now() + 60 * 60 * 1000);
      if (isOverdue || isRunaway) {
        await storage.markHeartbeatTaskRun(t.id, correctNext);
        console.log(`[heartbeat] Startup fix: "${t.name}" next_run_at was ${nextRunDate.toISOString()}, reset to ${correctNext.toISOString()}`);
      }
    }
  } catch (err) {
    console.warn("[heartbeat] Startup cleanup error:", err);
  }
  await seedSystemHeartbeatTasks();
}

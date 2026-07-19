/**
 * Built With Bob — Weekly Recap Cron
 *
 * In-process scheduler that fires the autonomous weekly-recap orchestrator
 * (`scripts/bwb-weekly-orchestrator.ts`) on a configurable weekly wall-clock
 * slot. The orchestrator does all the heavy lifting (discover → synthesize →
 * deliver → approval-first email OR autopublish), so this scheduler just spawns
 * it detached at the scheduled time and gets out of the way.
 *
 * Scheduling:
 *   - BWB_WEEKLY_CRON — 5-field cron expression for the weekly slot.
 *     Default "0 20 * * 6" = Saturdays at 20:00 (Bob's "Saturday night" slot,
 *     covering the trailing Sun–Sat week). Kept in lockstep with the
 *     orchestrator's schedule guard (BWB_WEEKLY_DAYS default Sat/Sun) so the
 *     cron-spawned run isn't silently skipped by the guard.
 *   - BWB_WEEKLY_TZ — IANA timezone for the cron expression. Default
 *     "America/Chicago" (Bob's local time; matches the guard default).
 *   The next run is computed as an absolute wall-clock instant and re-armed
 *   after each fire, so it does NOT drift on server restarts (unlike a boot-
 *   relative setInterval).
 *
 * Gating:
 *   - BWB_WEEKLY_ENABLED=1 — REQUIRED. Without it the scheduler stays disarmed
 *     (so dev/test boots don't auto-run the pipeline).
 *   - BWB_WEEKLY_AUTOPUBLISH=1 — passed through to the orchestrator. When set,
 *     the recap publishes to YouTube (public) + Facebook with no human in the
 *     loop. When unset (default), Bob gets a one-tap approve/deny email.
 */
import { spawn } from "node:child_process";
import { sanitizeSpawnEnv } from "./safety/spawn-env-guard";
import { CronExpressionParser } from "cron-parser";

const ORCHESTRATOR = "scripts/bwb-weekly-orchestrator.ts";
const DEFAULT_CRON = "0 20 * * 6"; // Saturdays 20:00 (Bob's "Saturday night" slot)
const DEFAULT_TZ = "America/Chicago"; // Bob's local time; matches the orchestrator guard default
const MAX_TIMEOUT_MS = 2 ** 31 - 1; // setTimeout caps at ~24.8 days

let lastSpawnAt: Date | null = null;
let nextRunAt: Date | null = null;
let armed = false;
let timer: NodeJS.Timeout | null = null;

function cronExpr(): string {
  return process.env.BWB_WEEKLY_CRON || DEFAULT_CRON;
}
function cronTz(): string {
  return process.env.BWB_WEEKLY_TZ || DEFAULT_TZ;
}

function computeNextRun(): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpr(), { tz: cronTz() });
    return interval.next().toDate();
  } catch (e: any) {
    console.error(`[bwb-weekly-cron] invalid cron "${cronExpr()}" (tz=${cronTz()}): ${e?.message || e}`);
    return null;
  }
}

function spawnOrchestrator(reason: string): void {
  lastSpawnAt = new Date();
  const autopublish = process.env.BWB_WEEKLY_AUTOPUBLISH === "1";
  console.log(`[bwb-weekly-cron] spawning weekly recap (${reason}, autopublish=${autopublish})`);
  try {
    const child = spawn("npx", ["tsx", ORCHESTRATOR], {
      detached: true,
      stdio: "ignore",
      env: sanitizeSpawnEnv(process.env),
    });
    child.on("error", (e) => console.error(`[bwb-weekly-cron] spawn error: ${e.message}`));
    child.unref();
  } catch (e: any) {
    console.error(`[bwb-weekly-cron] failed to spawn orchestrator: ${e?.message || e}`);
  }
}

function armNext(): void {
  const next = computeNextRun();
  nextRunAt = next;
  if (!next) {
    console.error("[bwb-weekly-cron] could not compute next run — scheduler stalled");
    return;
  }
  const delay = Math.max(0, next.getTime() - Date.now());
  // setTimeout overflows past ~24.8 days; chunk long waits and re-arm.
  if (delay > MAX_TIMEOUT_MS) {
    timer = setTimeout(armNext, MAX_TIMEOUT_MS);
    return;
  }
  console.log(`[bwb-weekly-cron] next run at ${next.toISOString()} (cron="${cronExpr()}" tz=${cronTz()})`);
  timer = setTimeout(() => {
    spawnOrchestrator("scheduled");
    armNext();
  }, delay);
}

export function startBwbWeeklyScheduler(): void {
  // Autonomous weekly auto-render is OFF by default (Bob's request 2026-06-17):
  // only manual recaps Bob initiates on Sat night / Sun morning run. The cron
  // stays disarmed unless BWB_WEEKLY_AUTONOMOUS=1 is explicitly set. Even with
  // the legacy BWB_WEEKLY_ENABLED=1 present, autonomous stays off without this
  // opt-in, and the orchestrator no-ops any non-forced run anyway (belt + braces).
  if (process.env.BWB_WEEKLY_AUTONOMOUS !== "1") {
    console.log("[bwb-weekly-cron] disarmed — autonomous auto-render is OFF (manual-only). Set BWB_WEEKLY_AUTONOMOUS=1 to re-enable the scheduled weekend recap.");
    return;
  }
  if (process.env.BWB_WEEKLY_ENABLED !== "1") {
    console.log("[bwb-weekly-cron] disarmed (set BWB_WEEKLY_ENABLED=1 to enable autonomous weekly Built With Bob recaps)");
    return;
  }
  armed = true;
  console.log(`[bwb-weekly-cron] armed — cron="${cronExpr()}" tz=${cronTz()}`);
  armNext();
}

export function getBwbWeeklyStatus() {
  return {
    armed,
    autonomous: process.env.BWB_WEEKLY_AUTONOMOUS === "1",
    enabled: process.env.BWB_WEEKLY_ENABLED === "1",
    autopublish: process.env.BWB_WEEKLY_AUTOPUBLISH === "1",
    cron: cronExpr(),
    timeZone: cronTz(),
    nextRunAt: nextRunAt?.toISOString() ?? null,
    lastSpawnAt: lastSpawnAt?.toISOString() ?? null,
    scheduler: "in-process cron (configurable weekly slot)",
  };
}

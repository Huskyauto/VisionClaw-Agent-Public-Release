import { db, isOffHours } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

const WATCHDOG_INTERVAL_MS = 10 * 60 * 1000;
const CHIEF_OF_STAFF_PERSONA_ID = 6;
const STUCK_TASK_THRESHOLD_MS = 8 * 60 * 1000;
const MAX_HEARTBEAT_LOG_AGE_HOURS = 72;
const MEMORY_WARNING_MB = 900;
const MEMORY_CRITICAL_MB = 1300;

let watchdogTimer: NodeJS.Timeout | null = null;
let lastWatchdogRun = 0;
let watchdogRunCount = 0;
let cumulativeRemediations: string[] = [];

interface WatchdogReport {
  ranAt: string;
  actions: string[];
  poolStats: { total: number; idle: number; waiting: number } | null;
  memoryMB: number;
  heartbeatRunning: boolean;
  stuckTasksKilled: number;
  disabledFlaky: number;
}

export function startStabilityWatchdog(): void {
  if (watchdogTimer) return;
  console.log(`[watchdog] Chief of Staff stability watchdog starting (every ${WATCHDOG_INTERVAL_MS / 1000}s)`);
  let offHoursSkipCount = 0;
  watchdogTimer = setInterval(() => {
    if (isOffHours()) {
      offHoursSkipCount++;
      if (offHoursSkipCount % 3 !== 0) return;
    } else {
      offHoursSkipCount = 0;
    }
    runWatchdogCycle();
  }, WATCHDOG_INTERVAL_MS);
  setTimeout(runWatchdogCycle, 30 * 1000);
}

export function stopStabilityWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    console.log("[watchdog] Stopped");
  }
}

export function isWatchdogRunning(): boolean {
  return !!watchdogTimer;
}

export function getWatchdogStats() {
  return {
    running: !!watchdogTimer,
    lastRun: lastWatchdogRun ? new Date(lastWatchdogRun).toISOString() : null,
    runCount: watchdogRunCount,
    recentActions: cumulativeRemediations.slice(-20),
  };
}

async function runWatchdogCycle(): Promise<void> {
  const start = Date.now();
  const actions: string[] = [];
  let poolStats: WatchdogReport["poolStats"] = null;
  let stuckTasksKilled = 0;
  let disabledFlaky = 0;

  try {
    poolStats = await checkAndFixPoolHealth(actions);
    await checkAndRestartHeartbeat(actions);
    stuckTasksKilled = await killStuckTasks(actions);
    disabledFlaky = await disableFlakyTasks(actions);
    await cleanupStaleData(actions);
    await checkMemoryPressure(actions);
    await pruneOldLogs(actions);
    await runStuckDiagnostics(actions);

    lastWatchdogRun = Date.now();
    watchdogRunCount++;

    if (actions.length > 0) {
      cumulativeRemediations.push(...actions);
      if (cumulativeRemediations.length > 100) {
        cumulativeRemediations = cumulativeRemediations.slice(-50);
      }

      const summary = actions.join("\n• ");
      console.log(`[watchdog] Cycle #${watchdogRunCount} completed in ${Date.now() - start}ms — ${actions.length} action(s):\n• ${summary}`);

      await reportToAgentChannel(actions).catch(() => {});
    } else if (watchdogRunCount % 12 === 0) {
      const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const poolStr = poolStats ? `pool(${poolStats.total}/${poolStats.idle}i/${poolStats.waiting}w)` : "pool(n/a)";
      console.log(`[watchdog] Hourly status — all clear. RSS: ${memMB}MB, ${poolStr}`);
    }
  } catch (err: any) {
    console.error(`[watchdog] Cycle error:`, err.message);
  }
}

async function checkAndFixPoolHealth(actions: string[]): Promise<{ total: number; idle: number; waiting: number } | null> {
  try {
    const { getPoolStats, testPoolConnection } = await import("./db");
    const stats = getPoolStats();

    if (stats.waiting > 8) {
      actions.push(`Pool pressure detected: ${stats.waiting} queries waiting (total: ${stats.total}, idle: ${stats.idle})`);

      const probe = await testPoolConnection();
      if (!probe.ok) {
        actions.push(`DB connection probe failed (${probe.latencyMs}ms) — system may need restart`);
      } else if (probe.latencyMs > 5000) {
        actions.push(`DB responding slowly (${probe.latencyMs}ms) — may impact task execution`);
      }
    }

    return stats;
  } catch {
    return null;
  }
}

async function checkAndRestartHeartbeat(actions: string[]): Promise<void> {
  try {
    const { isHeartbeatRunning, startHeartbeat } = await import("./heartbeat");
    if (!isHeartbeatRunning()) {
      actions.push("Heartbeat engine was stopped — auto-restarting");
      startHeartbeat();
    }
  } catch (err: any) {
    actions.push(`Heartbeat check failed: ${err.message}`);
  }
}

async function killStuckTasks(actions: string[]): Promise<number> {
  try {
    const { activeTaskTracker } = await import("./heartbeat");
    const now = Date.now();
    let killed = 0;

    for (const [taskId, info] of activeTaskTracker) {
      const elapsed = now - info.startedAt;
      if (elapsed > STUCK_TASK_THRESHOLD_MS) {
        activeTaskTracker.delete(taskId);
        killed++;

        const elapsedMin = Math.round(elapsed / 60000);
        actions.push(`Cleared stuck task "${info.taskName}" (${info.personaName || "system"}) — running for ${elapsedMin}min`);

        await storage.createHeartbeatLog({
          taskId,
          taskName: info.taskName,
          status: "error",
          input: null,
          output: `Watchdog: cleared stuck task after ${elapsedMin} minutes`,
          model: null,
          personaId: info.personaId,
          personaName: info.personaName,
          delegatedTasks: null,
          durationMs: elapsed,
        }).catch(() => {});
      }
    }

    return killed;
  } catch {
    return 0;
  }
}

async function disableFlakyTasks(actions: string[]): Promise<number> {
  try {
    const recentLogs = await db.execute(sql`
      SELECT task_id, task_name, COUNT(*) as error_count
      FROM heartbeat_logs
      WHERE status = 'error'
        AND created_at > NOW() - INTERVAL '2 hours'
      GROUP BY task_id, task_name
      HAVING COUNT(*) >= 4
    `);
    const rows = (recentLogs as any).rows || recentLogs;
    let disabled = 0;

    for (const row of rows) {
      const taskId = parseInt(row.task_id);
      if (isNaN(taskId)) continue;

      try {
        const tasks = await storage.getHeartbeatTasks();
        const task = tasks.find(t => t.id === taskId);
        if (task && task.enabled && task.type !== "reflection" && task.type !== "cloud_backup" && task.type !== "memory_backup") {
          await storage.updateHeartbeatTask(taskId, { enabled: false });
          disabled++;
          actions.push(`Auto-disabled flaky task "${row.task_name}" — ${row.error_count} errors in last 2 hours`);
        }
      } catch {}
    }

    return disabled;
  } catch {
    return 0;
  }
}

async function cleanupStaleData(actions: string[]): Promise<void> {
  try {
    const result = await db.execute(sql`
      DELETE FROM heartbeat_tasks
      WHERE enabled = false
        AND type = 'delegation'
        AND created_at < NOW() - INTERVAL '7 days'
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (rows.length > 0) {
      actions.push(`Purged ${rows.length} old disabled delegation task(s) from database`);
    }
  } catch {}

  try {
    const result = await db.execute(sql`
      DELETE FROM event_log
      WHERE (status = 'processed' OR status = 'failed')
        AND created_at < NOW() - INTERVAL '3 days'
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (rows.length > 0) {
      actions.push(`Cleaned up ${rows.length} old event log entries`);
    }
  } catch {}
}

async function checkMemoryPressure(actions: string[]): Promise<void> {
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

  if (rssMB > MEMORY_CRITICAL_MB) {
    actions.push(`CRITICAL memory: RSS ${rssMB}MB, heap ${heapUsedMB}MB — triggering GC if available`);
    if (global.gc) {
      try {
        global.gc();
        const afterMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        actions.push(`GC completed: ${rssMB}MB → ${afterMB}MB`);
      } catch {}
    }
  } else if (rssMB > MEMORY_WARNING_MB) {
    actions.push(`Elevated memory: RSS ${rssMB}MB, heap ${heapUsedMB}MB`);
  }
}

async function pruneOldLogs(actions: string[]): Promise<void> {
  try {
    const result = await db.execute(sql`
      DELETE FROM heartbeat_logs
      WHERE created_at < NOW() - INTERVAL '${sql.raw(String(MAX_HEARTBEAT_LOG_AGE_HOURS))} hours'
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (rows.length > 0) {
      actions.push(`Pruned ${rows.length} heartbeat log(s) older than ${MAX_HEARTBEAT_LOG_AGE_HOURS}h`);
    }
  } catch {}
}

async function runStuckDiagnostics(actions: string[]): Promise<void> {
  try {
    const { detectStalledDelegations, detectHungProcesses, postDiagnosticReport } = await import("./stuck-diagnostics");
    const [stalledPatterns, hungPatterns] = await Promise.all([
      detectStalledDelegations(),
      detectHungProcesses(),
    ]);
    const allPatterns = [...stalledPatterns, ...hungPatterns];

    for (const p of stalledPatterns) {
      actions.push(`Stalled delegation: ${p.description}`);
    }

    const browserHung = hungPatterns.filter(p => p.metadata.processType === "browser_session");
    if (browserHung.length > 0) {
      try {
        const { getActiveSessions, disconnectBrowser } = await import("./browser-tool");
        const allSessions = getActiveSessions();
        if (allSessions.length > 0 && allSessions.every(s => s.idleSeconds > 300)) {
          await disconnectBrowser();
          actions.push(`Disconnected ${allSessions.length} hung browser session(s) (all idle >5min)`);
        }
      } catch {}
    }

    for (const p of hungPatterns) {
      actions.push(`Hung process: ${p.description}`);
    }

    if (allPatterns.length > 0) {
      await postDiagnosticReport(allPatterns).catch(() => {});
    }
  } catch (err: any) {
    console.error("[watchdog] Stuck diagnostics failed:", err.message);
  }
}

async function reportToAgentChannel(actions: string[]): Promise<void> {
  try {
    const { postMessage } = await import("./agent-channels");
    const actionList = actions.map(a => `• ${a}`).join("\n");
    await postMessage({
      tenantId: 1,
      channelName: "operations",
      fromPersonaId: CHIEF_OF_STAFF_PERSONA_ID,
      content: `🔧 **Stability Watchdog Report** (Cycle #${watchdogRunCount})\n\n${actionList}\n\n_Auto-remediated at ${new Date().toLocaleTimeString()}_`,
      messageType: "system",
    });
  } catch {}
}

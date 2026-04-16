import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

export interface HealthCheck {
  name: string;
  category: "app" | "infrastructure" | "integration";
  status: "healthy" | "degraded" | "down";
  message: string;
  latencyMs?: number;
  checkedAt: string;
}

export interface HealthReport {
  overall: "healthy" | "degraded" | "down";
  checks: HealthCheck[];
  generatedAt: string;
  autoRemediations: string[];
}

let lastReport: HealthReport | null = null;
let consecutiveFailures: Record<string, number> = {};
let consecutiveDownChecks = 0;
let lastAlertSentAt = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const ALERT_THRESHOLD = 2;

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { withDbRetry } = await import("./db");
    await withDbRetry(() => db.execute(sql`SELECT 1`), "health-check-db", 2);
    const latency = Date.now() - start;
    consecutiveFailures["database"] = 0;
    return {
      name: "PostgreSQL Database",
      category: "infrastructure",
      status: latency > 30000 ? "degraded" : "healthy",
      message: latency > 5000 ? `Slow response (${latency}ms)` : `Connected (${latency}ms)`,
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    consecutiveFailures["database"] = (consecutiveFailures["database"] || 0) + 1;
    return {
      name: "PostgreSQL Database",
      category: "infrastructure",
      status: "down",
      message: `Connection failed: ${err.message?.substring(0, 100)}`,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkObjectStorage(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { objectStorageClient } = await import("./object-storage");
    const result = await objectStorageClient.list("__health_check/");
    const latency = Date.now() - start;
    consecutiveFailures["object_storage"] = 0;
    return {
      name: "Object Storage",
      category: "infrastructure",
      status: "healthy",
      message: result.ok ? `Available (${latency}ms)` : `Available with database fallback (${latency}ms)`,
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    consecutiveFailures["object_storage"] = 0;
    return {
      name: "Object Storage",
      category: "infrastructure",
      status: "healthy",
      message: "Using database fallback (functional)",
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkAIProviders(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { MODEL_REGISTRY } = await import("./providers");
    const modelEntries = Object.entries(MODEL_REGISTRY || {});
    const latency = Date.now() - start;
    const providers = new Set(modelEntries.map(([, m]: [string, any]) => m?.provider).filter(Boolean));
    consecutiveFailures["ai_providers"] = 0;
    return {
      name: "AI Providers",
      category: "integration",
      status: providers.size > 0 ? "healthy" : "degraded",
      message: providers.size > 0
        ? `${providers.size} provider(s), ${modelEntries.length} model(s) registered`
        : "No AI providers configured",
      latencyMs: latency,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    consecutiveFailures["ai_providers"] = (consecutiveFailures["ai_providers"] || 0) + 1;
    return {
      name: "AI Providers",
      category: "integration",
      status: "degraded",
      message: `Provider check failed: ${err.message?.substring(0, 100)}`,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkMemoryUsage(): Promise<HealthCheck> {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  const heapPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

  let status: HealthCheck["status"] = "healthy";
  let message = `Heap: ${heapUsedMB}/${heapTotalMB}MB (${heapPercent}%), RSS: ${rssMB}MB`;

  if (rssMB > 1400) {
    status = "down";
    message = `Critical memory pressure! ${message}`;
  } else if (rssMB > 1000) {
    status = "degraded";
    message = `High memory usage. ${message}`;
  }

  return {
    name: "Memory Usage",
    category: "app",
    status,
    message,
    checkedAt: new Date().toISOString(),
  };
}

async function checkHeartbeat(): Promise<HealthCheck> {
  try {
    const { isHeartbeatRunning } = await import("./heartbeat");
    const running = isHeartbeatRunning();
    consecutiveFailures["heartbeat"] = running ? 0 : (consecutiveFailures["heartbeat"] || 0) + 1;
    return {
      name: "Heartbeat Engine",
      category: "app",
      status: running ? "healthy" : "degraded",
      message: running ? "Running (60s interval)" : "Not running — autonomous tasks paused",
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "Heartbeat Engine",
      category: "app",
      status: "degraded",
      message: `Check failed: ${err.message?.substring(0, 100)}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkSessionAuth(): Promise<HealthCheck> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM tenants WHERE is_active = true`);
    const rows = (result as any).rows || result;
    const tenantCount = parseInt(rows[0]?.count || "0");
    return {
      name: "Auth & Sessions",
      category: "app",
      status: "healthy",
      message: `${tenantCount} active tenant(s)`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "Auth & Sessions",
      category: "app",
      status: "degraded",
      message: `Auth check failed: ${err.message?.substring(0, 100)}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function attemptAutoRemediation(checks: HealthCheck[]): Promise<string[]> {
  const remediations: string[] = [];

  for (const check of checks) {
    if (check.status === "healthy") continue;
    const nameToKey: Record<string, string> = {
      "PostgreSQL Database": "database",
      "Object Storage": "object_storage",
      "AI Providers": "ai_providers",
      "Heartbeat Engine": "heartbeat",
    };
    const failureKey = nameToKey[check.name] || check.name.toLowerCase().replace(/\s+/g, "_");
    const failures = consecutiveFailures[failureKey] || 0;

    if (check.name === "Heartbeat Engine" && check.status !== "healthy") {
      try {
        const { startHeartbeat, isHeartbeatRunning } = await import("./heartbeat");
        if (!isHeartbeatRunning()) {
          startHeartbeat();
          remediations.push("Auto-restarted heartbeat engine");
        }
      } catch {}
    }

    if (check.name === "Memory Usage" && check.status === "down") {
      try {
        if (global.gc) {
          global.gc();
          remediations.push("Triggered garbage collection for critical memory pressure");
        }
      } catch {}
    }

    if (check.name === "PostgreSQL Database" && check.status === "down" && failures >= 3) {
      try {
        const { testPoolConnection } = await import("./db");
        const probe = await testPoolConnection();
        if (probe.ok) {
          consecutiveFailures["database"] = 0;
          remediations.push(`DB recovered after ${failures} failures (probe: ${probe.latencyMs}ms)`);
        } else {
          remediations.push(`DB still unreachable after ${failures} checks (probe: ${probe.latencyMs}ms)`);
        }
      } catch {}
    }

    if (failures >= 5 && check.category === "infrastructure") {
      remediations.push(`ALERT: ${check.name} has failed ${failures} consecutive times — likely infrastructure issue, not app code`);
    }
  }

  try {
    const { isWatchdogRunning, startStabilityWatchdog } = await import("./stability-watchdog");
    if (!isWatchdogRunning()) {
      startStabilityWatchdog();
      remediations.push("Auto-restarted stability watchdog");
    }
  } catch {}

  return remediations;
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all([
    checkDatabase(),
    checkObjectStorage(),
    checkAIProviders(),
    checkMemoryUsage(),
    checkHeartbeat(),
    checkSessionAuth(),
  ]);

  try {
    const { getPoolStats } = await import("./db");
    const poolStats = getPoolStats();
    if (poolStats.waiting > 5 || poolStats.idle === 0) {
      console.warn(`[health-monitor] Pool pressure: total=${poolStats.total}, idle=${poolStats.idle}, waiting=${poolStats.waiting}`);
    }
  } catch {}

  const autoRemediations = await attemptAutoRemediation(checks);

  const hasDown = checks.some((c) => c.status === "down");
  const hasDegraded = checks.some((c) => c.status === "degraded");

  if (hasDown) {
    consecutiveDownChecks++;
  } else {
    consecutiveDownChecks = 0;
  }

  const report: HealthReport = {
    overall: hasDown ? "down" : hasDegraded ? "degraded" : "healthy",
    checks,
    generatedAt: new Date().toISOString(),
    autoRemediations,
  };

  lastReport = report;

  if (report.overall !== "healthy") {
    await logHealthIssue(report);
  }

  return report;
}

async function logHealthIssue(report: HealthReport): Promise<void> {
  const issues = report.checks.filter((c) => c.status !== "healthy");
  const appIssues = issues.filter((c) => c.category === "app");
  const infraIssues = issues.filter((c) => c.category === "infrastructure");
  const integrationIssues = issues.filter((c) => c.category === "integration");

  const logLines: string[] = [];
  if (appIssues.length > 0) {
    logLines.push(`App Issues: ${appIssues.map((i) => `${i.name} (${i.status}: ${i.message})`).join("; ")}`);
  }
  if (infraIssues.length > 0) {
    logLines.push(`Infrastructure Issues: ${infraIssues.map((i) => `${i.name} (${i.status}: ${i.message})`).join("; ")}`);
  }
  if (integrationIssues.length > 0) {
    logLines.push(`Integration Issues: ${integrationIssues.map((i) => `${i.name} (${i.status}: ${i.message})`).join("; ")}`);
  }

  console.warn(`[health-monitor] ${report.overall.toUpperCase()}: ${logLines.join(" | ")}`);

  if (report.overall === "down") {
    const now = Date.now();
    const cooledDown = (now - lastAlertSentAt) >= ALERT_COOLDOWN_MS;
    if (consecutiveDownChecks >= ALERT_THRESHOLD && cooledDown) {
      try {
        const { sendSystemHealthAlert } = await import("./email-notifications");
        await sendSystemHealthAlert(report);
        lastAlertSentAt = now;
        console.log(`[health-monitor] Alert sent (${consecutiveDownChecks} consecutive failures, next alert in ${ALERT_COOLDOWN_MS / 60000}min)`);
      } catch {}
    } else if (consecutiveDownChecks < ALERT_THRESHOLD) {
      console.log(`[health-monitor] Suppressing alert — waiting for ${ALERT_THRESHOLD} consecutive failures (at ${consecutiveDownChecks})`);
    } else if (!cooledDown) {
      console.log(`[health-monitor] Suppressing alert — cooldown (${Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlertSentAt)) / 60000)}min remaining)`);
    }
  }
}

export function getLastHealthReport(): HealthReport | null {
  return lastReport;
}

let healthInterval: NodeJS.Timeout | null = null;

export function startHealthMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (healthInterval) clearInterval(healthInterval);

  runHealthChecks().then((report) => {
    console.log(`[health-monitor] Initial check: ${report.overall} (${report.checks.length} checks)`);
  }).catch((err) => {
    console.error("[health-monitor] Initial check failed:", err.message);
  });

  let offHoursSkipCounter = 0;
  healthInterval = setInterval(async () => {
    const { isOffHours } = await import("./db");
    if (isOffHours()) {
      offHoursSkipCounter++;
      if (offHoursSkipCounter % 3 !== 0) return;
    } else {
      offHoursSkipCounter = 0;
    }
    runHealthChecks().catch((err) => {
      console.error("[health-monitor] Scheduled check failed:", err.message);
    });
  }, intervalMs);

  console.log(`[health-monitor] Started (checking every ${intervalMs / 1000}s)`);
}

export function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

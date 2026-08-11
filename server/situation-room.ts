import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
export interface PersonaWorkload {
  personaId: number;
  personaName: string;
  activeTaskCount: number;
  recentConversations24h: number;
  lastActiveAt: string | null;
}

export interface SystemMood {
  recentFrustrationRate: number;
  recentSatisfactionRate: number;
  avgSentimentScore: number;
  dominantSignal: "calm" | "positive" | "frustrated" | "confused" | "urgent" | "mixed";
  sampleSize: number;
}

export interface ActiveWork {
  orchestrationPlans: number;
  activeDelegations: number;
  heartbeatTasks: Array<{ taskName: string; personaName: string; runningSince: string }>;
  stalledItems: number;
}

export interface InfraHealth {
  overall: string;
  heartbeatRunning: boolean;
  watchdogRunning: boolean;
  watchdogLastRun: string | null;
  recentRemediations: number;
  memoryConsolidation: {
    lastRun: string | null;
    sessionsSinceLastRun: number;
    isRunning: boolean;
  };
}

export interface SituationSnapshot {
  generatedAt: string;
  tenantId: number;
  systemStatus: "nominal" | "attention" | "degraded" | "critical";
  activeWork: ActiveWork;
  infraHealth: InfraHealth;
  personaWorkloads: PersonaWorkload[];
  systemMood: SystemMood;
  recentEvents: { type: string; count: number }[];
  alerts: string[];
  briefing: string;
}

const PERSONA_NAMES: Record<number, string> = {
  1: "VisionClaw", 2: "Felix", 3: "Forge", 4: "Teagan", 5: "Blueprint",
  6: "Chief of Staff", 7: "Scribe", 8: "Proof", 9: "Radar", 10: "Neptune",
  11: "Apollo", 12: "Atlas", 13: "Cassandra", 14: "Luna",
};

let lastSnapshot: SituationSnapshot | null = null;
let lastSnapshotTime = 0;
const CACHE_TTL_MS = 30_000;

async function getActiveWorkState(tenantId: number): Promise<ActiveWork> {
  let orchestrationPlans = 0;
  let activeDelegations = 0;
  const heartbeatTasks: ActiveWork["heartbeatTasks"] = [];
  let stalledItems = 0;

  try {
    const { activePlans } = await import("./ceo-orchestrator") as any;
    // Defense-in-depth: guard against the import returning undefined or a
    // non-iterable (R79.2 fix made activePlans an exported Map, but if the
    // export is ever accidentally removed again we want a clean no-op instead
    // of a noisy silent-catch on every situation-room snapshot).
    if (activePlans && typeof activePlans[Symbol.iterator] === "function") {
      for (const [, plan] of activePlans) {
        if ((plan.status === "executing" || plan.status === "planning") && (plan as any).tenantId === tenantId) {
          orchestrationPlans++;
        }
      }
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { getActiveDelegationCount } = await import("./stuck-diagnostics");
    activeDelegations = getActiveDelegationCount();
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { activeTaskTracker } = await import("./heartbeat");
    for (const [, task] of activeTaskTracker) {
      if ((task as any).tenantId && (task as any).tenantId !== tenantId) continue;
      heartbeatTasks.push({
        taskName: task.taskName,
        personaName: task.personaName || PERSONA_NAMES[task.personaId as number] || `Persona ${task.personaId}`,
        runningSince: (task.startedAt as any) instanceof Date ? ((task.startedAt as unknown) as Date).toISOString() : String(task.startedAt),
      });
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { getRecentPatterns } = await import("./stuck-diagnostics");
    const patterns = getRecentPatterns(Date.now() - 15 * 60 * 1000);
    stalledItems = patterns?.length || 0;
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  return { orchestrationPlans, activeDelegations, heartbeatTasks, stalledItems };
}

async function getInfraHealthState(tenantId: number): Promise<InfraHealth> {
  let overall = "unknown";
  let heartbeatRunning = false;
  let watchdogRunning = false;
  let watchdogLastRun: string | null = null;
  let recentRemediations = 0;

  try {
    const { getLastHealthReport } = await import("./health-monitor");
    const report = getLastHealthReport();
    if (report) {
      overall = report.overall || "unknown";
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { isHeartbeatRunning } = await import("./heartbeat");
    heartbeatRunning = isHeartbeatRunning();
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { getWatchdogStats } = await import("./stability-watchdog");
    const stats = getWatchdogStats();
    watchdogRunning = stats?.running || false;
    watchdogLastRun = stats?.lastRun ? new Date(stats.lastRun).toISOString() : null;
    recentRemediations = stats?.recentActions?.length || 0;
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  let memoryConsolidation = { lastRun: null as string | null, sessionsSinceLastRun: 0, isRunning: false };
  try {
    const { getConsolidationState } = await import("./auto-consolidation");
    const cs = getConsolidationState(tenantId);
    memoryConsolidation = {
      lastRun: cs.lastConsolidatedAt ? cs.lastConsolidatedAt.toISOString() : null,
      sessionsSinceLastRun: cs.sessionsSinceLastRun,
      isRunning: cs.isRunning,
    };
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  return { overall, heartbeatRunning, watchdogRunning, watchdogLastRun, recentRemediations, memoryConsolidation };
}

async function getPersonaWorkloads(tenantId: number): Promise<PersonaWorkload[]> {
  const workloads: PersonaWorkload[] = [];
  try {
    const result = await db.execute(sql`
      SELECT 
        c.persona_id,
        COUNT(DISTINCT c.id) as conv_count,
        MAX(m.created_at) as last_active
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.tenant_id = ${tenantId}
        AND c.persona_id IS NOT NULL
        AND m.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY c.persona_id
      ORDER BY conv_count DESC
    `);
    const rows = (result as any)?.rows || result;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const pid = Number((row as any).persona_id);
        workloads.push({
          personaId: pid,
          personaName: PERSONA_NAMES[pid] || `Persona ${pid}`,
          activeTaskCount: 0,
          recentConversations24h: Number((row as any).conv_count || 0),
          lastActiveAt: (row as any).last_active ? new Date((row as any).last_active).toISOString() : null,
        });
      }
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  try {
    const { activeTaskTracker } = await import("./heartbeat");
    for (const [, task] of activeTaskTracker) {
      const existing = workloads.find(w => w.personaId === task.personaId);
      if (existing) {
        existing.activeTaskCount++;
      } else {
        workloads.push({
          personaId: task.personaId as number,
          personaName: task.personaName || PERSONA_NAMES[task.personaId as number] || `Persona ${task.personaId}`,
          activeTaskCount: 1,
          recentConversations24h: 0,
          lastActiveAt: null,
        });
      }
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  return workloads;
}

async function getSystemMood(tenantId: number): Promise<SystemMood> {
  const mood: SystemMood = {
    recentFrustrationRate: 0,
    recentSatisfactionRate: 0,
    avgSentimentScore: 0,
    dominantSignal: "calm",
    sampleSize: 0,
  };

  try {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE frustration = true) as frustrated,
        COUNT(*) FILTER (WHERE satisfaction = true) as satisfied,
        COUNT(*) FILTER (WHERE confusion = true) as confused,
        COUNT(*) FILTER (WHERE urgency = true) as urgent,
        COALESCE(AVG(score), 0) as avg_score
      FROM sentiment_events 
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const rows = (result as any)?.rows || result;
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as any;
      const total = Number(row.total || 0);
      mood.sampleSize = total;
      if (total > 0) {
        const frustrated = Number(row.frustrated || 0);
        const satisfied = Number(row.satisfied || 0);
        const confused = Number(row.confused || 0);
        const urgent = Number(row.urgent || 0);
        mood.recentFrustrationRate = Math.round((frustrated / total) * 100);
        mood.recentSatisfactionRate = Math.round((satisfied / total) * 100);
        mood.avgSentimentScore = Math.round(Number(row.avg_score || 0) * 10) / 10;

        if (frustrated > satisfied && frustrated >= total * 0.3) mood.dominantSignal = "frustrated";
        else if (confused >= total * 0.3) mood.dominantSignal = "confused";
        else if (urgent >= total * 0.3) mood.dominantSignal = "urgent";
        else if (satisfied > frustrated && satisfied >= total * 0.3) mood.dominantSignal = "positive";
        else if (frustrated > 0 && satisfied > 0) mood.dominantSignal = "mixed";
        else mood.dominantSignal = "calm";
      }
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }

  return mood;
}

async function getRecentEventSummary(tenantId: number): Promise<{ type: string; count: number }[]> {
  try {
    const { getEventStats } = await import("./event-bus");
    const stats = await getEventStats(tenantId);
    if (stats?.topEventTypes && Array.isArray(stats.topEventTypes)) {
      return stats.topEventTypes.slice(0, 8).map((e: any) => ({
        type: String(e.event_type || e.type || "unknown"),
        count: Number(e.count || 0),
      }));
    }
  } catch (_silentErr) { logSilentCatch("server/situation-room.ts", _silentErr); }
  return [];
}

function computeAlerts(
  infraHealth: InfraHealth,
  activeWork: ActiveWork,
  mood: SystemMood,
  workloads: PersonaWorkload[]
): string[] {
  const alerts: string[] = [];

  if (infraHealth.overall === "degraded") alerts.push("System health is degraded — check provider connectivity");
  if (infraHealth.overall === "down") alerts.push("CRITICAL: System health reports DOWN status");
  if (!infraHealth.heartbeatRunning) alerts.push("Heartbeat engine is not running — background tasks are stalled");
  if (!infraHealth.watchdogRunning) alerts.push("Stability watchdog is offline — no auto-remediation active");
  if (infraHealth.recentRemediations >= 5) alerts.push(`Watchdog performed ${infraHealth.recentRemediations} remediations recently — instability detected`);

  if (activeWork.stalledItems > 0) alerts.push(`${activeWork.stalledItems} stuck/stalled item(s) detected — may need intervention`);
  if (activeWork.heartbeatTasks.length > 3) alerts.push(`High task concurrency: ${activeWork.heartbeatTasks.length} tasks running simultaneously`);

  if (mood.dominantSignal === "frustrated" && mood.sampleSize >= 3) {
    alerts.push(`User frustration trend detected (${mood.recentFrustrationRate}% of recent interactions) — consider response quality review`);
  }

  const overloaded = workloads.filter(w => w.recentConversations24h > 20);
  if (overloaded.length > 0) {
    alerts.push(`Overloaded persona(s): ${overloaded.map(w => `${w.personaName} (${w.recentConversations24h} convs)`).join(", ")}`);
  }

  return alerts;
}

function computeSystemStatus(infraHealth: InfraHealth, activeWork: ActiveWork, alerts: string[]): SituationSnapshot["systemStatus"] {
  if (infraHealth.overall === "down" || !infraHealth.heartbeatRunning) return "critical";
  if (infraHealth.overall === "degraded" || activeWork.stalledItems > 2) return "degraded";
  if (alerts.length > 2) return "attention";
  return "nominal";
}

function generateBriefing(snapshot: Omit<SituationSnapshot, "briefing">): string {
  const lines: string[] = [];

  const statusEmoji: Record<string, string> = { nominal: "GREEN", attention: "YELLOW", degraded: "ORANGE", critical: "RED" };
  lines.push(`System Status: ${statusEmoji[snapshot.systemStatus] || "UNKNOWN"}`);

  if (snapshot.activeWork.orchestrationPlans > 0 || snapshot.activeWork.heartbeatTasks.length > 0) {
    const parts: string[] = [];
    if (snapshot.activeWork.orchestrationPlans > 0) parts.push(`${snapshot.activeWork.orchestrationPlans} orchestration plan(s)`);
    if (snapshot.activeWork.heartbeatTasks.length > 0) parts.push(`${snapshot.activeWork.heartbeatTasks.length} background task(s)`);
    if (snapshot.activeWork.activeDelegations > 0) parts.push(`${snapshot.activeWork.activeDelegations} active delegation(s)`);
    lines.push(`Active Work: ${parts.join(", ")}`);
  } else {
    lines.push("Active Work: System idle — no active tasks or delegations.");
  }

  if (snapshot.personaWorkloads.length > 0) {
    const topPersonas = snapshot.personaWorkloads.slice(0, 3);
    lines.push(`Most Active Personas (24h): ${topPersonas.map(p => `${p.personaName} (${p.recentConversations24h} convs)`).join(", ")}`);
  }

  if (snapshot.systemMood.sampleSize > 0) {
    lines.push(`User Sentiment: ${snapshot.systemMood.dominantSignal} (${snapshot.systemMood.sampleSize} signals, avg score: ${snapshot.systemMood.avgSentimentScore})`);
  }

  if (snapshot.alerts.length > 0) {
    lines.push(`Alerts (${snapshot.alerts.length}): ${snapshot.alerts[0]}${snapshot.alerts.length > 1 ? ` (+${snapshot.alerts.length - 1} more)` : ""}`);
  }

  return lines.join("\n");
}

export async function getSituationSnapshot(tenantId: number, forceRefresh = false): Promise<SituationSnapshot> {
  const now = Date.now();
  if (!forceRefresh && lastSnapshot && lastSnapshot.tenantId === tenantId && (now - lastSnapshotTime) < CACHE_TTL_MS) {
    return lastSnapshot;
  }

  const [activeWork, infraHealth, personaWorkloads, systemMood, recentEvents] = await Promise.all([
    getActiveWorkState(tenantId),
    getInfraHealthState(tenantId),
    getPersonaWorkloads(tenantId),
    getSystemMood(tenantId),
    getRecentEventSummary(tenantId),
  ]);

  const alerts = computeAlerts(infraHealth, activeWork, systemMood, personaWorkloads);
  const systemStatus = computeSystemStatus(infraHealth, activeWork, alerts);

  const partialSnapshot = {
    generatedAt: new Date().toISOString(),
    tenantId,
    systemStatus,
    activeWork,
    infraHealth,
    personaWorkloads,
    systemMood,
    recentEvents,
    alerts,
  };

  const briefing = generateBriefing(partialSnapshot);

  const snapshot: SituationSnapshot = { ...partialSnapshot, briefing };

  lastSnapshot = snapshot;
  lastSnapshotTime = now;

  return snapshot;
}

export function getSituationBriefing(snapshot: SituationSnapshot): string {
  return snapshot.briefing;
}

export function getOrchestratorContext(snapshot: SituationSnapshot): string {
  const sections: string[] = [];

  sections.push(`## SITUATION ROOM BRIEFING (${new Date().toISOString()})`);
  sections.push(`System: ${snapshot.systemStatus.toUpperCase()}`);

  if (snapshot.activeWork.heartbeatTasks.length > 0) {
    sections.push(`Running Tasks: ${snapshot.activeWork.heartbeatTasks.map(t => `${t.personaName}→${t.taskName}`).join(", ")}`);
  }
  if (snapshot.activeWork.stalledItems > 0) {
    sections.push(`WARNING: ${snapshot.activeWork.stalledItems} stalled item(s) detected.`);
  }

  if (snapshot.personaWorkloads.length > 0) {
    const busy = snapshot.personaWorkloads.filter(p => p.recentConversations24h > 5 || p.activeTaskCount > 0);
    if (busy.length > 0) {
      sections.push(`Busy Personas: ${busy.map(p => `${p.personaName}(${p.recentConversations24h} convs, ${p.activeTaskCount} tasks)`).join(", ")}`);
    }
  }

  if (snapshot.systemMood.sampleSize > 0 && snapshot.systemMood.dominantSignal !== "calm") {
    sections.push(`User Mood: ${snapshot.systemMood.dominantSignal} — adjust delegation priority accordingly.`);
  }

  if (snapshot.alerts.length > 0) {
    sections.push(`Alerts: ${snapshot.alerts.join("; ")}`);
  }

  return sections.join("\n");
}

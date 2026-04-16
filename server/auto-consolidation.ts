import { db, isOffHours } from "./db";
import { sql } from "drizzle-orm";
import { runDreamConsolidation, type DreamConsolidationResult } from "./dream-consolidation";

export interface ConsolidationState {
  lastConsolidatedAt: Date | null;
  sessionsSinceLastRun: number;
  isRunning: boolean;
  lastResult: DreamConsolidationResult | null;
  nextEligibleAt: Date | null;
  totalRuns: number;
}

interface TenantConsolidationTracker {
  lastConsolidatedAt: Date | null;
  sessionCount: number;
  seenConversations: Set<number>;
  isRunning: boolean;
  lastResult: DreamConsolidationResult | null;
  totalRuns: number;
  lastActivityAt: Date;
}

const tenantTrackers = new Map<number, TenantConsolidationTracker>();

const MIN_HOURS_BETWEEN_RUNS = 6;
const MIN_SESSIONS_BEFORE_RUN = 5;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_TRACKER_AGE_HOURS = 72;

function getTracker(tenantId: number): TenantConsolidationTracker {
  let tracker = tenantTrackers.get(tenantId);
  if (!tracker) {
    tracker = {
      lastConsolidatedAt: null,
      sessionCount: 0,
      seenConversations: new Set(),
      isRunning: false,
      lastResult: null,
      totalRuns: 0,
      lastActivityAt: new Date(),
    };
    tenantTrackers.set(tenantId, tracker);
  }
  return tracker;
}

export function trackConversationActivity(tenantId: number, conversationId: number): void {
  const tracker = getTracker(tenantId);
  tracker.lastActivityAt = new Date();
  if (!tracker.seenConversations.has(conversationId)) {
    tracker.seenConversations.add(conversationId);
    tracker.sessionCount++;
  }
}

function evictStaleTenants(): void {
  const now = Date.now();
  for (const [tenantId, tracker] of tenantTrackers) {
    if (tracker.isRunning) continue;
    const ageHours = (now - tracker.lastActivityAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > MAX_TRACKER_AGE_HOURS) {
      tenantTrackers.delete(tenantId);
    }
  }
}

function hoursElapsed(since: Date | null): number {
  if (!since) return Infinity;
  return (Date.now() - since.getTime()) / (1000 * 60 * 60);
}

async function shouldConsolidate(tenantId: number): Promise<boolean> {
  const tracker = getTracker(tenantId);

  if (tracker.isRunning) return false;

  if (hoursElapsed(tracker.lastConsolidatedAt) < MIN_HOURS_BETWEEN_RUNS) return false;

  if (tracker.sessionCount < MIN_SESSIONS_BEFORE_RUN) return false;

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM memory_entries 
      WHERE tenant_id = ${tenantId} AND status = 'active'
    `);
    const rows = result as any;
    const count = Number(rows?.rows?.[0]?.cnt || rows?.[0]?.cnt || 0);
    if (count < 5) return false;
  } catch {
    return false;
  }

  return true;
}

async function runForTenant(tenantId: number): Promise<DreamConsolidationResult | null> {
  const tracker = getTracker(tenantId);
  tracker.isRunning = true;

  console.log(`[auto-consolidation] Starting scheduled consolidation for tenant ${tenantId} (${tracker.sessionCount} conversations since last run)`);

  try {
    const result = await runDreamConsolidation(tenantId, 10);
    tracker.lastConsolidatedAt = new Date();
    tracker.sessionCount = 0;
    tracker.seenConversations.clear();
    tracker.lastResult = result;
    tracker.totalRuns++;

    console.log(`[auto-consolidation] Completed for tenant ${tenantId}: ${result.summary}`);

    try {
      await db.execute(sql`
        INSERT INTO consolidation_log (tenant_id, reviewed, merged, archived, promoted, created, errors, summary, duration_ms, created_at)
        VALUES (${tenantId}, ${result.reviewed}, ${result.merged}, ${result.archived}, ${result.promoted}, ${result.created}, ${result.errors}, ${result.summary}, ${result.durationMs}, NOW())
      `);
    } catch (logErr) {
      console.log("[auto-consolidation] Log table not available:", (logErr as Error).message?.slice(0, 80));
    }

    return result;
  } catch (err) {
    console.error(`[auto-consolidation] Failed for tenant ${tenantId}:`, (err as Error).message);
    return null;
  } finally {
    tracker.isRunning = false;
  }
}

async function checkAllTenants(): Promise<void> {
  evictStaleTenants();

  try {
    const result = await db.execute(sql`
      SELECT DISTINCT tenant_id FROM memory_entries WHERE status = 'active' AND tenant_id IS NOT NULL
    `);
    const rows = (result as any)?.rows || result;
    if (!Array.isArray(rows)) return;

    for (const row of rows) {
      const tenantId = Number((row as any).tenant_id);
      if (!tenantId || isNaN(tenantId)) continue;

      const eligible = await shouldConsolidate(tenantId);
      if (eligible) {
        await runForTenant(tenantId);
      }
    }
  } catch (err) {
    console.error("[auto-consolidation] Tenant scan failed:", (err as Error).message);
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

export function startAutoConsolidation(): void {
  if (schedulerInterval) return;

  console.log(`[auto-consolidation] Scheduler started (check every ${CHECK_INTERVAL_MS / 60000} min, min ${MIN_HOURS_BETWEEN_RUNS}h between runs, min ${MIN_SESSIONS_BEFORE_RUN} sessions)`);

  initialTimeout = setTimeout(() => {
    initialTimeout = null;
    checkAllTenants().catch(err => {
      console.error("[auto-consolidation] Initial check failed:", (err as Error).message);
    });
  }, 60_000);

  schedulerInterval = setInterval(() => {
    if (isOffHours()) return;
    checkAllTenants().catch(err => {
      console.error("[auto-consolidation] Scheduled check failed:", (err as Error).message);
    });
  }, CHECK_INTERVAL_MS);
}

export function stopAutoConsolidation(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[auto-consolidation] Scheduler stopped");
  }
}

export function getConsolidationState(tenantId: number): ConsolidationState {
  const tracker = getTracker(tenantId);
  let nextEligibleAt: Date | null = null;

  if (tracker.lastConsolidatedAt) {
    const nextTime = new Date(tracker.lastConsolidatedAt.getTime() + MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000);
    if (nextTime > new Date()) {
      nextEligibleAt = nextTime;
    }
  }

  return {
    lastConsolidatedAt: tracker.lastConsolidatedAt,
    sessionsSinceLastRun: tracker.sessionCount,
    isRunning: tracker.isRunning,
    lastResult: tracker.lastResult,
    nextEligibleAt,
    totalRuns: tracker.totalRuns,
  };
}

export async function triggerManualConsolidation(tenantId: number): Promise<DreamConsolidationResult | null> {
  const tracker = getTracker(tenantId);
  if (tracker.isRunning) {
    return null;
  }
  return runForTenant(tenantId);
}

import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
interface TuningConfig {
  trustDeltas: Record<string, { amount: number; safeMin: number; safeMax: number }>;
  evaluatorThresholds: Record<string, { warning: number; critical: number; safeMinW: number; safeMaxW: number; safeMinC: number; safeMaxC: number }>;
  expressLaneCaps: { dailyCap: number; safeMin: number; safeMax: number; consecutiveFailLimit: number };
  pabBudgets: { thresholds: number[]; budgets: number[] };
  protocolLimits: Record<string, { limit: number; safeMin: number; safeMax: number }>;
  upgradeDaysRequired: number;
}

const DEFAULT_CONFIG: TuningConfig = {
  trustDeltas: {
    task_success: { amount: 2, safeMin: 1, safeMax: 5 },
    task_failure: { amount: -3, safeMin: -8, safeMax: -1 },
    quality_ship: { amount: 3, safeMin: 1, safeMax: 5 },
    quality_minor_edits: { amount: 1, safeMin: 1, safeMax: 3 },
    quality_revision: { amount: -5, safeMin: -10, safeMax: -2 },
    quality_rewrite: { amount: -10, safeMin: -15, safeMax: -5 },
    user_positive: { amount: 5, safeMin: 2, safeMax: 8 },
    user_negative: { amount: -10, safeMin: -15, safeMax: -5 },
    proactive_success: { amount: 3, safeMin: 1, safeMax: 5 },
    proactive_failure: { amount: -5, safeMin: -10, safeMax: -2 },
    tool_violation: { amount: -5, safeMin: -10, safeMax: -2 },
    purpose_drift: { amount: -8, safeMin: -15, safeMax: -3 },
    governance_trigger: { amount: -5, safeMin: -10, safeMax: -2 },
    hitl_rejection: { amount: -7, safeMin: -12, safeMax: -3 },
    clean_week: { amount: 5, safeMin: 2, safeMax: 8 },
    express_lane_success: { amount: 2, safeMin: 1, safeMax: 4 },
  },
  evaluatorThresholds: {
    daily_spend: { warning: 70, critical: 90, safeMinW: 50, safeMaxW: 85, safeMinC: 80, safeMaxC: 95 },
    failover_rate: { warning: 20, critical: 40, safeMinW: 10, safeMaxW: 35, safeMinC: 30, safeMaxC: 60 },
    pii_exposure: { warning: 1, critical: 3, safeMinW: 1, safeMaxW: 3, safeMinC: 2, safeMaxC: 5 },
    tool_boundary_violations: { warning: 3, critical: 7, safeMinW: 2, safeMaxW: 5, safeMinC: 5, safeMaxC: 10 },
    auth_failures: { warning: 3, critical: 5, safeMinW: 2, safeMaxW: 5, safeMinC: 4, safeMaxC: 8 },
    desk_queue: { warning: 10, critical: 25, safeMinW: 5, safeMaxW: 15, safeMinC: 15, safeMaxC: 40 },
  },
  expressLaneCaps: { dailyCap: 10, safeMin: 5, safeMax: 25, consecutiveFailLimit: 3 },
  pabBudgets: { thresholds: [50, 65, 80], budgets: [0, 1, 3, 5] },
  protocolLimits: {
    chain_of_debates: { limit: 5, safeMin: 2, safeMax: 10 },
    tree_of_thought: { limit: 5, safeMin: 2, safeMax: 10 },
    full_council: { limit: 2, safeMin: 1, safeMax: 5 },
  },
  upgradeDaysRequired: 5,
};

interface TuningSnapshot {
  timestamp: number;
  config: TuningConfig;
  metrics: PerformanceMetrics;
  adjustments: TuningAdjustment[];
}

interface PerformanceMetrics {
  totalTasks7d: number;
  successRate7d: number;
  failureRate7d: number;
  avgTrustScore: number;
  trustScoreVariance: number;
  trustCeilingAgents: number;
  trustFloorAgents: number;
  totalGovernanceActions7d: number;
  expressLaneUsage7d: number;
  expressLaneFailRate7d: number;
  evaluatorWarnings7d: number;
  evaluatorCriticals7d: number;
  proactiveSuccessRate: number;
  proactiveActionsTotal7d: number;
  hitlRejectionRate: number;
}

interface TuningAdjustment {
  parameter: string;
  oldValue: number;
  newValue: number;
  reason: string;
  confidence: number;
}

let currentConfig: TuningConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let tuningHistory: TuningSnapshot[] = [];
let tunerInterval: ReturnType<typeof setInterval> | null = null;
const MAX_HISTORY = 90;

export function getCurrentConfig(): TuningConfig {
  return JSON.parse(JSON.stringify(currentConfig));
}

export function getTuningHistory(): TuningSnapshot[] {
  return tuningHistory;
}

export function getTrustDelta(event: string): number {
  return currentConfig.trustDeltas[event]?.amount ?? 0;
}

export function getEvaluatorThreshold(evaluator: string): { warning: number; critical: number } | null {
  return currentConfig.evaluatorThresholds[evaluator] ?? null;
}

export function getExpressLaneDailyCap(): number {
  return currentConfig.expressLaneCaps.dailyCap;
}

export function getProtocolLimit(protocol: string): number {
  return currentConfig.protocolLimits[protocol]?.limit ?? 5;
}

export function getPABConfig(): { thresholds: number[]; budgets: number[] } {
  return currentConfig.pabBudgets;
}

async function collectPerformanceMetrics(tenantId: number): Promise<PerformanceMetrics> {
  const metrics: PerformanceMetrics = {
    totalTasks7d: 0,
    successRate7d: 0,
    failureRate7d: 0,
    avgTrustScore: 0,
    trustScoreVariance: 0,
    trustCeilingAgents: 0,
    trustFloorAgents: 0,
    totalGovernanceActions7d: 0,
    expressLaneUsage7d: 0,
    expressLaneFailRate7d: 0,
    evaluatorWarnings7d: 0,
    evaluatorCriticals7d: 0,
    proactiveSuccessRate: 0,
    proactiveActionsTotal7d: 0,
    hitlRejectionRate: 0,
  };

  try {
    // R74.13y: This query previously read `status` directly off heartbeat_tasks,
    // but heartbeat_tasks tracks the SCHEDULE (enabled, cron, next_run_at) — not
    // per-run outcomes. Per-run status lives on heartbeat_logs, which has no
    // tenant_id column, so we join through the task to scope by tenant.
    // The error "column 'status' does not exist" was being silently swallowed
    // every 24h tuning cycle, leaving auto-tuner non-functional for ~all data.
    const taskResult = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE l.status = 'completed') as completed,
        COUNT(*) FILTER (WHERE l.status = 'failed') as failed
      FROM heartbeat_logs l
      JOIN heartbeat_tasks t ON t.id = l.task_id
      WHERE t.tenant_id = ${tenantId} AND l.created_at > NOW() - INTERVAL '7 days'
    `);
    const taskRows = ((taskResult as any).rows || taskResult) as any[];
    if (taskRows[0]) {
      metrics.totalTasks7d = parseInt(taskRows[0].total || "0");
      const completed = parseInt(taskRows[0].completed || "0");
      const failed = parseInt(taskRows[0].failed || "0");
      if (metrics.totalTasks7d > 0) {
        metrics.successRate7d = completed / metrics.totalTasks7d;
        metrics.failureRate7d = failed / metrics.totalTasks7d;
      }
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  try {
    const trustResult = await db.execute(sql`
      SELECT AVG(score) as avg_score, VARIANCE(score) as score_var,
        COUNT(*) FILTER (WHERE score >= 90) as ceiling_count,
        COUNT(*) FILTER (WHERE score <= 10) as floor_count
      FROM trust_scores WHERE tenant_id = ${tenantId}
    `);
    const trustRows = ((trustResult as any).rows || trustResult) as any[];
    if (trustRows[0]) {
      metrics.avgTrustScore = parseFloat(trustRows[0].avg_score || "0");
      metrics.trustScoreVariance = parseFloat(trustRows[0].score_var || "0");
      metrics.trustCeilingAgents = parseInt(trustRows[0].ceiling_count || "0");
      metrics.trustFloorAgents = parseInt(trustRows[0].floor_count || "0");
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  try {
    const govResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM governance_actions
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '7 days'
    `);
    const govRows = ((govResult as any).rows || govResult) as any[];
    metrics.totalGovernanceActions7d = parseInt(govRows[0]?.total || "0");
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  try {
    const laneResult = await db.execute(sql`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE success = false) as failures
      FROM express_lane_usage
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '7 days'
    `);
    const laneRows = ((laneResult as any).rows || laneResult) as any[];
    if (laneRows[0]) {
      metrics.expressLaneUsage7d = parseInt(laneRows[0].total || "0");
      const failures = parseInt(laneRows[0].failures || "0");
      if (metrics.expressLaneUsage7d > 0) {
        metrics.expressLaneFailRate7d = failures / metrics.expressLaneUsage7d;
      }
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  try {
    const proResult = await db.execute(sql`
      SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome IN ('exceptional', 'solid', 'acceptable')) as successes
      FROM proactive_actions
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '7 days' AND outcome IS NOT NULL AND outcome != 'pending'
    `);
    const proRows = ((proResult as any).rows || proResult) as any[];
    if (proRows[0]) {
      metrics.proactiveActionsTotal7d = parseInt(proRows[0].total || "0");
      const successes = parseInt(proRows[0].successes || "0");
      if (metrics.proactiveActionsTotal7d > 0) {
        metrics.proactiveSuccessRate = successes / metrics.proactiveActionsTotal7d;
      }
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  try {
    const snapResult = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE (metrics->>'status') = 'warning') as warnings,
        COUNT(*) FILTER (WHERE (metrics->>'status') = 'critical') as criticals
      FROM evaluator_snapshots
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '7 days'
    `);
    const snapRows = ((snapResult as any).rows || snapResult) as any[];
    if (snapRows[0]) {
      metrics.evaluatorWarnings7d = parseInt(snapRows[0].warnings || "0");
      metrics.evaluatorCriticals7d = parseInt(snapRows[0].criticals || "0");
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }

  return metrics;
}

function computeAdjustments(metrics: PerformanceMetrics): TuningAdjustment[] {
  const adjustments: TuningAdjustment[] = [];
  const MIN_TASKS = 20;
  const BOOTSTRAP_MIN_TASKS = 5;
  const BOOTSTRAP_MAX_CONFIDENCE = 0.55;

  const isBootstrap = metrics.totalTasks7d >= BOOTSTRAP_MIN_TASKS && metrics.totalTasks7d < MIN_TASKS;

  if (metrics.totalTasks7d < BOOTSTRAP_MIN_TASKS) {
    adjustments.push({
      parameter: "_skip",
      oldValue: metrics.totalTasks7d,
      newValue: BOOTSTRAP_MIN_TASKS,
      reason: `Insufficient data: ${metrics.totalTasks7d} tasks in 7d, need ${BOOTSTRAP_MIN_TASKS} minimum`,
      confidence: 0,
    });
    return adjustments;
  }

  if (isBootstrap) {
    console.log(`[auto-tuner] BOOTSTRAP MODE: ${metrics.totalTasks7d} tasks (< ${MIN_TASKS}). Using tighter safety bounds and capped confidence.`);
  }

  if (metrics.trustCeilingAgents > 8) {
    const currentDelta = currentConfig.trustDeltas.task_success;
    if (currentDelta.amount > currentDelta.safeMin) {
      const newAmount = Math.max(currentDelta.safeMin, currentDelta.amount - 1);
      if (newAmount !== currentDelta.amount) {
        adjustments.push({
          parameter: "trustDeltas.task_success.amount",
          oldValue: currentDelta.amount,
          newValue: newAmount,
          reason: `${metrics.trustCeilingAgents} agents at trust ceiling (≥90). Reducing task_success reward to prevent score inflation.`,
          confidence: 0.7,
        });
      }
    }
  }

  if (metrics.trustFloorAgents > 5 && metrics.successRate7d > 0.7) {
    const currentDelta = currentConfig.trustDeltas.task_failure;
    if (currentDelta.amount < currentDelta.safeMax) {
      const newAmount = Math.min(currentDelta.safeMax, currentDelta.amount + 1);
      if (newAmount !== currentDelta.amount) {
        adjustments.push({
          parameter: "trustDeltas.task_failure.amount",
          oldValue: currentDelta.amount,
          newValue: newAmount,
          reason: `${metrics.trustFloorAgents} agents at trust floor (≤10) despite ${Math.round(metrics.successRate7d * 100)}% success rate. Reducing task_failure penalty.`,
          confidence: 0.6,
        });
      }
    }
  }

  if (metrics.failureRate7d > 0.3 && metrics.trustScoreVariance < 100) {
    const currentDelta = currentConfig.trustDeltas.task_failure;
    if (currentDelta.amount > currentDelta.safeMin) {
      const newAmount = Math.max(currentDelta.safeMin, currentDelta.amount - 1);
      if (newAmount !== currentDelta.amount) {
        adjustments.push({
          parameter: "trustDeltas.task_failure.amount",
          oldValue: currentDelta.amount,
          newValue: newAmount,
          reason: `High failure rate (${Math.round(metrics.failureRate7d * 100)}%) but low trust variance. Increasing failure penalty for differentiation.`,
          confidence: 0.65,
        });
      }
    }
  }

  if (metrics.hitlRejectionRate > 0.4) {
    const currentDelta = currentConfig.trustDeltas.hitl_rejection;
    if (currentDelta.amount > currentDelta.safeMin) {
      const newAmount = Math.max(currentDelta.safeMin, currentDelta.amount - 2);
      if (newAmount !== currentDelta.amount) {
        adjustments.push({
          parameter: "trustDeltas.hitl_rejection.amount",
          oldValue: currentDelta.amount,
          newValue: newAmount,
          reason: `HITL rejection rate ${Math.round(metrics.hitlRejectionRate * 100)}% — agents need stronger penalty to calibrate.`,
          confidence: 0.7,
        });
      }
    }
  }

  if (metrics.expressLaneUsage7d > 50 && metrics.expressLaneFailRate7d < 0.05) {
    const caps = currentConfig.expressLaneCaps;
    if (caps.dailyCap < caps.safeMax) {
      const newCap = Math.min(caps.safeMax, caps.dailyCap + 2);
      if (newCap !== caps.dailyCap) {
        adjustments.push({
          parameter: "expressLaneCaps.dailyCap",
          oldValue: caps.dailyCap,
          newValue: newCap,
          reason: `Express lanes heavily used (${metrics.expressLaneUsage7d}/7d) with very low failure rate (${Math.round(metrics.expressLaneFailRate7d * 100)}%). Increasing daily cap.`,
          confidence: 0.75,
        });
      }
    }
  }

  if (metrics.expressLaneFailRate7d > 0.3 && metrics.expressLaneUsage7d > 10) {
    const caps = currentConfig.expressLaneCaps;
    if (caps.dailyCap > caps.safeMin) {
      const newCap = Math.max(caps.safeMin, caps.dailyCap - 2);
      if (newCap !== caps.dailyCap) {
        adjustments.push({
          parameter: "expressLaneCaps.dailyCap",
          oldValue: caps.dailyCap,
          newValue: newCap,
          reason: `Express lane failure rate ${Math.round(metrics.expressLaneFailRate7d * 100)}% is too high. Reducing daily cap.`,
          confidence: 0.8,
        });
      }
    }
  }

  if (metrics.evaluatorWarnings7d > 20 && metrics.evaluatorCriticals7d < 2) {
    for (const [evalName, config] of Object.entries(currentConfig.evaluatorThresholds)) {
      if (config.warning < config.safeMaxW) {
        const newWarning = Math.min(config.safeMaxW, config.warning + Math.ceil(config.warning * 0.1));
        if (newWarning !== config.warning) {
          adjustments.push({
            parameter: `evaluatorThresholds.${evalName}.warning`,
            oldValue: config.warning,
            newValue: newWarning,
            reason: `${metrics.evaluatorWarnings7d} evaluator warnings in 7d with only ${metrics.evaluatorCriticals7d} criticals. Warning threshold may be too sensitive.`,
            confidence: 0.5,
          });
          break;
        }
      }
    }
  }

  if (metrics.evaluatorCriticals7d > 10) {
    for (const [evalName, config] of Object.entries(currentConfig.evaluatorThresholds)) {
      if (config.critical > config.safeMinC) {
        const newCritical = Math.max(config.safeMinC, config.critical - Math.ceil(config.critical * 0.1));
        if (newCritical !== config.critical) {
          adjustments.push({
            parameter: `evaluatorThresholds.${evalName}.critical`,
            oldValue: config.critical,
            newValue: newCritical,
            reason: `${metrics.evaluatorCriticals7d} critical evaluator events in 7d. Tightening critical threshold to catch issues earlier.`,
            confidence: 0.6,
          });
          break;
        }
      }
    }
  }

  if (metrics.proactiveActionsTotal7d > 10 && metrics.proactiveSuccessRate > 0.85) {
    for (const [protocol, config] of Object.entries(currentConfig.protocolLimits)) {
      if (config.limit < config.safeMax) {
        adjustments.push({
          parameter: `protocolLimits.${protocol}.limit`,
          oldValue: config.limit,
          newValue: Math.min(config.safeMax, config.limit + 1),
          reason: `Proactive success rate ${Math.round(metrics.proactiveSuccessRate * 100)}% with ${metrics.proactiveActionsTotal7d} actions. Increasing ${protocol} daily limit.`,
          confidence: 0.6,
        });
        break;
      }
    }
  }

  if (isBootstrap) {
    for (const adj of adjustments) {
      if (adj.parameter === "_skip") continue;
      adj.confidence = Math.min(adj.confidence, BOOTSTRAP_MAX_CONFIDENCE);
      adj.reason = `[BOOTSTRAP] ${adj.reason}`;
    }

    const bootstrapAdj = adjustments.filter(a => a.parameter !== "_skip");
    if (bootstrapAdj.length > 2) {
      const sorted = bootstrapAdj.sort((a, b) => b.confidence - a.confidence);
      for (let i = 2; i < sorted.length; i++) {
        sorted[i].confidence = 0;
        sorted[i].reason += " (deferred — bootstrap limits to 2 changes per cycle)";
      }
    }
  }

  return adjustments;
}

function applyAdjustments(adjustments: TuningAdjustment[]): number {
  let applied = 0;

  for (const adj of adjustments) {
    if (adj.parameter === "_skip") continue;
    if (adj.confidence < 0.5) continue;

    const parts = adj.parameter.split(".");
    try {
      if (parts[0] === "trustDeltas" && parts.length === 3) {
        const event = parts[1];
        if (currentConfig.trustDeltas[event]) {
          currentConfig.trustDeltas[event].amount = adj.newValue;
          applied++;
        }
      } else if (parts[0] === "evaluatorThresholds" && parts.length === 3) {
        const evalName = parts[1];
        const field = parts[2] as "warning" | "critical";
        if (currentConfig.evaluatorThresholds[evalName]) {
          currentConfig.evaluatorThresholds[evalName][field] = adj.newValue;
          applied++;
        }
      } else if (parts[0] === "expressLaneCaps") {
        if (parts[1] === "dailyCap") {
          currentConfig.expressLaneCaps.dailyCap = adj.newValue;
          applied++;
        }
      } else if (parts[0] === "protocolLimits" && parts.length === 3) {
        const protocol = parts[1];
        if (currentConfig.protocolLimits[protocol]) {
          currentConfig.protocolLimits[protocol].limit = adj.newValue;
          applied++;
        }
      }
    } catch (e) {
      console.error(`[auto-tuner] Failed to apply adjustment ${adj.parameter}:`, e);
    }
  }

  return applied;
}

async function persistSnapshot(tenantId: number, snapshot: TuningSnapshot): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO evaluator_snapshots (tenant_id, evaluator_name, metrics)
      VALUES (${tenantId}, 'auto_tuner', ${JSON.stringify(snapshot)}::jsonb)
    `);
  } catch (e) {
    console.error("[auto-tuner] Failed to persist snapshot:", e);
  }
}

export async function runTuningCycle(tenantId: number): Promise<TuningSnapshot> {
  // R74.13f fail-closed: removed `tenantId: number = 1` default. The
  // two intra-file schedulers (lines 522, 526) and the routes/agency.ts
  // caller all pass explicitly, so the default was dead code. Made
  // required so any future caller is forced to pass — better to error
  // loudly than silently tune the wrong tenant's heartbeat config.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`runTuningCycle requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  console.log("[auto-tuner] Starting tuning cycle...");

  const metrics = await collectPerformanceMetrics(tenantId);
  const adjustments = computeAdjustments(metrics);

  const actionableAdjustments = adjustments.filter(a => a.parameter !== "_skip" && a.confidence >= 0.5);

  if (actionableAdjustments.length > 0) {
    const applied = applyAdjustments(actionableAdjustments);
    console.log(`[auto-tuner] Applied ${applied} adjustments:`);
    for (const adj of actionableAdjustments) {
      console.log(`  ${adj.parameter}: ${adj.oldValue} → ${adj.newValue} (${Math.round(adj.confidence * 100)}% confidence) — ${adj.reason}`);
    }
  } else {
    const skipReason = adjustments.find(a => a.parameter === "_skip");
    if (skipReason) {
      console.log(`[auto-tuner] Skipped: ${skipReason.reason}`);
    } else {
      console.log("[auto-tuner] No adjustments needed — all parameters within healthy ranges.");
    }
  }

  const snapshot: TuningSnapshot = {
    timestamp: Date.now(),
    config: JSON.parse(JSON.stringify(currentConfig)),
    metrics,
    adjustments,
  };

  tuningHistory.push(snapshot);
  if (tuningHistory.length > MAX_HISTORY) {
    tuningHistory = tuningHistory.slice(-MAX_HISTORY);
  }

  await persistSnapshot(tenantId, snapshot);

  return snapshot;
}

export function startAutoTuner(intervalMs: number = 86400000): void {
  if (tunerInterval) {
    clearInterval(tunerInterval);
  }

  console.log(`[auto-tuner] Started (cycle every ${Math.round(intervalMs / 3600000)}h)`);

  setTimeout(() => {
    runTuningCycle(1).catch(e => console.error("[auto-tuner] Initial cycle failed:", e));
  }, 60000);

  tunerInterval = setInterval(() => {
    runTuningCycle(1).catch(e => console.error("[auto-tuner] Cycle failed:", e));
  }, intervalMs);
}

export function stopAutoTuner(): void {
  if (tunerInterval) {
    clearInterval(tunerInterval);
    tunerInterval = null;
    console.log("[auto-tuner] Stopped");
  }
}

export function resetToDefaults(): TuningConfig {
  currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  console.log("[auto-tuner] Reset all parameters to defaults");
  return getCurrentConfig();
}

export function overrideParameter(path: string, value: number): boolean {
  const parts = path.split(".");
  try {
    if (parts[0] === "trustDeltas" && parts.length === 3) {
      const event = parts[1];
      const config = currentConfig.trustDeltas[event];
      if (!config) return false;
      const clamped = Math.max(config.safeMin, Math.min(config.safeMax, value));
      config.amount = clamped;
      console.log(`[auto-tuner] Manual override: ${path} = ${clamped}`);
      return true;
    } else if (parts[0] === "evaluatorThresholds" && parts.length === 3) {
      const evalName = parts[1];
      const field = parts[2];
      const config = currentConfig.evaluatorThresholds[evalName];
      if (!config) return false;
      if (field === "warning") {
        config.warning = Math.max(config.safeMinW, Math.min(config.safeMaxW, value));
      } else if (field === "critical") {
        config.critical = Math.max(config.safeMinC, Math.min(config.safeMaxC, value));
      } else {
        return false;
      }
      console.log(`[auto-tuner] Manual override: ${path} = ${value}`);
      return true;
    } else if (parts[0] === "expressLaneCaps" && parts[1] === "dailyCap") {
      const caps = currentConfig.expressLaneCaps;
      caps.dailyCap = Math.max(caps.safeMin, Math.min(caps.safeMax, value));
      console.log(`[auto-tuner] Manual override: ${path} = ${caps.dailyCap}`);
      return true;
    } else if (parts[0] === "protocolLimits" && parts.length === 3) {
      const protocol = parts[1];
      const config = currentConfig.protocolLimits[protocol];
      if (!config) return false;
      config.limit = Math.max(config.safeMin, Math.min(config.safeMax, value));
      console.log(`[auto-tuner] Manual override: ${path} = ${config.limit}`);
      return true;
    }
  } catch (_silentErr) { logSilentCatch("server/auto-tuner.ts", _silentErr); }
  return false;
}

export function getAutoTunerStatus(): {
  running: boolean;
  bootstrapMode: boolean;
  currentConfig: TuningConfig;
  lastSnapshot: TuningSnapshot | null;
  totalAdjustmentsMade: number;
  historyLength: number;
} {
  const totalAdj = tuningHistory.reduce((sum, snap) =>
    sum + snap.adjustments.filter(a => a.parameter !== "_skip" && a.confidence >= 0.5).length, 0);

  const lastSnap = tuningHistory.length > 0 ? tuningHistory[tuningHistory.length - 1] : null;
  const lastTasks = lastSnap?.metrics?.totalTasks7d ?? 0;

  return {
    running: tunerInterval !== null,
    bootstrapMode: lastTasks >= 5 && lastTasks < 20,
    currentConfig: getCurrentConfig(),
    lastSnapshot: lastSnap,
    totalAdjustmentsMade: totalAdj,
    historyLength: tuningHistory.length,
  };
}

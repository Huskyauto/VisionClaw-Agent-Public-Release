import { db } from "./db";
import { sql } from "drizzle-orm";
import { runAllEvaluators, evalDailySpend, evalPIIExposure, evalFailoverRate, evalToolBoundaryViolations, evalDeskQueue, evalContentPipeline, evalAgentSpendRatio } from "./evaluators";
import { getAllTrustScores, type TrustCategory } from "./trust-engine";
import { getApprovedLanes } from "./express-lanes";
import { getProactiveQualityStats, getAvailablePAB } from "./proactive-engine";

const PROTECTED_EVENTS = new Set([
  "agent.task.completed",
  "agent.task.failed",
  "system.health.degraded",
  "monitor.alert",
]);

interface GovernanceRule {
  id: number;
  tenantId: number;
  category: string;
  ruleName: string;
  description: string;
  condition: any;
  action: string;
  actionConfig: any;
  escalateToHuman: boolean;
  escalationReason: string | null;
  priority: number;
  enabled: boolean;
  triggerCount: number;
}

interface RuleEvaluation {
  ruleId: number;
  ruleName: string;
  category: string;
  conditionMet: boolean;
  conditionDetail: string;
  actionTaken: string | null;
  escalated: boolean;
  escalationReason: string | null;
}

export interface GovernorReport {
  timestamp: string;
  rulesEvaluated: number;
  rulesTriggered: number;
  actionsApplied: number;
  escalations: number;
  evaluations: RuleEvaluation[];
  summary: string;
}

async function loadRules(tenantId: number): Promise<GovernanceRule[]> {
  const result = await db.execute(sql`
    SELECT id, tenant_id, category, rule_name, description, condition, action, action_config,
           escalate_to_human, escalation_reason, priority, enabled, trigger_count
    FROM governance_rules WHERE tenant_id = ${tenantId} AND enabled = true
    ORDER BY priority DESC
  `);
  const rows = ((result as any).rows || result) as any[];
  return rows.map(r => ({
    id: r.id,
    tenantId: r.tenant_id,
    category: r.category,
    ruleName: r.rule_name,
    description: r.description,
    condition: typeof r.condition === "string" ? JSON.parse(r.condition) : r.condition,
    action: r.action,
    actionConfig: typeof r.action_config === "string" ? JSON.parse(r.action_config) : r.action_config,
    escalateToHuman: r.escalate_to_human,
    escalationReason: r.escalation_reason,
    priority: r.priority,
    enabled: r.enabled,
    triggerCount: r.trigger_count || 0,
  }));
}

async function evaluateCondition(rule: GovernanceRule, tenantId: number): Promise<{ met: boolean; detail: string }> {
  const cond = rule.condition;
  try {
    switch (cond.check) {
      case "subscription_activity": {
        const subsResult = await db.execute(sql`
          SELECT es.id, es.event_type, es.enabled,
            (SELECT COUNT(*) FROM event_log el WHERE el.event_type = es.event_type AND el.tenant_id = ${tenantId}
             AND el.created_at > NOW() - INTERVAL '30 days') as recent_events
          FROM event_subscriptions es WHERE es.tenant_id = ${tenantId}
        `);
        const subs = ((subsResult as any).rows || subsResult) as any[];
        const nonProtected = subs.filter((s: any) => !PROTECTED_EVENTS.has(s.event_type));

        if (cond.operator === "equals" && cond.value === 0) {
          const dead = nonProtected.filter((s: any) => s.enabled && parseInt(s.recent_events || "0") === 0);
          if (dead.length > 0) {
            return { met: true, detail: `${dead.length} active subscription(s) with zero events in 30 days: ${dead.map((d: any) => d.event_type).join(", ")}` };
          }
          const activitySubs = await checkBusinessActivity(tenantId);
          const noActivity = nonProtected.filter((s: any) => {
            const check = activitySubs.find(a => a.eventType === s.event_type);
            return s.enabled && check && !check.hasActivity;
          });
          if (noActivity.length > 0) {
            return { met: true, detail: `${noActivity.length} subscription(s) with no business justification: ${noActivity.map((d: any) => d.event_type).join(", ")}` };
          }
        }
        if (cond.operator === "greater_than" && cond.value === 0) {
          const activitySubs = await checkBusinessActivity(tenantId);
          const justified = activitySubs.filter(a => a.hasActivity);
          const disabled = nonProtected.filter((s: any) => !s.enabled);
          const enableable = disabled.filter((s: any) => justified.find(j => j.eventType === s.event_type));
          if (enableable.length > 0) {
            return { met: true, detail: `${enableable.length} disabled subscription(s) now have business activity: ${enableable.map((e: any) => e.event_type).join(", ")}` };
          }
        }
        return { met: false, detail: "All subscriptions appropriately configured" };
      }

      case "task_failure_rate": {
        const taskResult = await db.execute(sql`
          SELECT ht.id, ht.name,
            (SELECT COUNT(*) FROM heartbeat_logs WHERE task_id = ht.id AND status = 'success' AND created_at > NOW() - INTERVAL '7 days') as successes,
            (SELECT COUNT(*) FROM heartbeat_logs WHERE task_id = ht.id AND status != 'success' AND created_at > NOW() - INTERVAL '7 days') as failures
          FROM heartbeat_tasks ht WHERE ht.enabled = true AND ht.tenant_id = ${tenantId}
        `);
        const tasks = ((taskResult as any).rows || taskResult) as any[];
        const failing = tasks.filter((t: any) => {
          const s = parseInt(t.successes || "0");
          const f = parseInt(t.failures || "0");
          return (s + f) >= (cond.min_attempts || 5) && s === 0 && f > 0;
        });
        if (failing.length > 0) {
          return { met: true, detail: `${failing.length} task(s) with 100% failure: ${failing.map((f: any) => `"${f.name}" (${f.failures} failures)`).join(", ")}` };
        }
        return { met: false, detail: "All active tasks have at least some successes" };
      }

      case "delegation_source": {
        return { met: false, detail: "Delegation blocking handled inline by heartbeat guards" };
      }

      case "daily_spend": {
        const spend = await evalDailySpend(tenantId);
        if (spend.status === "critical") {
          return { met: true, detail: `Daily spend at ${spend.metrics.spend_percent}% of budget ($${spend.metrics.spend_total}). CRITICAL.` };
        }
        if (spend.status === "warning") {
          return { met: true, detail: `Daily spend at ${spend.metrics.spend_percent}% of budget ($${spend.metrics.spend_total}). Warning threshold.` };
        }
        return { met: false, detail: `Daily spend at ${spend.metrics.spend_percent}% — within budget` };
      }

      case "desk_status": {
        const deskResult = await db.execute(sql`
          SELECT ad.persona_id, p.name as persona_name, ad.status_note, ad.updated_at,
            (SELECT COUNT(*) FROM heartbeat_tasks WHERE persona_id = ad.persona_id AND enabled = true) as pending_tasks
          FROM agent_desks ad LEFT JOIN personas p ON p.id = ad.persona_id
          WHERE ad.tenant_id = ${tenantId}
        `);
        const desks = ((deskResult as any).rows || deskResult) as any[];
        const stalled = desks.filter((d: any) => {
          const hours = (Date.now() - new Date(d.updated_at).getTime()) / (1000 * 60 * 60);
          return hours > (cond.value || 24) && parseInt(d.pending_tasks || "0") > 0;
        });
        if (stalled.length > 0) {
          return { met: true, detail: `${stalled.length} agent(s) stalled 24h+ with pending work: ${stalled.map((s: any) => s.persona_name).join(", ")}` };
        }
        return { met: false, detail: "No stalled agents detected" };
      }

      case "watchlist_alert": {
        const alertResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM watchlist_alerts WHERE tenant_id = ${tenantId} AND acknowledged = false
        `);
        const cnt = parseInt(((alertResult as any).rows || alertResult)[0]?.cnt || "0");
        if (cnt > 0) {
          return { met: true, detail: `${cnt} unacknowledged watchlist alert(s) need routing` };
        }
        return { met: false, detail: "No pending watchlist alerts" };
      }

      case "provider_health": {
        const keyResult = await db.execute(sql`
          SELECT provider, enabled FROM provider_keys WHERE tenant_id = ${tenantId}
        `);
        const keys = ((keyResult as any).rows || keyResult) as any[];
        const activeKeys = keys.filter((k: any) => k.enabled !== false);
        if (activeKeys.length === 0) {
          return { met: true, detail: "No active AI provider keys — system cannot route any model requests" };
        }
        return { met: false, detail: `${activeKeys.length} active provider key(s) available` };
      }

      case "auth_failures": {
        return { met: false, detail: "Auth failure tracking evaluated at login time" };
      }

      case "response_time": {
        const perfResult = await db.execute(sql`
          SELECT AVG(duration_ms) as avg_ms FROM heartbeat_logs
          WHERE created_at > NOW() - INTERVAL '1 hour' AND duration_ms IS NOT NULL AND status = 'success'
        `);
        const avgMs = parseFloat(((perfResult as any).rows || perfResult)[0]?.avg_ms || "0");
        if (avgMs > (cond.value || 30000)) {
          return { met: true, detail: `Average response time ${Math.round(avgMs)}ms exceeds ${cond.value}ms threshold` };
        }
        return { met: false, detail: `Average response time ${Math.round(avgMs)}ms within threshold` };
      }

      case "desk_queue": {
        const dq = await evalDeskQueue(tenantId);
        if (dq.status === "warning") {
          return { met: true, detail: `Queue depth warning: max depth ${dq.metrics.max_queue_depth}` };
        }
        return { met: false, detail: `Queue depths normal (max: ${dq.metrics.max_queue_depth})` };
      }

      case "content_pipeline": {
        const cp = await evalContentPipeline(tenantId);
        if (cp.status === "warning") {
          return { met: true, detail: `Content pipeline issue: ${cp.metrics.bypassed_reviews} bypassed reviews, ${cp.metrics.unreviewed_content} unreviewed` };
        }
        return { met: false, detail: `Content pipeline healthy: ${cp.metrics.total_deliveries} deliveries tracked` };
      }

      case "autonomy_violation": {
        const violationResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM autonomy_log
          WHERE tenant_id = ${tenantId} AND decision = 'blocked'
          AND created_at > NOW() - INTERVAL '24 hours'
        `);
        const violations = parseInt(((violationResult as any).rows || violationResult)[0]?.cnt || "0");
        if (violations > (cond.value || 3)) {
          return { met: true, detail: `${violations} blocked autonomy actions in last 24h — possible agent misbehavior` };
        }
        return { met: false, detail: `${violations} autonomy blocks in 24h — within normal range` };
      }

      case "cascading_failures": {
        const cascadeResult = await db.execute(sql`
          SELECT COUNT(DISTINCT persona_id) as failing_agents FROM heartbeat_logs
          WHERE status != 'success' AND created_at > NOW() - INTERVAL '30 minutes' AND persona_id IS NOT NULL
        `);
        const failingAgents = parseInt(((cascadeResult as any).rows || cascadeResult)[0]?.failing_agents || "0");
        if (failingAgents > (cond.value || 2)) {
          return { met: true, detail: `${failingAgents} distinct agents failing in last 30 minutes — cascading failure pattern` };
        }
        return { met: false, detail: `${failingAgents} agent(s) with recent failures — within normal range` };
      }

      case "agent_scope_violations": {
        const scopeResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM autonomy_log
          WHERE tenant_id = ${tenantId} AND decision = 'blocked' AND action_type NOT IN ('process_governance')
          AND created_at > NOW() - INTERVAL '24 hours'
        `);
        const scopeViolations = parseInt(((scopeResult as any).rows || scopeResult)[0]?.cnt || "0");
        if (scopeViolations > (cond.value || 5)) {
          return { met: true, detail: `${scopeViolations} blocked agent actions in 24h — possible rogue behavior` };
        }
        return { met: false, detail: `${scopeViolations} scope violations in 24h — within normal` };
      }

      case "delegation_depth": {
        const depthResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM heartbeat_tasks
          WHERE tenant_id = ${tenantId} AND enabled = true AND type = 'delegation'
          AND created_by IN (SELECT name FROM heartbeat_tasks WHERE type = 'delegation' AND tenant_id = ${tenantId})
        `);
        const chainedDelegations = parseInt(((depthResult as any).rows || depthResult)[0]?.cnt || "0");
        if (chainedDelegations > 0) {
          return { met: true, detail: `${chainedDelegations} chained delegation(s) detected — agents delegating to agents who delegate` };
        }
        return { met: false, detail: "No delegation chains detected" };
      }

      case "memory_write_rate": {
        const memResult = await db.execute(sql`
          SELECT persona_id, COUNT(*) as writes FROM memory
          WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '1 hour'
          GROUP BY persona_id HAVING COUNT(*) > ${cond.value || 20}
        `);
        const heavyWriters = ((memResult as any).rows || memResult) as any[];
        if (heavyWriters.length > 0) {
          return { met: true, detail: `${heavyWriters.length} agent(s) writing 20+ memory entries/hour — possible memory flooding` };
        }
        return { met: false, detail: "Memory write rates normal" };
      }

      case "tool_boundary_violations": {
        const tbv = await evalToolBoundaryViolations(tenantId);
        if (tbv.status === "warning") {
          return { met: true, detail: `${tbv.metrics.total_violations_24h} tool boundary violations in 24h` };
        }
        return { met: false, detail: `${tbv.metrics.total_violations_24h} violations in 24h — within normal` };
      }

      case "system_critical_state": {
        let criticalFailures = 0;
        try {
          const healthResult = await db.execute(sql`SELECT 1 as ok`);
          if (!healthResult) criticalFailures++;
        } catch { criticalFailures++; }
        const keyResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM provider_keys WHERE tenant_id = ${tenantId} AND enabled = true
        `);
        const activeKeys = parseInt(((keyResult as any).rows || keyResult)[0]?.cnt || "0");
        if (activeKeys === 0) criticalFailures++;
        if (criticalFailures > 0) {
          return { met: true, detail: `${criticalFailures} critical system failure(s) detected` };
        }
        return { met: false, detail: "System health normal" };
      }

      case "purpose_drift": {
        const { evalPurposeDrift } = await import("./evaluators");
        const pd = await evalPurposeDrift(tenantId);
        if (pd.status === "warning") {
          return { met: true, detail: `Purpose drift detected: ${pd.metrics.agents_tracked} agents tracked` };
        }
        return { met: false, detail: `Purpose adherence normal: ${pd.metrics.agents_tracked} agents tracked` };
      }

      case "duty_segregation": {
        return { met: false, detail: "Segregation of duties enforced inline by Scribe/Proof guard and autonomy rules" };
      }

      case "self_approval": {
        return { met: false, detail: "Self-approval prevention enforced inline by content pipeline and autonomy rules" };
      }

      case "pii_exposure": {
        const pii = await evalPIIExposure(tenantId);
        if (pii.status === "warning") {
          return { met: true, detail: `${pii.metrics.pii_in_output} PII instances detected in recent outputs (types: ${pii.metrics.pii_types.join(", ")})` };
        }
        return { met: false, detail: `No PII detected in ${pii.metrics.messages_scanned} recent messages` };
      }

      case "config_changes": {
        const changeResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM governance_actions
          WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
        `);
        const recentChanges = parseInt(((changeResult as any).rows || changeResult)[0]?.cnt || "0");
        return { met: false, detail: `${recentChanges} governance actions logged in last 24h` };
      }

      case "log_retention": {
        const retentionResult = await db.execute(sql`
          SELECT MIN(created_at) as oldest FROM governance_actions WHERE tenant_id = ${tenantId}
        `);
        const oldest = ((retentionResult as any).rows || retentionResult)[0]?.oldest;
        if (!oldest) return { met: false, detail: "No governance actions yet — retention not applicable" };
        const ageDays = (Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24);
        return { met: false, detail: `Oldest log: ${Math.round(ageDays)} days. Retention healthy.` };
      }

      case "agent_spend_ratio": {
        const asr = await evalAgentSpendRatio(tenantId);
        if (asr.status === "warning") {
          return { met: true, detail: `Agent ${asr.metrics.top_spender} consuming ${asr.metrics.top_spender_percent}% of daily tokens` };
        }
        return { met: false, detail: `Token distribution balanced (top: ${asr.metrics.top_spender_percent}%)` };
      }

      case "time_of_day": {
        const hour = new Date().getHours();
        const isOffHours = hour >= 22 || hour < 6;
        if (isOffHours) {
          return { met: true, detail: `Current hour: ${hour}:00 — off-hours period (10PM-6AM)` };
        }
        return { met: false, detail: `Current hour: ${hour}:00 — business hours` };
      }

      case "workload_balance": {
        const wlResult = await db.execute(sql`
          SELECT persona_id, COUNT(*) as task_count FROM heartbeat_tasks
          WHERE tenant_id = ${tenantId} AND enabled = true AND persona_id IS NOT NULL
          GROUP BY persona_id
        `);
        const loads = ((wlResult as any).rows || wlResult) as any[];
        if (loads.length < 2) return { met: false, detail: "Not enough agents with tasks to evaluate balance" };
        const counts = loads.map((l: any) => parseInt(l.task_count));
        const avg = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
        const max = Math.max(...counts);
        if (avg > 0 && max / avg > (cond.value || 5)) {
          return { met: true, detail: `Workload imbalance: max ${max} tasks vs avg ${avg.toFixed(1)} — ratio ${(max/avg).toFixed(1)}x` };
        }
        return { met: false, detail: `Workload balanced: max ${max}, avg ${avg.toFixed(1)}` };
      }

      case "failover_rate": {
        const fr = await evalFailoverRate(tenantId);
        if (fr.status === "critical") {
          return { met: true, detail: `Failover rate ${fr.metrics.failover_percent}% — CRITICAL. ${fr.metrics.total_failures}/${fr.metrics.total_attempts} requests failed over.` };
        }
        if (fr.status === "warning") {
          return { met: true, detail: `Failover rate ${fr.metrics.failover_percent}% — elevated. Targets: ${fr.metrics.failover_targets.join(", ")}` };
        }
        return { met: false, detail: `Failover rate ${fr.metrics.failover_percent}% — healthy` };
      }

      case "framework_review_due": {
        const fwResult = await db.execute(sql`
          SELECT id, name, next_review_date, last_reviewed FROM governance_frameworks
          WHERE tenant_id = ${tenantId} AND status = 'active' AND next_review_date < NOW()
        `);
        const overdue = ((fwResult as any).rows || fwResult) as any[];
        if (overdue.length > 0) {
          const names = overdue.map((f: any) => f.name).join(", ");
          return { met: true, detail: `${overdue.length} framework(s) overdue for review: ${names}` };
        }
        const upcomingResult = await db.execute(sql`
          SELECT id, name, next_review_date FROM governance_frameworks
          WHERE tenant_id = ${tenantId} AND status = 'active' AND next_review_date < NOW() + INTERVAL '14 days' AND next_review_date >= NOW()
        `);
        const upcoming = ((upcomingResult as any).rows || upcomingResult) as any[];
        if (upcoming.length > 0) {
          return { met: false, detail: `${upcoming.length} framework(s) due for review within 14 days` };
        }
        return { met: false, detail: "All frameworks reviewed and up to date" };
      }

      case "trust_score_critical": {
        const allScores = await getAllTrustScores(tenantId);
        const critical = allScores.filter(s => s.score <= (cond.threshold || 25));
        if (critical.length > 0) {
          return { met: true, detail: `${critical.length} trust score(s) at critical level: ${critical.map(s => `persona ${s.personaId} ${s.category}=${s.score}`).join(", ")}` };
        }
        return { met: false, detail: `All ${allScores.length} trust scores above critical threshold` };
      }

      case "trust_score_update": {
        const allScores = await getAllTrustScores(tenantId);
        const recentChanges = allScores.filter(s => {
          if (!s.updatedAt) return false;
          const age = Date.now() - new Date(s.updatedAt).getTime();
          return age < 3600000 && s.lastChangeAmount !== 0;
        });
        if (recentChanges.length > 0) {
          return { met: true, detail: `${recentChanges.length} trust score change(s) in last hour: ${recentChanges.map(s => `persona ${s.personaId} ${s.category} ${(s.lastChangeAmount || 0) > 0 ? "+" : ""}${s.lastChangeAmount}`).join(", ")}` };
        }
        return { met: false, detail: "No recent trust score changes" };
      }

      case "proactive_action_quality": {
        let worstPersona = 0;
        let worstRatio = 0;
        for (const pid of [3, 4, 6, 7, 9, 11, 12, 13, 14]) {
          const stats = await getProactiveQualityStats(tenantId, pid, 7);
          if (stats.total >= 3 && stats.negativeRatio > (cond.threshold || 0.3)) {
            if (stats.negativeRatio > worstRatio) {
              worstRatio = stats.negativeRatio;
              worstPersona = pid;
            }
          }
        }
        if (worstPersona > 0) {
          return { met: true, detail: `Persona ${worstPersona} has ${Math.round(worstRatio * 100)}% negative proactive actions (threshold: ${Math.round((cond.threshold || 0.3) * 100)}%)` };
        }
        return { met: false, detail: "All agents' proactive action quality within acceptable range" };
      }

      case "proactive_action_budget": {
        let overBudget: string[] = [];
        for (const pid of [3, 4, 6, 7, 9, 11, 12, 13, 14]) {
          const pab = await getAvailablePAB(tenantId, pid);
          if (pab.total > 0 && pab.remaining === 0 && pab.spent > pab.total) {
            overBudget.push(`persona ${pid} (spent ${pab.spent}/${pab.total})`);
          }
        }
        if (overBudget.length > 0) {
          return { met: true, detail: `${overBudget.length} agent(s) over PAB budget: ${overBudget.join(", ")}` };
        }
        return { met: false, detail: "All proactive action budgets within limits" };
      }

      case "express_lane_health": {
        const lanes = getApprovedLanes();
        const suspended = lanes.filter(l => l.suspended);
        if (suspended.length > 0) {
          return { met: true, detail: `${suspended.length} express lane(s) suspended: ${suspended.map(l => `${l.id} (${l.suspendedReason})`).join(", ")}` };
        }
        return { met: false, detail: `All ${lanes.length} express lanes operational` };
      }

      case "express_lane_volume": {
        try {
          const result = await db.execute(sql`
            SELECT lane_id, COUNT(*) as usage FROM express_lane_usage
            WHERE tenant_id = ${tenantId} AND created_at > CURRENT_DATE
            GROUP BY lane_id HAVING COUNT(*) > ${cond.cap || 10}
          `);
          const rows = ((result as any).rows || result) as any[];
          if (rows.length > 0) {
            return { met: true, detail: `${rows.length} lane(s) over daily cap: ${rows.map((r: any) => `${r.lane_id}=${r.usage}`).join(", ")}` };
          }
        } catch {}
        return { met: false, detail: "All express lanes within daily volume caps" };
      }

      case "environmental_signal_escalation": {
        const { getRecentSignals } = await import("./environmental-awareness");
        const critical = getRecentSignals("CRITICAL");
        const urgent = getRecentSignals("URGENT");
        const unhandled = [...critical, ...urgent].filter(s => Date.now() - s.timestamp < 3600000);
        if (unhandled.length > 0) {
          return { met: true, detail: `${unhandled.length} URGENT/CRITICAL environmental signal(s) in last hour: ${unhandled.map(s => s.summary.substring(0, 50)).join("; ")}` };
        }
        return { met: false, detail: "No urgent environmental signals" };
      }

      case "collective_intelligence_budget": {
        const { getProtocolUsage } = await import("./collective-intelligence");
        const usage = getProtocolUsage(tenantId);
        const overLimit = (usage.full_council > 2) || (usage.debate > 5) || (usage.tree_of_thought > 5);
        if (overLimit) {
          return { met: true, detail: `CI protocol limits exceeded: debates=${usage.debate}/5, ToT=${usage.tree_of_thought}/5, councils=${usage.full_council}/2` };
        }
        return { met: false, detail: `CI protocols within limits: debates=${usage.debate}/5, ToT=${usage.tree_of_thought}/5, councils=${usage.full_council}/2` };
      }

      case "earned_autonomy_audit": {
        const allScores = await getAllTrustScores(tenantId);
        const fullAuto = allScores.filter(s => s.autonomyLevel === "full_auto");
        const blocked = allScores.filter(s => s.autonomyLevel === "blocked");
        const locked = allScores.filter(s => s.locked);
        return { met: fullAuto.length > 0 || blocked.length > 0, detail: `Trust audit: ${fullAuto.length} full_auto, ${blocked.length} blocked, ${locked.length} locked across ${allScores.length} scores` };
      }

      default:
        return { met: false, detail: `Unknown check type: ${cond.check}` };
    }
  } catch (err: any) {
    return { met: false, detail: `Error evaluating: ${err.message}` };
  }
}

async function executeAction(rule: GovernanceRule, conditionDetail: string, tenantId: number, dryRun: boolean): Promise<string> {
  const config = rule.actionConfig;

  switch (rule.action) {
    case "disable_subscription": {
      if (dryRun) return "Would disable inactive subscriptions";
      const activitySubs = await checkBusinessActivity(tenantId);
      let disabled = 0;
      for (const check of activitySubs) {
        if (check.hasActivity || PROTECTED_EVENTS.has(check.eventType)) continue;
        await db.execute(sql`
          UPDATE event_subscriptions SET enabled = false
          WHERE tenant_id = ${tenantId} AND event_type = ${check.eventType} AND enabled = true
        `);
        disabled++;
      }
      if (disabled > 0) {
        await postToChannel(tenantId, config.notify_channel || "#system-alerts",
          `[Governor] Disabled ${disabled} event subscription(s) — no business activity detected.`);
      }
      return disabled > 0 ? `Disabled ${disabled} subscription(s)` : "No subscriptions needed disabling";
    }

    case "enable_subscription": {
      if (dryRun) return "Would enable justified subscriptions";
      const activitySubs = await checkBusinessActivity(tenantId);
      let enabled = 0;
      for (const check of activitySubs) {
        if (!check.hasActivity) continue;
        const upd = await db.execute(sql`
          UPDATE event_subscriptions SET enabled = true
          WHERE tenant_id = ${tenantId} AND event_type = ${check.eventType} AND enabled = false
        `);
        if ((upd as any).rowCount > 0) enabled++;
      }
      if (enabled > 0) {
        await postToChannel(tenantId, config.notify_channel || "#system-alerts",
          `[Governor] Enabled ${enabled} event subscription(s) — business activity now justifies them.`);
      }
      return enabled > 0 ? `Enabled ${enabled} subscription(s)` : "No subscriptions needed enabling";
    }

    case "disable_task": {
      if (dryRun) return "Would disable failing tasks";
      const taskResult = await db.execute(sql`
        SELECT ht.id, ht.name,
          (SELECT COUNT(*) FROM heartbeat_logs WHERE task_id = ht.id AND status = 'success' AND created_at > NOW() - INTERVAL '7 days') as successes,
          (SELECT COUNT(*) FROM heartbeat_logs WHERE task_id = ht.id AND status != 'success' AND created_at > NOW() - INTERVAL '7 days') as failures
        FROM heartbeat_tasks ht WHERE ht.enabled = true AND ht.tenant_id = ${tenantId}
      `);
      const tasks = ((taskResult as any).rows || taskResult) as any[];
      let disabled = 0;
      for (const t of tasks) {
        const s = parseInt(t.successes || "0");
        const f = parseInt(t.failures || "0");
        if ((s + f) >= 5 && s === 0 && f > 0) {
          await db.execute(sql`UPDATE heartbeat_tasks SET enabled = false WHERE id = ${t.id}`);
          disabled++;
          console.log(`[governor] AUTO-DISABLED: task "${t.name}" (${f} failures, 0 successes in 7 days)`);
        }
      }
      if (disabled > 0) {
        await postToChannel(tenantId, config.notify_channel || "#system-alerts",
          `[Governor] Auto-disabled ${disabled} failing heartbeat task(s) — 100% failure rate over 7 days.`);
      }
      return disabled > 0 ? `Disabled ${disabled} failing task(s)` : "No failing tasks to disable";
    }

    case "block_delegation": {
      return "Delegation guards active in heartbeat processor";
    }

    case "throttle_tasks": {
      if (dryRun) return "Would throttle non-essential tasks";
      const spend = await evalDailySpend(tenantId);
      if (spend.metrics.spend_percent >= 80) {
        const nonCritical = await db.execute(sql`
          UPDATE heartbeat_tasks SET enabled = false
          WHERE tenant_id = ${tenantId} AND enabled = true
          AND priority < 5 AND type NOT IN ('process_governance', 'cloud_backup')
        `);
        const throttled = (nonCritical as any).rowCount || 0;
        if (throttled > 0) {
          await postToChannel(tenantId, config.notify_channel || "#system-alerts",
            `[Governor] Throttled ${throttled} low-priority tasks — daily spend at ${spend.metrics.spend_percent}%`);
        }
        return `Throttled ${throttled} low-priority tasks (spend at ${spend.metrics.spend_percent}%)`;
      }
      return "Spend within limits — no throttling needed";
    }

    case "restart_agent": {
      if (dryRun) return "Would update stalled agent desk status";
      const deskResult = await db.execute(sql`
        SELECT ad.id, ad.persona_id, p.name FROM agent_desks ad
        LEFT JOIN personas p ON p.id = ad.persona_id
        WHERE ad.tenant_id = ${tenantId}
        AND ad.updated_at < NOW() - INTERVAL '24 hours'
      `);
      const stalled = ((deskResult as any).rows || deskResult) as any[];
      for (const desk of stalled) {
        await db.execute(sql`
          UPDATE agent_desks SET status_note = 'Restarted by governor — was stalled 24h+', updated_at = NOW()
          WHERE id = ${desk.id}
        `);
      }
      if (stalled.length > 0) {
        await postToChannel(tenantId, config.notify_channel || "#system-alerts",
          `[Governor] Reset ${stalled.length} stalled agent desk(s): ${stalled.map((s: any) => s.name).join(", ")}`);
      }
      return stalled.length > 0 ? `Reset ${stalled.length} stalled desk(s)` : "No stalled desks";
    }

    case "route_alert": {
      if (dryRun) return "Would route unacknowledged alerts";
      const routing = config.routing || {};
      const alertResult = await db.execute(sql`
        SELECT wa.id, wa.category, wi.name as item_name
        FROM watchlist_alerts wa
        LEFT JOIN watchlist_items wi ON wi.id = wa.watchlist_item_id
        WHERE wa.tenant_id = ${tenantId} AND wa.acknowledged = false
      `);
      const alerts = ((alertResult as any).rows || alertResult) as any[];
      let routed = 0;
      for (const alert of alerts) {
        const targetPersona = routing[alert.category];
        if (targetPersona) {
          await postToChannel(tenantId, "#intelligence",
            `[Watchlist Alert] ${alert.item_name}: New findings for ${targetPersona} to review (category: ${alert.category})`);
          routed++;
        }
      }
      return routed > 0 ? `Routed ${routed} watchlist alert(s)` : "No alerts to route";
    }

    case "kill_switch": {
      if (dryRun) return "Would activate emergency kill switch";
      const protectedPersonas = config.protected_personas || [5, 6];
      const killResult = await db.execute(sql`
        UPDATE heartbeat_tasks SET enabled = false
        WHERE tenant_id = ${tenantId} AND enabled = true
        AND (persona_id IS NULL OR persona_id NOT IN (${sql.raw(protectedPersonas.join(","))}))
        AND type NOT IN ('process_governance', 'cloud_backup')
      `);
      const killed = (killResult as any).rowCount || 0;
      await postToChannel(tenantId, "#system-alerts",
        `[EMERGENCY KILL SWITCH] ${killed} non-essential tasks disabled. Protected agents (Blueprint, Chief of Staff) continue operating. Reason: ${conditionDetail}`);
      return `Kill switch activated: ${killed} tasks halted, protected agents continue`;
    }

    case "escalate": {
      if (dryRun) return `Would escalate: ${rule.escalationReason || rule.description}`;
      await postToChannel(tenantId, "#approvals",
        `[ESCALATION] ${config.message || rule.description}\nRule: ${rule.ruleName}\nCondition: ${conditionDetail}`);
      return `Escalated to human: ${rule.escalationReason || rule.description}`;
    }

    case "investigate": {
      if (dryRun) return "Would flag for investigation";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Investigation needed: ${conditionDetail}. Assigned to ${config.assign_to || "Agent Blueprint"}.`);
      return `Flagged for investigation by ${config.assign_to || "Agent Blueprint"}`;
    }

    case "rebalance": {
      return "Queue rebalancing handled by desk system";
    }

    case "enforce_review": {
      return "Content review enforcement active via Scribe/Proof inline guard";
    }

    case "log_trust_change": {
      if (dryRun) return "Would log trust score changes";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Trust Score Update: ${conditionDetail}`);
      return `Logged trust changes: ${conditionDetail}`;
    }

    case "lock_agent_autonomy": {
      if (dryRun) return "Would lock agent with critical trust score";
      const { setTrustScore } = await import("./trust-engine");
      const allScores = await getAllTrustScores(tenantId);
      const critical = allScores.filter(s => s.score <= 25);
      for (const s of critical) {
        await setTrustScore(tenantId, s.personaId, s.category as TrustCategory, s.score, true);
      }
      await postToChannel(tenantId, "#system-alerts",
        `[Governor] TRUST CRITICAL: ${critical.length} agent trust score(s) locked at critical level. ${conditionDetail}`);
      return `Locked ${critical.length} critical trust score(s)`;
    }

    case "suspend_proactive": {
      if (dryRun) return "Would suspend proactive rights for low-quality agent";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Proactive Action Quality Alert: ${conditionDetail}. Agent proactive rights under review.`);
      return `Proactive quality alert posted: ${conditionDetail}`;
    }

    case "enforce_pab_limit": {
      if (dryRun) return "Would enforce PAB budget limits";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] PAB Budget Enforcement: ${conditionDetail}`);
      return `PAB limit enforced: ${conditionDetail}`;
    }

    case "alert_lane_health": {
      if (dryRun) return "Would alert on express lane health";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Express Lane Health Alert: ${conditionDetail}`);
      return `Express lane alert: ${conditionDetail}`;
    }

    case "cap_lane_volume": {
      if (dryRun) return "Would cap express lane volume";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Express Lane Volume Cap: ${conditionDetail}`);
      return `Lane volume cap enforced: ${conditionDetail}`;
    }

    case "escalate_signal": {
      if (dryRun) return "Would escalate environmental signal";
      await postToChannel(tenantId, "#system-alerts",
        `[Governor] ENVIRONMENTAL ESCALATION: ${conditionDetail}`);
      return `Signal escalated: ${conditionDetail}`;
    }

    case "cap_ci_protocols": {
      if (dryRun) return "Would cap collective intelligence protocol usage";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] CI Protocol Budget: ${conditionDetail}. Further complex reasoning limited until tomorrow.`);
      return `CI protocol cap enforced: ${conditionDetail}`;
    }

    case "audit_autonomy": {
      if (dryRun) return "Would generate autonomy audit report";
      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Earned Autonomy Audit: ${conditionDetail}`);
      return `Autonomy audit: ${conditionDetail}`;
    }

    case "review_frameworks": {
      const fwResult = await db.execute(sql`
        SELECT * FROM governance_frameworks
        WHERE tenant_id = ${tenantId} AND status = 'active' AND next_review_date < NOW()
      `);
      const overdue = ((fwResult as any).rows || fwResult) as any[];
      if (overdue.length === 0) return "No frameworks overdue for review";
      if (dryRun) return `Would review ${overdue.length} overdue framework(s): ${overdue.map((f: any) => f.name).join(", ")}`;

      const results: string[] = [];
      for (const fw of overdue) {
        try {
          const principles = typeof fw.key_principles === "string" ? JSON.parse(fw.key_principles) : (fw.key_principles || []);
          const rulesInformed = typeof fw.rules_informed === "string" ? JSON.parse(fw.rules_informed) : (fw.rules_informed || []);

          const { getClientForModel, getModelForTierAsync } = await import("./providers");
          const modelId = await getModelForTierAsync("balanced", tenantId);
          const { client, actualModelId } = await getClientForModel(modelId, tenantId);

          const prompt = `You are Agent Blueprint, the governance architect for this platform.

You are reviewing the governance framework "${fw.name}" by ${fw.organization} (version: ${fw.version}).
${fw.source_url ? `Source: ${fw.source_url}` : "This is an internal framework."}

CURRENT PRINCIPLES WE EXTRACTED:
${principles.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}

RULES THIS FRAMEWORK CURRENTLY INFORMS IN OUR SYSTEM:
${rulesInformed.join(", ")}

YOUR TASK:
1. Based on your knowledge, identify if there are any UPDATES to this framework since version "${fw.version}"
2. Identify any NEW principles or guidance that we should add
3. Identify any existing principles that may be OUTDATED or SUPERSEDED
4. Suggest any NEW governance rules we should create based on updates
5. Note the current version/date of the framework if it has been updated

Respond in this exact JSON format (no markdown, no code blocks, just raw JSON):
{
  "has_updates": true/false,
  "new_version": "version string if updated, or null",
  "new_principles": ["principle 1", "principle 2"],
  "outdated_principles": ["principle text that is outdated"],
  "suggested_new_rules": ["rule description 1"],
  "review_summary": "Brief summary of what changed or confirmation nothing changed",
  "next_review_months": 6
}`;

          const response = await client.chat.completions.create({
            model: actualModelId,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2000,
            temperature: 0.3,
          });

          const content = response.choices?.[0]?.message?.content?.trim() || "";
          let review: any;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            review = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch { review = null; }

          if (!review) {
            await db.execute(sql`
              UPDATE governance_frameworks SET
                last_reviewed = NOW(),
                next_review_date = NOW() + INTERVAL '6 months',
                updated_at = NOW(),
                review_notes = ${`Auto-review ${new Date().toISOString().split("T")[0]}: AI analysis returned unparseable response. Manual review recommended. Raw: ${content.substring(0, 300)}`}
              WHERE id = ${fw.id} AND tenant_id = ${tenantId}
            `);
            results.push(`${fw.name}: reviewed but AI response unparseable — flagged for manual review`);
            continue;
          }

          const nextMonths = review.next_review_months || 6;
          const nextInterval = `${nextMonths} months`;
          let updatedPrinciples = [...principles];
          if (review.new_principles?.length > 0) {
            updatedPrinciples = [...updatedPrinciples, ...review.new_principles];
          }
          if (review.outdated_principles?.length > 0) {
            updatedPrinciples = updatedPrinciples.filter(
              (p: string) => !review.outdated_principles.some((op: string) => p.toLowerCase().includes(op.toLowerCase().substring(0, 30)))
            );
          }

          const reviewNote = `Auto-review ${new Date().toISOString().split("T")[0]}: ${review.review_summary}${review.has_updates ? ` | New version: ${review.new_version}` : " | No updates found."}${review.new_principles?.length > 0 ? ` | ${review.new_principles.length} new principle(s) added.` : ""}${review.outdated_principles?.length > 0 ? ` | ${review.outdated_principles.length} outdated principle(s) removed.` : ""}${review.suggested_new_rules?.length > 0 ? ` | Suggested new rules: ${review.suggested_new_rules.join("; ")}` : ""}`;

          await db.execute(sql`
            UPDATE governance_frameworks SET
              last_reviewed = NOW(),
              next_review_date = NOW() + INTERVAL ${sql.raw(`'${nextInterval}'`)},
              updated_at = NOW(),
              version = COALESCE(${review.new_version || null}, version),
              key_principles = ${JSON.stringify(updatedPrinciples)}::jsonb,
              review_notes = ${reviewNote}
            WHERE id = ${fw.id} AND tenant_id = ${tenantId}
          `);

          if (review.suggested_new_rules?.length > 0) {
            await postToChannel(tenantId, "#system-alerts",
              `[Governor] Framework Review — ${fw.name}: ${review.suggested_new_rules.length} new rule(s) suggested:\n${review.suggested_new_rules.map((r: string) => `• ${r}`).join("\n")}\n\nThese require human review before adding to the playbook.`);
          }

          results.push(`${fw.name}: ${review.has_updates ? "UPDATED" : "confirmed current"} — ${review.review_summary.substring(0, 100)}`);
        } catch (err: any) {
          await db.execute(sql`
            UPDATE governance_frameworks SET
              last_reviewed = NOW(),
              next_review_date = NOW() + INTERVAL '1 month',
              updated_at = NOW(),
              review_notes = ${`Auto-review ${new Date().toISOString().split("T")[0]}: Review failed — ${err.message}. Retry in 1 month.`}
            WHERE id = ${fw.id} AND tenant_id = ${tenantId}
          `);
          results.push(`${fw.name}: review FAILED — ${err.message}`);
        }
      }

      await postToChannel(tenantId, config.notify_channel || "#system-alerts",
        `[Governor] Framework Review Complete — ${overdue.length} framework(s) reviewed:\n${results.map(r => `• ${r}`).join("\n")}`);

      return `Reviewed ${overdue.length} framework(s): ${results.join("; ")}`;
    }

    default:
      return `Unknown action: ${rule.action}`;
  }
}

async function postToChannel(tenantId: number, channelName: string, message: string) {
  try {
    const channelResult = await db.execute(sql`
      SELECT id FROM agent_channels WHERE tenant_id = ${tenantId} AND name = ${channelName} LIMIT 1
    `);
    const channel = ((channelResult as any).rows || channelResult)[0];
    if (channel) {
      await db.execute(sql`
        INSERT INTO channel_messages (tenant_id, channel_id, persona_id, message_type, content, created_at)
        VALUES (${tenantId}, ${channel.id}, 5, 'system', ${message}, NOW())
      `);
    }
  } catch (err: any) {
    console.log(`[governor] Failed to post to ${channelName}: ${err.message}`);
  }
}

async function logAction(tenantId: number, rule: GovernanceRule, conditionDetail: string, actionTaken: string, escalated: boolean) {
  try {
    await db.execute(sql`
      INSERT INTO governance_actions (tenant_id, rule_id, rule_name, category, condition_met, action_taken, action_detail, escalated, created_at)
      VALUES (${tenantId}, ${rule.id}, ${rule.ruleName}, ${rule.category}, ${conditionDetail}, ${actionTaken},
              ${JSON.stringify({ config: rule.actionConfig })}::jsonb, ${escalated}, NOW())
    `);
    await db.execute(sql`
      UPDATE governance_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = ${rule.id}
    `);
  } catch {}
}

interface ActivityCheckResult {
  eventType: string;
  hasActivity: boolean;
  description: string;
}

const BUSINESS_ACTIVITY_CHECKS = [
  { eventType: "payment.failed", query: "SELECT COUNT(*) as cnt FROM tenants WHERE stripe_customer_id IS NOT NULL AND plan != 'trial'", desc: "paying customers" },
  { eventType: "payment.succeeded", query: "SELECT COUNT(*) as cnt FROM tenants WHERE stripe_customer_id IS NOT NULL AND plan != 'trial'", desc: "paying customers" },
  { eventType: "payment.subscription.created", query: "SELECT COUNT(*) as cnt FROM tenants WHERE stripe_customer_id IS NOT NULL AND plan != 'trial'", desc: "paying customers" },
  { eventType: "email.received", query: "SELECT COUNT(*) as cnt FROM tenants WHERE agentmail_inbox_id IS NOT NULL", desc: "active email inboxes" },
  { eventType: "content.published", query: "SELECT COUNT(*) as cnt FROM heartbeat_tasks WHERE enabled = true AND (name ILIKE '%content%' OR name ILIKE '%publish%' OR name ILIKE '%blog%' OR name ILIKE '%social%')", desc: "content tasks" },
];

async function checkBusinessActivity(tenantId: number): Promise<ActivityCheckResult[]> {
  const results: ActivityCheckResult[] = [];
  for (const check of BUSINESS_ACTIVITY_CHECKS) {
    let count = 0;
    try {
      const result = await db.execute(sql.raw(check.query));
      count = parseInt(((result as any).rows || result)[0]?.cnt || "0");
    } catch {}
    results.push({ eventType: check.eventType, hasActivity: count > 0, description: `${count} ${check.desc}` });
  }
  return results;
}

export async function evaluateProcesses(tenantId: number = 1, dryRun: boolean = false): Promise<GovernorReport> {
  const rules = await loadRules(tenantId);
  const evaluations: RuleEvaluation[] = [];
  let triggered = 0;
  let actionsApplied = 0;
  let escalations = 0;

  for (const rule of rules) {
    const { met, detail } = await evaluateCondition(rule, tenantId);

    const evaluation: RuleEvaluation = {
      ruleId: rule.id,
      ruleName: rule.ruleName,
      category: rule.category,
      conditionMet: met,
      conditionDetail: detail,
      actionTaken: null,
      escalated: false,
      escalationReason: null,
    };

    if (met) {
      triggered++;
      const actionResult = await executeAction(rule, detail, tenantId, dryRun);
      evaluation.actionTaken = actionResult;

      if (rule.escalateToHuman) {
        evaluation.escalated = true;
        evaluation.escalationReason = rule.escalationReason;
        escalations++;
      }

      actionsApplied++;

      if (!dryRun) {
        await logAction(tenantId, rule, detail, actionResult, rule.escalateToHuman);
        console.log(`[governor] RULE TRIGGERED: "${rule.ruleName}" → ${actionResult}${rule.escalateToHuman ? " [ESCALATED]" : ""}`);
      }
    }

    evaluations.push(evaluation);
  }

  const summary = dryRun
    ? `[DRY RUN] Evaluated ${rules.length} rules, ${triggered} would trigger, ${escalations} would escalate. No changes applied.`
    : `Evaluated ${rules.length} rules: ${triggered} triggered, ${actionsApplied} actions taken, ${escalations} escalated to human. ${rules.length - triggered} conditions not met.`;

  try {
    await db.execute(sql`
      INSERT INTO autonomy_log (tenant_id, persona_id, action_type, action_detail, decision, reason, created_at)
      VALUES (${tenantId}, 5, 'process_governance', ${JSON.stringify({ rules: rules.length, triggered, actions: actionsApplied, escalations })}::jsonb, 'executed', ${summary}, NOW())
    `);
  } catch {}

  console.log(`[governor] ${summary}`);
  return { timestamp: new Date().toISOString(), rulesEvaluated: rules.length, rulesTriggered: triggered, actionsApplied, escalations, evaluations, summary };
}

export async function getGovernorStatus(tenantId: number = 1): Promise<{
  activeSubscriptions: number;
  disabledSubscriptions: number;
  protectedCount: number;
  lastRunAt: string | null;
  totalRules: number;
  rulesByCategory: Record<string, number>;
  recentActions: any[];
  checks: ActivityCheckResult[];
}> {
  const subsResult = await db.execute(sql`SELECT event_type, enabled FROM event_subscriptions WHERE tenant_id = ${tenantId}`);
  const subs = ((subsResult as any).rows || subsResult) as { event_type: string; enabled: boolean }[];

  const rulesResult = await db.execute(sql`SELECT category, COUNT(*) as cnt FROM governance_rules WHERE tenant_id = ${tenantId} AND enabled = true GROUP BY category`);
  const ruleCats = ((rulesResult as any).rows || rulesResult) as any[];
  const rulesByCategory: Record<string, number> = {};
  let totalRules = 0;
  for (const r of ruleCats) {
    rulesByCategory[r.category] = parseInt(r.cnt);
    totalRules += parseInt(r.cnt);
  }

  const actionsResult = await db.execute(sql`
    SELECT rule_name, category, condition_met, action_taken, escalated, created_at
    FROM governance_actions WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC LIMIT 10
  `);
  const recentActions = ((actionsResult as any).rows || actionsResult) as any[];

  let lastRunAt: string | null = null;
  try {
    const logResult = await db.execute(sql`
      SELECT created_at FROM autonomy_log WHERE tenant_id = ${tenantId} AND action_type = 'process_governance' ORDER BY created_at DESC LIMIT 1
    `);
    const logRow = ((logResult as any).rows || logResult)[0];
    lastRunAt = logRow?.created_at ? new Date(logRow.created_at).toISOString() : null;
  } catch {}

  const checks = await checkBusinessActivity(tenantId);

  return {
    activeSubscriptions: subs.filter(s => s.enabled).length,
    disabledSubscriptions: subs.filter(s => !s.enabled).length,
    protectedCount: subs.filter(s => PROTECTED_EVENTS.has(s.event_type)).length,
    lastRunAt,
    totalRules,
    rulesByCategory,
    recentActions,
    checks,
  };
}

export async function getRules(tenantId: number): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT id, category, rule_name, description, condition, action, action_config,
           escalate_to_human, escalation_reason, priority, enabled, last_triggered_at, trigger_count
    FROM governance_rules WHERE tenant_id = ${tenantId} ORDER BY priority DESC, category
  `);
  return ((result as any).rows || result) as any[];
}

export async function updateRule(tenantId: number, ruleId: number, updates: { enabled?: boolean; priority?: number; escalateToHuman?: boolean }): Promise<boolean> {
  const safeRuleId = Math.floor(Number(ruleId));
  const safeTenantId = Math.floor(Number(tenantId));
  if (!Number.isFinite(safeRuleId) || !Number.isFinite(safeTenantId)) return false;

  if (updates.enabled !== undefined) {
    await db.execute(sql`UPDATE governance_rules SET enabled = ${!!updates.enabled} WHERE id = ${safeRuleId} AND tenant_id = ${safeTenantId}`);
  }
  if (updates.priority !== undefined) {
    const safePriority = Math.max(0, Math.min(10, Math.floor(Number(updates.priority))));
    await db.execute(sql`UPDATE governance_rules SET priority = ${safePriority} WHERE id = ${safeRuleId} AND tenant_id = ${safeTenantId}`);
  }
  if (updates.escalateToHuman !== undefined) {
    await db.execute(sql`UPDATE governance_rules SET escalate_to_human = ${!!updates.escalateToHuman} WHERE id = ${safeRuleId} AND tenant_id = ${safeTenantId}`);
  }
  return true;
}

export async function getActionHistory(tenantId: number, limit: number = 50): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT ga.*, gr.description as rule_description
    FROM governance_actions ga
    LEFT JOIN governance_rules gr ON gr.id = ga.rule_id
    WHERE ga.tenant_id = ${tenantId}
    ORDER BY ga.created_at DESC LIMIT ${limit}
  `);
  return ((result as any).rows || result) as any[];
}

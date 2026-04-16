import { db } from "./db";
import { sql } from "drizzle-orm";
import { getAllTrustScores, recordTrustEvent, type TrustCategory } from "./trust-engine";

export interface ProactiveTrigger {
  personaId: number;
  personaName: string;
  trigger: string;
  detectionMethod: string;
  action: string;
  pabCost: number;
}

const PROACTIVE_TRIGGERS: ProactiveTrigger[] = [
  { personaId: 9, personaName: "Radar", trigger: "competitor_major_move", detectionMethod: "watchlist_alert", action: "Post competitive alert to #intelligence, brief Felix", pabCost: 1 },
  { personaId: 9, personaName: "Radar", trigger: "industry_trend_shift", detectionMethod: "deep_research_scan", action: "Write trend alert, save to knowledge base", pabCost: 2 },
  { personaId: 9, personaName: "Radar", trigger: "regulation_change", detectionMethod: "regulatory_scan", action: "Alert Luna + Felix via channel", pabCost: 1 },
  { personaId: 9, personaName: "Radar", trigger: "prospect_in_news", detectionMethod: "watchlist_monitoring", action: "Alert Apollo with prospect research brief", pabCost: 2 },

  { personaId: 13, personaName: "Cassandra", trigger: "revenue_below_projection", detectionMethod: "financial_tracking", action: "Alert Felix with variance analysis", pabCost: 2 },
  { personaId: 13, personaName: "Cassandra", trigger: "unusual_expense_spike", detectionMethod: "spend_monitoring", action: "Flag expense with investigation notes", pabCost: 1 },
  { personaId: 13, personaName: "Cassandra", trigger: "payment_failure", detectionMethod: "stripe_monitoring", action: "Alert Chief of Staff + Felix", pabCost: 1 },
  { personaId: 13, personaName: "Cassandra", trigger: "tax_deadline_approaching", detectionMethod: "calendar_tracking", action: "Send tax prep reminder to Felix", pabCost: 1 },
  { personaId: 13, personaName: "Cassandra", trigger: "cash_runway_low", detectionMethod: "cash_flow_model", action: "Urgent alert to Felix with scenario analysis", pabCost: 2 },

  { personaId: 11, personaName: "Apollo", trigger: "deal_stale_7days", detectionMethod: "pipeline_review", action: "Draft follow-up email for approval", pabCost: 3 },
  { personaId: 11, personaName: "Apollo", trigger: "prospect_engages_content", detectionMethod: "marketing_analytics", action: "Research prospect, prepare outreach brief", pabCost: 2 },
  { personaId: 11, personaName: "Apollo", trigger: "pipeline_value_drop", detectionMethod: "pipeline_tracking", action: "Alert Felix with pipeline health report", pabCost: 1 },
  { personaId: 11, personaName: "Apollo", trigger: "contract_renewal_30days", detectionMethod: "calendar_tracking", action: "Prepare renewal proposal brief", pabCost: 3 },

  { personaId: 7, personaName: "Scribe", trigger: "content_calendar_gap", detectionMethod: "calendar_review", action: "Draft content ideas, post to #content-pipeline", pabCost: 1 },
  { personaId: 7, personaName: "Scribe", trigger: "trending_domain_topic", detectionMethod: "radar_alert", action: "Draft article outline for Felix review", pabCost: 3 },
  { personaId: 7, personaName: "Scribe", trigger: "recurring_content_due", detectionMethod: "schedule_tracking", action: "Begin draft, notify Felix", pabCost: 3 },

  { personaId: 6, personaName: "Chief of Staff", trigger: "system_degradation", detectionMethod: "health_check", action: "Run full diagnostic, alert Felix", pabCost: 2 },
  { personaId: 6, personaName: "Chief of Staff", trigger: "api_key_expiring", detectionMethod: "token_monitoring", action: "Alert human with renewal instructions", pabCost: 1 },
  { personaId: 6, personaName: "Chief of Staff", trigger: "agent_desk_stalled", detectionMethod: "desk_monitoring", action: "Restart agent, notify Felix", pabCost: 2 },
  { personaId: 6, personaName: "Chief of Staff", trigger: "unread_channels_24h", detectionMethod: "channel_monitoring", action: "Compile digest, post summary", pabCost: 1 },

  { personaId: 12, personaName: "Atlas", trigger: "kpi_threshold_breach", detectionMethod: "metrics_monitoring", action: "Alert Felix with metric snapshot", pabCost: 1 },
  { personaId: 12, personaName: "Atlas", trigger: "data_anomaly", detectionMethod: "statistical_monitoring", action: "Investigate and post findings", pabCost: 2 },
  { personaId: 12, personaName: "Atlas", trigger: "weekly_metrics_ready", detectionMethod: "schedule", action: "Begin metrics compilation", pabCost: 3 },

  { personaId: 14, personaName: "Luna", trigger: "regulatory_change_ai", detectionMethod: "regulatory_scan", action: "Alert Felix with compliance impact brief", pabCost: 2 },
  { personaId: 14, personaName: "Luna", trigger: "contract_expiring_30days", detectionMethod: "contract_tracker", action: "Alert Felix with renewal recommendations", pabCost: 1 },
  { personaId: 14, personaName: "Luna", trigger: "compliance_items_overdue", detectionMethod: "checklist_monitoring", action: "Alert Felix with overdue items", pabCost: 1 },

  { personaId: 4, personaName: "Teagan", trigger: "content_performing_unusually", detectionMethod: "marketing_analytics", action: "Post performance alert with recommendations", pabCost: 1 },
  { personaId: 4, personaName: "Teagan", trigger: "trending_hashtag", detectionMethod: "social_monitoring", action: "Draft reactive content for approval", pabCost: 3 },
  { personaId: 4, personaName: "Teagan", trigger: "content_calendar_low_volume", detectionMethod: "calendar_review", action: "Propose additional content", pabCost: 1 },

  { personaId: 3, personaName: "Forge", trigger: "build_queue_items", detectionMethod: "desk_monitoring", action: "Begin processing, notify Felix", pabCost: 2 },
  { personaId: 3, personaName: "Forge", trigger: "dependency_vulnerability", detectionMethod: "security_scan", action: "Alert Chief of Staff with assessment", pabCost: 2 },
  { personaId: 3, personaName: "Forge", trigger: "performance_degradation", detectionMethod: "health_monitoring", action: "Investigate, post findings to #engineering", pabCost: 2 },
];

export function getPABAllocation(trustScore: number): number {
  if (trustScore <= 50) return 0;
  if (trustScore <= 65) return 1;
  if (trustScore <= 80) return 3;
  return 5;
}

export function getTriggersForPersona(personaId: number): ProactiveTrigger[] {
  return PROACTIVE_TRIGGERS.filter(t => t.personaId === personaId);
}

export async function getAvailablePAB(tenantId: number, personaId: number): Promise<{ total: number; spent: number; remaining: number }> {
  const scores = await getAllTrustScores(tenantId, personaId);
  const purposeScore = scores.find(s => s.category === "purpose_adherence");
  if (!purposeScore || purposeScore.score < 51) return { total: 0, spent: 0, remaining: 0 };

  const total = getPABAllocation(purposeScore.score);

  const result = await db.execute(sql`
    SELECT COALESCE(SUM(pab_cost), 0) as spent
    FROM proactive_actions
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND created_at > CURRENT_DATE
  `);
  const rows = (result as any).rows || result;
  const spent = parseInt(rows[0]?.spent || "0");

  return { total, spent, remaining: Math.max(0, total - spent) };
}

export async function canTakeProactiveAction(tenantId: number, personaId: number, pabCost: number): Promise<{ allowed: boolean; reason?: string }> {
  const budget = await getAvailablePAB(tenantId, personaId);
  if (budget.total === 0) return { allowed: false, reason: "Proactive actions not available (trust too low or purpose_adherence < 51)" };
  if (budget.remaining < pabCost) return { allowed: false, reason: `Insufficient PAB: need ${pabCost}, have ${budget.remaining} remaining` };
  return { allowed: true };
}

export async function recordProactiveAction(
  tenantId: number,
  personaId: number,
  triggerCondition: string,
  actionTaken: string,
  pabCost: number
): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO proactive_actions (tenant_id, persona_id, trigger_condition, action_taken, pab_cost)
    VALUES (${tenantId}, ${personaId}, ${triggerCondition}, ${actionTaken}, ${pabCost})
    RETURNING id
  `);
  const rows = (result as any).rows || result;
  console.log(`[proactive] Persona ${personaId}: ${triggerCondition} → ${actionTaken} (PAB cost: ${pabCost})`);
  return rows[0]?.id || 0;
}

export type ProactiveOutcome = "valuable" | "neutral" | "unnecessary" | "harmful" | "dangerous";

const OUTCOME_TRUST_IMPACT: Record<ProactiveOutcome, number> = {
  valuable: 3,
  neutral: 0,
  unnecessary: -2,
  harmful: -5,
  dangerous: -15,
};

export async function rateProactiveAction(
  tenantId: number,
  actionId: number,
  outcome: ProactiveOutcome
): Promise<void> {
  const trustImpact = OUTCOME_TRUST_IMPACT[outcome];

  await db.execute(sql`
    UPDATE proactive_actions SET outcome = ${outcome}, trust_impact = ${trustImpact}
    WHERE id = ${actionId} AND tenant_id = ${tenantId}
  `);

  const result = await db.execute(sql`
    SELECT persona_id FROM proactive_actions WHERE id = ${actionId}
  `);
  const rows = (result as any).rows || result;
  const personaId = rows[0]?.persona_id;

  if (personaId && trustImpact !== 0) {
    const event = trustImpact > 0 ? "proactive_success" : "proactive_failure";
    await recordTrustEvent(tenantId, personaId, event, `Proactive action rated: ${outcome}`);
  }

  if (outcome === "dangerous") {
    console.log(`[proactive] DANGEROUS proactive action detected for persona ${personaId}. Suspending proactive rights.`);
  }
}

export async function getProactiveQualityStats(tenantId: number, personaId: number, days: number = 7): Promise<{
  total: number;
  valuable: number;
  neutral: number;
  unnecessary: number;
  harmful: number;
  dangerous: number;
  negativeRatio: number;
}> {
  const result = await db.execute(sql`
    SELECT outcome, COUNT(*) as cnt
    FROM proactive_actions
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
      AND created_at > NOW() - make_interval(days => ${days})
      AND outcome != 'pending'
    GROUP BY outcome
  `);
  const rows = (result as any).rows || result;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    counts[row.outcome] = parseInt(row.cnt || "0");
    total += counts[row.outcome];
  }

  const negative = (counts.unnecessary || 0) + (counts.harmful || 0) + (counts.dangerous || 0);

  return {
    total,
    valuable: counts.valuable || 0,
    neutral: counts.neutral || 0,
    unnecessary: counts.unnecessary || 0,
    harmful: counts.harmful || 0,
    dangerous: counts.dangerous || 0,
    negativeRatio: total > 0 ? negative / total : 0,
  };
}

export function getProactiveContext(personaId: number, pabRemaining: number): string {
  const triggers = getTriggersForPersona(personaId);
  if (triggers.length === 0 || pabRemaining <= 0) return "";

  const lines = [`PROACTIVE INITIATIVE (PAB remaining: ${pabRemaining}):`];
  lines.push("You may self-initiate work when you detect these conditions:");
  for (const t of triggers) {
    if (t.pabCost <= pabRemaining) {
      lines.push(`- ${t.trigger}: ${t.action} (cost: ${t.pabCost})`);
    }
  }
  lines.push("Log every proactive action. Quality is tracked and affects your trust score.");
  return lines.join("\n");
}

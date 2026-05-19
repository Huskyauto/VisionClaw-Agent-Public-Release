import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SalienceInput {
  eventType: string;
  source: string;
  data: any;
  tenantId: number;
}

export interface SalienceResult {
  score: number;
  meta: {
    weights: Record<string, number>;
    revenueAtRiskUsd: number;
    novel: boolean;
    customerFacing: boolean;
    uncertainty: number;
    rule: string;
    computedAt: string;
  };
}

// Events where dollar amounts in the payload represent revenue *at risk* (loss
// or block), not successfully booked revenue. payment.succeeded is excluded on
// purpose so a big legitimate sale doesn't wake the owner at 3am.
const REVENUE_AT_RISK_TYPES = new Set([
  "delivery.failed",
  "delivery.stuck",
  "payment.failed",
  "research.cost.regression",
  "agent.budget.exceeded",
  "agent.budget.warning",
]);

// Events that, by definition, mean something is wrong and the owner should be
// woken on first occurrence regardless of the revenue heuristic. Score is
// floored to 75 for these. Cooldown in owner-notify still prevents email spam.
const MUST_WAKE_TYPES = new Set([
  "delivery.failed",
  "delivery.stuck",
  "payment.failed",
  "research.experiment.failed",
  "research.cost.regression",
  "agent.budget.exceeded",
  "agent.escalation",
  "system.health.degraded",
  // Felix is the sole decision maker; every new plan must reach him.
  "plan.proposed",
]);
const MUST_WAKE_FLOOR = 75;

const CUSTOMER_FACING_TYPES = new Set([
  "delivery.failed",
  "delivery.stuck",
  "delivery.completed",
  "payment.failed",
  "payment.succeeded",
  "email.received",
  "email.bounced",
]);

function pickRevenueAtRisk(eventType: string, data: any): number {
  // Explicit at-risk amount always wins — any publisher can attribute precisely.
  if (typeof data?.revenueImpactUsd === "number") return data.revenueImpactUsd;
  // Otherwise, only treat amountUsd/priceUsd as "at risk" for events that
  // represent a loss or block. A successful payment of $1000 is NOT at risk.
  if (REVENUE_AT_RISK_TYPES.has(eventType)) {
    if (typeof data?.amountUsd === "number") return data.amountUsd;
    if (typeof data?.priceUsd === "number") return data.priceUsd;
    // Sensible defaults per event type when payload carries no amount.
    if (eventType === "delivery.failed" || eventType === "delivery.stuck" || eventType === "payment.failed") return 49;
    if (eventType === "research.cost.regression") return 100;
    if (eventType === "agent.budget.exceeded") return 25;
    if (eventType === "agent.budget.warning") return 10;
  }
  return 0;
}

async function isNovelInLast24h(eventType: string, tenantId: number): Promise<boolean> {
  const r: any = await db.execute(sql`
    SELECT 1 FROM event_log
    WHERE tenant_id = ${tenantId}
      AND event_type = ${eventType}
      AND created_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `);
  const rows = r.rows || r;
  return rows.length === 0;
}

export async function scoreEvent(input: SalienceInput): Promise<SalienceResult> {
  const { eventType, data, tenantId } = input;

  const revenueAtRiskUsd = pickRevenueAtRisk(eventType, data);
  const revenuePts = Math.min(40, (revenueAtRiskUsd / 1000) * 40);

  const novel = await isNovelInLast24h(eventType, tenantId);
  const noveltyPts = novel ? 20 : 0;

  // Time-decay: events created right now are at full weight.
  // For real-time emitEvent calls this is always full.
  const timePts = 15;

  const customerFacing = CUSTOMER_FACING_TYPES.has(eventType);
  const customerPts = customerFacing ? 15 : 0;

  const uncertainty = typeof data?.agentConfidence === "number"
    ? Math.max(0, 1 - data.agentConfidence)
    : 0;
  const uncertaintyPts = uncertainty * 10;

  // Floor boost for explicit failure/regression types so they always rise above
  // routine telemetry even with $0 dollar attribution.
  const failureBoost = REVENUE_AT_RISK_TYPES.has(eventType) ? 15 : 0;

  const raw = revenuePts + noveltyPts + timePts + customerPts + uncertaintyPts + failureBoost;
  let score = Math.min(100, Math.max(0, Math.round(raw)));

  // Hard floor: must-wake event types always cross the wake threshold on first
  // occurrence (and thereafter — cooldown in owner-notify suppresses email
  // spam, not the wake decision itself).
  if (MUST_WAKE_TYPES.has(eventType)) {
    score = Math.max(score, MUST_WAKE_FLOOR);
  }

  const rule = score >= 70
    ? "wake_immediately"
    : score >= 40
      ? "batch_hourly_digest"
      : "log_only";

  return {
    score,
    meta: {
      weights: {
        revenue: revenuePts,
        novelty: noveltyPts,
        time: timePts,
        customer: customerPts,
        uncertainty: uncertaintyPts,
        failureBoost,
      },
      revenueAtRiskUsd,
      novel,
      customerFacing,
      uncertainty,
      rule,
      computedAt: new Date().toISOString(),
    },
  };
}

export const SALIENCE_WAKE_THRESHOLD = 70;
export const SALIENCE_DIGEST_THRESHOLD = 40;

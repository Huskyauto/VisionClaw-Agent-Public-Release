import { db } from "./db";
import { sql } from "drizzle-orm";

export interface UsageLimits {
  messagesPerDay: number;
  toolCallsPerDay: number;
  conversationsPerMonth: number;
  maxPersonas: number;
}

export const PLAN_LIMITS: Record<string, UsageLimits> = {
  trial: {
    messagesPerDay: -1,
    toolCallsPerDay: -1,
    conversationsPerMonth: -1,
    maxPersonas: 12,
  },
  starter: {
    messagesPerDay: 200,
    toolCallsPerDay: 100,
    conversationsPerMonth: 100,
    maxPersonas: 3,
  },
  "starter-byok": {
    messagesPerDay: 1000,
    toolCallsPerDay: 500,
    conversationsPerMonth: -1,
    maxPersonas: 3,
  },
  pro: {
    messagesPerDay: 1000,
    toolCallsPerDay: 500,
    conversationsPerMonth: -1,
    maxPersonas: 5,
  },
  "pro-byok": {
    messagesPerDay: 5000,
    toolCallsPerDay: 2000,
    conversationsPerMonth: -1,
    maxPersonas: 5,
  },
  enterprise: {
    messagesPerDay: 5000,
    toolCallsPerDay: 2000,
    conversationsPerMonth: -1,
    maxPersonas: 12,
  },
  "enterprise-byok": {
    messagesPerDay: -1,
    toolCallsPerDay: -1,
    conversationsPerMonth: -1,
    maxPersonas: 12,
  },
  admin: {
    messagesPerDay: -1,
    toolCallsPerDay: -1,
    conversationsPerMonth: -1,
    maxPersonas: 12,
  },
};

export async function hasByokKeys(tenantId: number): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM tenant_provider_keys 
    WHERE tenant_id = ${tenantId} AND enabled = true
  `);
  return ((result as any).rows?.[0]?.count || 0) > 0;
}

export function getEffectivePlan(basePlan: string, hasByok: boolean): string {
  if (!hasByok) return basePlan;
  const byokPlan = `${basePlan}-byok`;
  if (PLAN_LIMITS[byokPlan]) return byokPlan;
  return basePlan;
}

export async function ensureUsageTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS usage_tracking (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      metric TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      period TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_tenant_metric_period 
    ON usage_tracking(tenant_id, metric, period)
  `);
}

function getDayPeriod(): string {
  return new Date().toISOString().split("T")[0];
}

function getMonthPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function incrementUsage(tenantId: number, metric: string): Promise<number> {
  const period = metric.includes("month") ? getMonthPeriod() : getDayPeriod();

  const result = await db.execute(sql`
    INSERT INTO usage_tracking (tenant_id, metric, count, period, updated_at)
    VALUES (${tenantId}, ${metric}, 1, ${period}, NOW())
    ON CONFLICT (tenant_id, metric, period)
    DO UPDATE SET count = usage_tracking.count + 1, updated_at = NOW()
    RETURNING count
  `);

  return (result as any).rows?.[0]?.count || 0;
}

export async function getUsage(tenantId: number, metric: string): Promise<number> {
  const period = metric.includes("month") ? getMonthPeriod() : getDayPeriod();

  const result = await db.execute(sql`
    SELECT count FROM usage_tracking 
    WHERE tenant_id = ${tenantId} AND metric = ${metric} AND period = ${period}
  `);

  return (result as any).rows?.[0]?.count || 0;
}

export async function getUsageSummary(tenantId: number): Promise<{
  messagestoday: number;
  toolCallsToday: number;
  conversationsThisMonth: number;
  limits: UsageLimits;
  plan: string;
  byokActive: boolean;
  effectivePlan: string;
}> {
  const [msgs, tools, convs, byok] = await Promise.all([
    getUsage(tenantId, "messages_day"),
    getUsage(tenantId, "tool_calls_day"),
    getUsage(tenantId, "conversations_month"),
    hasByokKeys(tenantId),
  ]);

  const planResult = await db.execute(sql`
    SELECT plan FROM tenants WHERE id = ${tenantId}
  `);
  const basePlan = (planResult as any).rows?.[0]?.plan || "trial";
  const effectivePlan = getEffectivePlan(basePlan, byok);
  const limits = PLAN_LIMITS[effectivePlan] || PLAN_LIMITS.trial;

  return {
    messagestoday: msgs,
    toolCallsToday: tools,
    conversationsThisMonth: convs,
    limits,
    plan: basePlan,
    byokActive: byok,
    effectivePlan,
  };
}

export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  current: number;
  limit: number;
}

export async function checkMessageLimit(tenantId: number, plan?: string): Promise<UsageCheckResult> {
  const resolvedPlan = plan || await resolvePlan(tenantId);
  const limits = PLAN_LIMITS[resolvedPlan] || PLAN_LIMITS.trial;

  if (limits.messagesPerDay === -1) return { allowed: true, current: 0, limit: -1 };

  const current = await getUsage(tenantId, "messages_day");
  return {
    allowed: current < limits.messagesPerDay,
    reason: current >= limits.messagesPerDay ? `Daily message limit reached (${limits.messagesPerDay}). Upgrade your plan for more.` : undefined,
    current,
    limit: limits.messagesPerDay,
  };
}

export async function checkToolCallLimit(tenantId: number, plan?: string): Promise<UsageCheckResult> {
  const resolvedPlan = plan || await resolvePlan(tenantId);
  const limits = PLAN_LIMITS[resolvedPlan] || PLAN_LIMITS.trial;

  if (limits.toolCallsPerDay === -1) return { allowed: true, current: 0, limit: -1 };

  const current = await getUsage(tenantId, "tool_calls_day");
  return {
    allowed: current < limits.toolCallsPerDay,
    reason: current >= limits.toolCallsPerDay ? `Daily tool call limit reached (${limits.toolCallsPerDay}). Upgrade your plan for more.` : undefined,
    current,
    limit: limits.toolCallsPerDay,
  };
}

export async function checkConversationLimit(tenantId: number, plan?: string): Promise<UsageCheckResult> {
  const resolvedPlan = plan || await resolvePlan(tenantId);
  const limits = PLAN_LIMITS[resolvedPlan] || PLAN_LIMITS.trial;

  if (limits.conversationsPerMonth === -1) return { allowed: true, current: 0, limit: -1 };

  const current = await getUsage(tenantId, "conversations_month");
  return {
    allowed: current < limits.conversationsPerMonth,
    reason: current >= limits.conversationsPerMonth ? `Monthly conversation limit reached (${limits.conversationsPerMonth}). Upgrade your plan for more.` : undefined,
    current,
    limit: limits.conversationsPerMonth,
  };
}

async function resolvePlan(tenantId: number): Promise<string> {
  const result = await db.execute(sql`
    SELECT plan, is_admin FROM tenants WHERE id = ${tenantId}
  `);
  const row = (result as any).rows?.[0];
  if (row?.is_admin) return "admin";
  const basePlan = row?.plan || "trial";
  const byok = await hasByokKeys(tenantId);
  return getEffectivePlan(basePlan, byok);
}

export async function trackMessage(tenantId: number): Promise<void> {
  await incrementUsage(tenantId, "messages_day");
}

export async function trackToolCall(tenantId: number): Promise<void> {
  await incrementUsage(tenantId, "tool_calls_day");
}

export async function trackConversation(tenantId: number): Promise<void> {
  await incrementUsage(tenantId, "conversations_month");
}

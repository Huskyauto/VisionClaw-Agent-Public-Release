import { db } from "./db";
import { agentActivity, personas } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export type ActivityType = "chat" | "orchestration" | "tool_execution" | "skill_learned" | "research" | "heartbeat_task" | "delegation" | "error_recovery";
export type ActivityStatus = "active" | "complete" | "failed" | "idle" | "blocked";

interface TrackActivityParams {
  tenantId: number;
  personaId?: number;
  personaName?: string;
  activityType: ActivityType | string;
  status: ActivityStatus | string;
  summary?: string;
  conversationId?: number;
  metadata?: Record<string, unknown>;
}

const liveAgentStatus = new Map<string, {
  personaId: number;
  personaName: string;
  tenantId: number;
  status: string;
  activityType: string;
  summary: string;
  conversationId?: number;
  startedAt: number;
  lastUpdate: number;
}>();

export async function trackActivity(params: TrackActivityParams): Promise<number | null> {
  try {
    const personaName = params.personaName || "VisionClaw";
    const [row] = await db.insert(agentActivity).values({
      tenantId: params.tenantId,
      personaId: params.personaId || null,
      personaName,
      status: params.status,
      activityType: params.activityType,
      summary: params.summary || null,
      conversationId: params.conversationId || null,
      metadata: params.metadata || {},
      startedAt: new Date(),
      completedAt: params.status === "complete" || params.status === "failed" ? new Date() : null,
    }).returning({ id: agentActivity.id });

    const key = `${params.tenantId}:${params.personaId || 0}`;
    if (params.status === "active") {
      liveAgentStatus.set(key, {
        personaId: params.personaId || 0,
        personaName,
        tenantId: params.tenantId,
        status: params.status,
        activityType: params.activityType,
        summary: params.summary || "",
        conversationId: params.conversationId,
        startedAt: Date.now(),
        lastUpdate: Date.now(),
      });
    } else if (params.status === "complete" || params.status === "failed" || params.status === "idle") {
      liveAgentStatus.delete(key);
    }

    return row?.id || null;
  } catch (err: any) {
    console.error(`[agent-activity] Track failed:`, err.message);
    return null;
  }
}

export async function completeActivity(activityId: number, status: "complete" | "failed" = "complete", summary?: string): Promise<void> {
  try {
    const updates: any = { status, completedAt: new Date() };
    if (summary) updates.summary = summary;
    await db.update(agentActivity).set(updates).where(eq(agentActivity.id, activityId));
  } catch (err: any) {
    console.error(`[agent-activity] Complete failed:`, err.message);
  }
}

export function getLiveAgentStatuses(tenantId: number): Array<{
  personaId: number;
  personaName: string;
  status: string;
  activityType: string;
  summary: string;
  conversationId?: number;
  elapsedMs: number;
}> {
  const results: ReturnType<typeof getLiveAgentStatuses> = [];
  const now = Date.now();

  for (const [key, entry] of liveAgentStatus) {
    if (entry.tenantId === tenantId) {
      if (now - entry.lastUpdate > 600_000) {
        liveAgentStatus.delete(key);
        continue;
      }
      results.push({
        personaId: entry.personaId,
        personaName: entry.personaName,
        status: entry.status,
        activityType: entry.activityType,
        summary: entry.summary,
        conversationId: entry.conversationId,
        elapsedMs: now - entry.startedAt,
      });
    }
  }

  return results;
}

export async function getRecentActivity(tenantId: number, limit = 50): Promise<typeof agentActivity.$inferSelect[]> {
  return db.select().from(agentActivity)
    .where(eq(agentActivity.tenantId, tenantId))
    .orderBy(desc(agentActivity.createdAt))
    .limit(limit);
}

export async function getLearnedSkillsActivity(tenantId: number, limit = 20): Promise<typeof agentActivity.$inferSelect[]> {
  return db.select().from(agentActivity)
    .where(and(
      eq(agentActivity.tenantId, tenantId),
      eq(agentActivity.activityType, "skill_learned"),
    ))
    .orderBy(desc(agentActivity.createdAt))
    .limit(limit);
}

export async function getActivitySummary(tenantId: number): Promise<{
  totalActivities: number;
  skillsLearned: number;
  orchestrationsRun: number;
  activeAgents: number;
  recentErrors: number;
  agentBreakdown: Record<string, number>;
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 86400000);

  const [totals] = await db.select({
    total: sql<number>`count(*)::int`,
    skills: sql<number>`count(*) filter (where activity_type = 'skill_learned')::int`,
    orchestrations: sql<number>`count(*) filter (where activity_type = 'orchestration')::int`,
    errors: sql<number>`count(*) filter (where status = 'failed' and created_at > ${twentyFourHoursAgo})::int`,
  }).from(agentActivity).where(eq(agentActivity.tenantId, tenantId));

  const breakdownRows = await db.select({
    personaName: agentActivity.personaName,
    count: sql<number>`count(*)::int`,
  }).from(agentActivity)
    .where(eq(agentActivity.tenantId, tenantId))
    .groupBy(agentActivity.personaName);

  const agentBreakdown: Record<string, number> = {};
  for (const row of breakdownRows) {
    agentBreakdown[row.personaName] = row.count;
  }

  return {
    totalActivities: totals?.total || 0,
    skillsLearned: totals?.skills || 0,
    orchestrationsRun: totals?.orchestrations || 0,
    activeAgents: getLiveAgentStatuses(tenantId).length,
    recentErrors: totals?.errors || 0,
    agentBreakdown,
  };
}

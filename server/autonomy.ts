import { db } from "./db";
import { sql } from "drizzle-orm";

export interface AutonomyCheck {
  actionType: string;
  personaId: number;
  tenantId: number;
  confidenceScore?: number;
  context: Record<string, any>;
  value?: number;
}

export interface AutonomyDecision {
  allowed: boolean;
  decision: "auto_approved" | "auto_blocked" | "escalated" | "pending_approval";
  ruleId?: number;
  reason: string;
}

export async function checkAutonomy(check: AutonomyCheck): Promise<AutonomyDecision> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM autonomy_rules
      WHERE tenant_id = ${check.tenantId}
        AND action_type = ${check.actionType}
        AND enabled = TRUE
        AND (persona_id = ${check.personaId} OR persona_id IS NULL)
      ORDER BY persona_id DESC NULLS LAST
      LIMIT 1
    `);
    const rules = (result as any).rows || [];

    if (rules.length === 0) {
      return { allowed: true, decision: "auto_approved", reason: "No autonomy rules configured for this action" };
    }

    const rule = rules[0];
    const conditions = (rule.conditions || {}) as Record<string, any>;

    if (rule.requires_confidence_score && (check.confidenceScore || 0) < rule.requires_confidence_score) {
      if (rule.escalate_to === "human") {
        await logDecision(check, "escalated", rule.id, rule.escalate_to);
        return {
          allowed: false,
          decision: "escalated",
          ruleId: rule.id,
          reason: `Confidence ${(check.confidenceScore || 0).toFixed(2)} below threshold ${rule.requires_confidence_score} — escalated to human`,
        };
      }
      await logDecision(check, "escalated", rule.id, rule.escalate_to);
      return {
        allowed: false,
        decision: "escalated",
        ruleId: rule.id,
        reason: `Escalated to ${rule.escalate_to} — confidence below threshold`,
      };
    }

    if (rule.max_value && (check.value || 0) > rule.max_value) {
      await logDecision(check, "escalated", rule.id, "human");
      return {
        allowed: false,
        decision: "pending_approval",
        ruleId: rule.id,
        reason: `Value ${check.value} exceeds maximum ${rule.max_value} for ${check.actionType}`,
      };
    }

    if (conditions.max_daily_count) {
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM autonomy_log
        WHERE tenant_id = ${check.tenantId}
          AND persona_id = ${check.personaId}
          AND action_type = ${check.actionType}
          AND decision = 'auto_approved'
          AND created_at >= CURRENT_DATE
      `);
      const todayCount = parseInt(((countResult as any).rows || [])[0]?.cnt || "0");
      if (todayCount >= conditions.max_daily_count) {
        await logDecision(check, "auto_blocked", rule.id);
        return {
          allowed: false,
          decision: "auto_blocked",
          ruleId: rule.id,
          reason: `Daily limit of ${conditions.max_daily_count} reached for ${check.actionType}`,
        };
      }
    }

    if (conditions.business_hours_only) {
      const hour = new Date().getHours();
      if (hour < 8 || hour > 18) {
        await logDecision(check, "auto_blocked", rule.id);
        return {
          allowed: false,
          decision: "auto_blocked",
          ruleId: rule.id,
          reason: `Action ${check.actionType} restricted to business hours (8am-6pm)`,
        };
      }
    }

    switch (rule.autonomy_level) {
      case "full_auto":
        await logDecision(check, "auto_approved", rule.id);
        return { allowed: true, decision: "auto_approved", ruleId: rule.id, reason: "Full autonomy granted" };

      case "notify_after":
        await logDecision(check, "auto_approved", rule.id);
        return { allowed: true, decision: "auto_approved", ruleId: rule.id, reason: "Auto-approved with post-notification" };

      case "approve_before":
        await logDecision(check, "pending_approval", rule.id, rule.escalate_to || "human");
        return {
          allowed: false,
          decision: "pending_approval",
          ruleId: rule.id,
          reason: `Requires approval before execution (escalated to ${rule.escalate_to || "human"})`,
        };

      case "blocked":
        await logDecision(check, "auto_blocked", rule.id);
        return { allowed: false, decision: "auto_blocked", ruleId: rule.id, reason: `Action ${check.actionType} is blocked for this persona` };

      default:
        return { allowed: true, decision: "auto_approved", reason: "Unknown autonomy level — defaulting to allowed" };
    }
  } catch (err: any) {
    console.error("[autonomy] Check failed:", err.message);
    return { allowed: true, decision: "auto_approved", reason: "Autonomy check failed — defaulting to allowed" };
  }
}

async function logDecision(check: AutonomyCheck, decision: string, ruleId?: number, escalatedTo?: string) {
  try {
    await db.execute(sql`
      INSERT INTO autonomy_log (tenant_id, persona_id, action_type, decision, rule_id, confidence_score, context, escalated_to)
      VALUES (${check.tenantId}, ${check.personaId}, ${check.actionType}, ${decision}, ${ruleId || null}, ${check.confidenceScore || null}, ${JSON.stringify(check.context)}::jsonb, ${escalatedTo || null})
    `);
  } catch (err: any) {
    console.error("[autonomy] Log failed:", err.message);
  }
}

export async function getRules(tenantId: number) {
  const result = await db.execute(sql`
    SELECT * FROM autonomy_rules WHERE tenant_id = ${tenantId} ORDER BY action_type, persona_id NULLS LAST
  `);
  return (result as any).rows || [];
}

export async function createRule(tenantId: number, data: {
  personaId?: number;
  actionType: string;
  autonomyLevel: string;
  conditions?: any;
  maxValue?: number;
  requiresConfidenceScore?: number;
  escalateTo?: string;
  description?: string;
}) {
  const result = await db.execute(sql`
    INSERT INTO autonomy_rules (tenant_id, persona_id, action_type, autonomy_level, conditions, max_value, requires_confidence_score, escalate_to, description)
    VALUES (${tenantId}, ${data.personaId || null}, ${data.actionType}, ${data.autonomyLevel}, ${data.conditions ? JSON.stringify(data.conditions) : null}::jsonb, ${data.maxValue || null}, ${data.requiresConfidenceScore || null}, ${data.escalateTo || null}, ${data.description || null})
    RETURNING *
  `);
  return ((result as any).rows || [])[0];
}

export async function updateRule(tenantId: number, ruleId: number, data: Partial<{
  personaId: number | null;
  actionType: string;
  autonomyLevel: string;
  conditions: any;
  maxValue: number | null;
  requiresConfidenceScore: number | null;
  escalateTo: string | null;
  description: string | null;
  enabled: boolean;
}>) {
  const sets: string[] = [];
  const vals: any[] = [];

  if (data.autonomyLevel !== undefined) { sets.push("autonomy_level"); vals.push(data.autonomyLevel); }
  if (data.enabled !== undefined) { sets.push("enabled"); vals.push(data.enabled); }
  if (data.description !== undefined) { sets.push("description"); vals.push(data.description); }

  await db.execute(sql`
    UPDATE autonomy_rules SET
      persona_id = COALESCE(${data.personaId !== undefined ? data.personaId : null}, persona_id),
      action_type = COALESCE(${data.actionType || null}, action_type),
      autonomy_level = COALESCE(${data.autonomyLevel || null}, autonomy_level),
      conditions = COALESCE(${data.conditions ? JSON.stringify(data.conditions) : null}::jsonb, conditions),
      max_value = ${data.maxValue !== undefined ? data.maxValue : null},
      requires_confidence_score = ${data.requiresConfidenceScore !== undefined ? data.requiresConfidenceScore : null},
      escalate_to = ${data.escalateTo !== undefined ? data.escalateTo : null},
      description = ${data.description !== undefined ? data.description : null},
      enabled = COALESCE(${data.enabled !== undefined ? data.enabled : null}, enabled)
    WHERE id = ${ruleId} AND tenant_id = ${tenantId}
  `);
}

export async function deleteRule(tenantId: number, ruleId: number) {
  await db.execute(sql`DELETE FROM autonomy_rules WHERE id = ${ruleId} AND tenant_id = ${tenantId}`);
}

export async function getAutonomyLog(tenantId: number, limit = 50) {
  const result = await db.execute(sql`
    SELECT * FROM autonomy_log WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}
  `);
  return (result as any).rows || [];
}

export async function getAutonomyStats(tenantId: number) {
  const result = await db.execute(sql`
    SELECT
      persona_id,
      action_type,
      decision,
      COUNT(*) as count
    FROM autonomy_log
    WHERE tenant_id = ${tenantId} AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY persona_id, action_type, decision
    ORDER BY count DESC
  `);
  return (result as any).rows || [];
}

export async function seedDefaultRules(tenantId: number) {
  const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM autonomy_rules WHERE tenant_id = ${tenantId}`);
  const count = parseInt(((existing as any).rows || [])[0]?.cnt || "0");
  if (count > 0) return { seeded: false, message: "Rules already exist" };

  const defaults = [
    { personaId: 2, actionType: "delegate_task", autonomyLevel: "full_auto", confidenceScore: 0.6, description: "Felix can delegate tasks freely" },
    { personaId: 2, actionType: "send_email", autonomyLevel: "notify_after", confidenceScore: 0.7, conditions: { max_daily_count: 20 }, description: "Felix auto-sends emails, notifies after" },
    { personaId: 11, actionType: "send_email", autonomyLevel: "full_auto", confidenceScore: 0.7, conditions: { max_daily_count: 50 }, description: "Apollo can send outreach emails" },
    { personaId: 7, actionType: "publish_content", autonomyLevel: "approve_before", escalateTo: "proof", confidenceScore: 0.8, description: "Scribe content needs Proof review" },
    { personaId: 3, actionType: "execute_code", autonomyLevel: "full_auto", confidenceScore: 0.7, description: "Forge can execute code in sandbox" },
    { personaId: 3, actionType: "execute_shell", autonomyLevel: "approve_before", escalateTo: "human", description: "Forge shell commands need approval" },
    { personaId: null, actionType: "browser_navigate", autonomyLevel: "full_auto", description: "All agents can navigate freely" },
    { personaId: null, actionType: "browser_form_submit", autonomyLevel: "approve_before", escalateTo: "human", description: "Form submissions need approval" },
    { personaId: null, actionType: "payment_action", autonomyLevel: "approve_before", escalateTo: "human", description: "Payment actions always need approval" },
  ];

  for (const rule of defaults) {
    await db.execute(sql`
      INSERT INTO autonomy_rules (tenant_id, persona_id, action_type, autonomy_level, requires_confidence_score, escalate_to, conditions, description)
      VALUES (${tenantId}, ${rule.personaId || null}, ${rule.actionType}, ${rule.autonomyLevel}, ${rule.confidenceScore || null}, ${rule.escalateTo || null}, ${rule.conditions ? JSON.stringify(rule.conditions) : null}::jsonb, ${rule.description || null})
    `).catch(() => {});
  }

  return { seeded: true, message: `Seeded ${defaults.length} default rules` };
}

export function mapToolToActionType(toolName: string): string | null {
  const map: Record<string, string> = {
    send_email: "send_email",
    whatsapp: "send_message",
    exec: "execute_code",
    execute_code: "execute_code",
    shell_exec: "execute_shell",
    browser: "browser_navigate",
    smart_browse: "browser_navigate",
    delegate_task: "delegate_task",
    sessions_spawn: "delegate_task",
    create_pdf: "publish_content",
    google_drive: "publish_content",
    draft_social_post: "publish_content",
  };
  return map[toolName] || null;
}

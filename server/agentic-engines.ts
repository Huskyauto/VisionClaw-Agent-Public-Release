import { db } from "./db";
import { sql } from "drizzle-orm";
import { getModelForTierAsync, getClientForModel, getAvailableModels } from "./providers";
import { executeWithFailover } from "./model-failover";

const ENGINE_TYPES = {
  DECISION: "decision",
  PREDICTION: "prediction",
  OPTIMIZATION: "optimization",
} as const;

// R63: Auto-apply policy. Internal/operational categories are auto-applied at insertion
// time (status='applied' with action_taken="Auto-applied: ..."). Strategic/external
// categories (marketing, growth, market signals) stay status='new' so a human can decide.
// The user explicitly asked the system to apply low-risk insights without manual review.
const AUTO_APPLY_CATEGORIES = new Set([
  "agent_optimization",
  "cost_reduction",
  "resource_allocation",
  "resource_optimization",
  "scheduling_optimization",
  "workflow_automation",
  "email_optimization",
  "social_optimization",
]);

const AUTO_APPLY_REASON =
  "Auto-applied: operational category — recorded as actioned in the agentic backlog. No external action taken; re-open if you want a Minerva plan for this.";

// R63 hardening — durability marker. HIGH-priority auto-applied insights are
// stamped with this prefix until Minerva routing succeeds. The periodic sweep
// retries any insight whose action_taken still starts with this marker, so a
// transient failure during plan creation cannot leave an insight permanently
// "applied but no plan drafted."
const PENDING_PLAN_MARKER = "Auto-applied: pending Minerva plan";
const PLAN_DRAFTED_PREFIX = "Auto-applied + drafted Minerva plan #";

const ROUTE_SOURCE = "agentic-engine.auto-apply";

async function storeInsight(params: {
  tenantId: number;
  engineType: string;
  category: string;
  title: string;
  summary: string;
  details?: string;
  priority: string;
  dataSnapshot?: string;
}): Promise<{ id: number; autoApplied: boolean; priority: string }> {
  // R74.13f: removed `params.tenantId ?? 1` — params.tenantId is typed
  // `number` (required, not `number | undefined`), so the `?? 1` was
  // pure dead code that the silent-failure scanner correctly flagged
  // as a fail-open landmine for any future signature loosening.
  const tenantId = params.tenantId;
  const engineType = params.engineType || "unknown";
  const category = params.category || "general";
  const title = (params.title || "Insight").slice(0, 500);
  const summary = (params.summary || "").slice(0, 5000);
  const details = params.details ? params.details.slice(0, 10000) : null;
  const priority = params.priority || "medium";
  const dataSnapshot = params.dataSnapshot ? params.dataSnapshot.slice(0, 20000) : null;
  const isAutoApply = AUTO_APPLY_CATEGORIES.has(category);
  const status = isAutoApply ? "applied" : "new";
  // HIGH+auto-apply gets a "pending plan" marker so the durability sweep can
  // retry routing if Minerva fails transiently. Other rows get the standard reason.
  const actionTaken = isAutoApply
    ? (priority === "high" ? PENDING_PLAN_MARKER : AUTO_APPLY_REASON)
    : null;
  const result: any = await db.execute(sql`
    INSERT INTO ai_insights (tenant_id, engine_type, category, title, summary, details, priority, data_snapshot, status, action_taken)
    VALUES (${tenantId}, ${engineType}, ${category}, ${title},
            ${summary}, ${details}, ${priority}, ${dataSnapshot}, ${status}, ${actionTaken})
    RETURNING id
  `);
  const rows = result.rows || result;
  const id = Number(rows?.[0]?.id);

  // R63 hardening — guard against insert succeeding but RETURNING failing to
  // surface a usable id. Without an id we cannot route; log loudly so the
  // operator can investigate (drizzle/neon shape regression, etc.).
  if (!id || id <= 0) {
    console.warn(`[agentic-engines] storeInsight: invalid returned id (${rows?.[0]?.id}). Skipping routing for "${title.slice(0,80)}".`);
    return { id: 0, autoApplied: isAutoApply, priority };
  }

  // R63: Proactive routing — when an auto-applied insight is HIGH priority,
  // automatically draft a Minerva plan so Felix has a concrete next-step
  // queued instead of just a checkmark. Medium/low auto-applied insights
  // stay silent (only a status update) to avoid flooding the approval queue.
  if (isAutoApply && priority === "high") {
    routeInsightToMinerva({
      insightId: id, tenantId, category, title, summary, details: details ?? "",
    }).catch((e: any) => console.warn(`[agentic-engines] Minerva routing failed for insight #${id}: ${e.message} (will be retried by sweep)`));
  }

  return { id, autoApplied: isAutoApply, priority };
}

// R63: Route an auto-applied insight to Minerva as a draft plan (status='awaiting_approval').
// This is the bridge from "the system noticed something" to "the system is doing something
// about it" — without overstepping. Felix still approves before any plan executes.
async function routeInsightToMinerva(insight: {
  insightId: number;
  tenantId: number;
  category: string;
  title: string;
  summary: string;
  details: string;
}) {
  // R63 hardening — idempotency check. If a plan already exists for this
  // (source, sourceRef) tuple, skip creating a duplicate and just refresh
  // the action_taken stamp. Prevents Felix's queue from being spammed by
  // retries, manual replays, or future concurrent callers.
  const existing: any = await db.execute(sql`
    SELECT id FROM plans
    WHERE source = ${ROUTE_SOURCE} AND source_ref = ${String(insight.insightId)}
      AND tenant_id = ${insight.tenantId}
    LIMIT 1
  `).catch(() => ({ rows: [] }));
  const existingRows = existing.rows || existing;
  const existingPlanId = existingRows?.[0]?.id ? Number(existingRows[0].id) : null;

  let planId: number;
  if (existingPlanId) {
    planId = existingPlanId;
    console.log(`[agentic-engines] Insight #${insight.insightId} already has Minerva plan #${planId}; reusing (idempotent).`);
  } else {
    const { createPlan } = await import("./minerva-planner");
    const objective = `${insight.title}\n\n${insight.summary}${insight.details ? `\n\nDetails: ${insight.details.slice(0, 800)}` : ""}`;
    const created = await createPlan({
      objective: objective.slice(0, 2000),
      context: {
        source: ROUTE_SOURCE,
        insightId: insight.insightId,
        category: insight.category,
        triggered_at: new Date().toISOString(),
      },
      source: ROUTE_SOURCE,
      sourceRef: String(insight.insightId),
      tenantId: insight.tenantId,
    });
    planId = created.planId;
    console.log(`[agentic-engines] Insight #${insight.insightId} (HIGH/${insight.category}) → Minerva plan #${planId} drafted, awaiting Felix approval.`);
  }

  // Stamp the insight's action_taken to reference the plan and clear the
  // pending marker so the durability sweep stops retrying.
  await db.execute(sql`
    UPDATE ai_insights
    SET action_taken = ${`${PLAN_DRAFTED_PREFIX}${planId} (awaiting Felix approval).`}
    WHERE id = ${insight.insightId} AND tenant_id = ${insight.tenantId}
  `).catch((e: any) => console.warn(`[agentic-engines] action_taken update failed for insight #${insight.insightId}: ${e.message}`));
}

// R63 hardening — durability sweep. Find HIGH insights that were auto-applied
// but whose Minerva routing failed (action_taken still has the pending marker)
// and retry routing. Runs alongside the regular auto-apply sweep on the same
// 10-minute interval. Idempotent because routeInsightToMinerva itself is.
export async function retryPendingMinervaRouting(): Promise<number> {
  try {
    const result: any = await db.execute(sql`
      SELECT id, tenant_id, category, title, summary, details
      FROM ai_insights
      WHERE status = 'applied'
        AND priority = 'high'
        AND action_taken = ${PENDING_PLAN_MARKER}
      LIMIT 50
    `);
    const rows = result.rows || result;
    const pending = Array.isArray(rows) ? rows : [];
    if (pending.length === 0) return 0;
    console.log(`[agentic-engines] Durability sweep: retrying Minerva routing for ${pending.length} HIGH insights stuck in pending.`);
    let recovered = 0;
    for (const r of pending) {
      try {
        // R74.13f BLOCKING fix (caught in Furrow review): the previous
        // `tenantId: Number(r.tenant_id) || 1` was a tenant fail-open
        // landmine — any insight whose tenant_id was NULL/0/non-numeric
        // would silently get routed to tenant 1. Now: validate first,
        // skip-and-warn on invalid (durability sweep can re-attempt
        // after upstream cleanup).
        const tid = Number(r.tenant_id);
        if (!Number.isInteger(tid) || tid <= 0) {
          console.warn(`[agentic-engines] Durability sweep: insight #${r.id} has invalid tenant_id (${JSON.stringify(r.tenant_id)}); skipping Minerva routing.`);
          continue;
        }
        await routeInsightToMinerva({
          insightId: Number(r.id),
          tenantId: tid,
          category: String(r.category || "general"),
          title: String(r.title || ""),
          summary: String(r.summary || ""),
          details: String(r.details || ""),
        });
        recovered++;
      } catch (e: any) {
        console.warn(`[agentic-engines] Durability sweep: insight #${r.id} still failing — ${e.message}`);
      }
    }
    if (recovered > 0) console.log(`[agentic-engines] Durability sweep: recovered ${recovered}/${pending.length} pending plans.`);
    return recovered;
  } catch (e: any) {
    console.warn(`[agentic-engines] retryPendingMinervaRouting failed: ${e.message}`);
    return 0;
  }
}

// R63: Self-awareness — when a heartbeat task hits dead-letter (5 consecutive
// failures and is auto-disabled), surface it as a HIGH-priority workflow_automation
// insight that auto-applies AND drafts a Minerva plan to investigate/fix.
// The system notices its own failures instead of waiting for the user to spot them.
export async function reportTaskFailureInsight(taskName: string, lastError: string, tenantId: number) {
  // R74.13f fail-closed: removed `tenantId: number = 1` default.
  // Sole caller (heartbeat.ts:599) already passes `taskTenant`
  // explicitly, so the default was dead code masking the real bug
  // shape: a future caller forgetting to pass tenant would silently
  // write self-heal insights to tenant 1 instead of erroring.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`reportTaskFailureInsight requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  try {
    const title = `Heartbeat task auto-disabled: ${taskName}`.slice(0, 500);
    const summary = `The scheduled task "${taskName}" was disabled after 5 consecutive failures. The system needs investigation to either restore it (fix root cause), reduce its frequency, or remove it entirely if obsolete.`;
    const details = `Last error: ${String(lastError).slice(0, 4000)}\n\nRecommended actions:\n1. Check recent heartbeat_logs for this task to identify the failure pattern.\n2. Verify any required secrets/credentials are still valid.\n3. If the failure is environmental (timeout, network), bump the timeout or add a retry.\n4. If the task is no longer needed, mark it for permanent removal.`;
    await storeInsight({
      tenantId, engineType: "self_heal", category: "workflow_automation",
      title, summary, details, priority: "high",
      dataSnapshot: JSON.stringify({ taskName, lastError: String(lastError).slice(0, 1000) }),
    });
    console.log(`[agentic-engines] Self-healing insight created for dead-lettered task: ${taskName}`);
  } catch (e: any) {
    console.warn(`[agentic-engines] reportTaskFailureInsight failed: ${e.message}`);
  }
}

// R63: Backfill — sweep existing status='new' insights whose category is in the
// auto-apply policy and mark them applied. Safe to call repeatedly; only touches
// rows still status='new' so manually applied/dismissed items are untouched.
export async function autoApplyEligibleInsights(): Promise<number> {
  try {
    const cats = Array.from(AUTO_APPLY_CATEGORIES);
    const catList = sql.join(cats.map(c => sql`${c}`), sql`, `);
    const result: any = await db.execute(sql`
      UPDATE ai_insights
      SET status = 'applied',
          action_taken = ${AUTO_APPLY_REASON}
      WHERE status = 'new'
        AND category IN (${catList})
      RETURNING id, tenant_id, category, title, summary, details, priority
    `);
    const rows = result.rows || result;
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      console.log(`[agentic-engines] Auto-applied ${count} eligible insights (operational categories).`);
      // R63: Route HIGH-priority bulk-applied insights to Minerva for the same
      // proactive treatment as storeInsight. Without this, HIGH insights inserted
      // via legacy/bypass paths would auto-apply but never produce a draft plan,
      // causing inconsistent behavior between the two pipelines.
      const highPriority = rows.filter((r: any) => r.priority === "high");
      // For HIGH-priority bulk-applied insights, also stamp them with the
      // pending marker so the durability sweep can retry if routing fails.
      for (const r of highPriority) {
        // R74.13f BLOCKING fix (caught in Furrow review): the previous
        // `tenantId: Number(r.tenant_id) || 1` was a tenant fail-open
        // landmine — any HIGH insight with a NULL/0/non-numeric
        // tenant_id would silently route to tenant 1's Minerva.
        // Skip-and-warn on invalid; durability sweep will not retry
        // because we never set the PENDING_PLAN_MARKER for skipped
        // rows. (72h review: tid validation moved ABOVE the marker
        // UPDATE and the UPDATE is now tenant-scoped — defense-in-depth
        // on a multi-tenant write path, matching line ~148.)
        const tid = Number(r.tenant_id);
        if (!Number.isInteger(tid) || tid <= 0) {
          console.warn(`[agentic-engines] Sweep: HIGH insight #${r.id} has invalid tenant_id (${JSON.stringify(r.tenant_id)}); skipping Minerva routing.`);
          continue;
        }
        await db.execute(sql`
          UPDATE ai_insights SET action_taken = ${PENDING_PLAN_MARKER}
          WHERE id = ${Number(r.id)} AND tenant_id = ${tid}
        `).catch(() => {});
        routeInsightToMinerva({
          insightId: Number(r.id),
          tenantId: tid,
          category: String(r.category || "general"),
          title: String(r.title || ""),
          summary: String(r.summary || ""),
          details: String(r.details || ""),
        }).catch((e: any) => console.warn(`[agentic-engines] sweep: Minerva routing failed for insight #${r.id}: ${e.message} (will be retried by durability sweep)`));
      }
      if (highPriority.length > 0) {
        console.log(`[agentic-engines] Sweep: routing ${highPriority.length} HIGH-priority insights to Minerva.`);
      }
    }
    return count;
  } catch (e: any) {
    console.warn(`[agentic-engines] autoApplyEligibleInsights failed: ${e.message}`);
    return 0;
  }
}

async function callAI(prompt: string, systemPrompt: string, tenantId?: number): Promise<string> {
  const modelId = await getModelForTierAsync("balanced", tenantId);
  const available = await getAvailableModels();
  const { result } = await executeWithFailover(modelId, available, async (client, actualModel) => {
    const resp = await client.chat.completions.create({
      model: actualModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });
    return resp.choices?.[0]?.message?.content || "";
  }, tenantId);
  return result;
}

async function gatherOperationalData(tenantId: number) {
  const [usage, sessions, experiments, conversations, tools] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as total_messages,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week_messages,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as month_messages
      FROM messages WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total_messages: 0, week_messages: 0, month_messages: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'running' THEN 1 END) as active,
             AVG(total_experiments) as avg_experiments
      FROM research_sessions WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, active: 0, avg_experiments: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN status = 'keep' THEN 1 END) as kept,
             COUNT(CASE WHEN status = 'discard' THEN 1 END) as discarded,
             COUNT(CASE WHEN status = 'crash' THEN 1 END) as crashed
      FROM research_experiments WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, kept: 0, discarded: 0, crashed: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week_new
      FROM conversations WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, week_new: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total_calls,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week_calls
      FROM heartbeat_logs WHERE task_name != 'Self-Reflection'
    `).catch(() => ({ rows: [{ total_calls: 0, week_calls: 0 }] })),
  ]);

  const uRows = (usage as any).rows || usage;
  const sRows = (sessions as any).rows || sessions;
  const eRows = (experiments as any).rows || experiments;
  const cRows = (conversations as any).rows || conversations;
  const tRows = (tools as any).rows || tools;

  return {
    messages: uRows[0] || {},
    sessions: sRows[0] || {},
    experiments: eRows[0] || {},
    conversations: cRows[0] || {},
    toolCalls: tRows[0] || {},
  };
}

export async function runDecisionEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[decision-engine] Running for tenant ${tenantId}...`);
    const data = await gatherOperationalData(tenantId);

    const programs = await db.execute(sql`
      SELECT name, objective, exploration_strategy, model FROM research_programs
      WHERE tenant_id = ${tenantId} AND is_active = true
    `).catch(() => ({ rows: [] }));
    const progRows = (programs as any).rows || programs;

    const personas = await db.execute(sql`
      SELECT name, role FROM personas WHERE is_active = true LIMIT 14
    `).catch(() => ({ rows: [] }));
    const personaRows = (personas as any).rows || personas;

    const prompt = `Analyze this operational data for an AI agent platform and provide 3-5 strategic recommendations.

OPERATIONAL DATA:
- Total messages: ${data.messages.total_messages}, Last 7 days: ${data.messages.week_messages}, Last 30 days: ${data.messages.month_messages}
- Research sessions: ${data.sessions.total} total, ${data.sessions.active} active, avg ${data.sessions.avg_experiments || 0} experiments/session
- Experiments: ${data.experiments.total} total, ${data.experiments.kept} kept, ${data.experiments.discarded} discarded, ${data.experiments.crashed} crashed
- Conversations: ${data.conversations.total} total, ${data.conversations.week_new} new this week
- Heartbeat tasks executed: ${data.toolCalls.total_calls} total, ${data.toolCalls.week_calls} this week
- Active research programs: ${progRows.length} (${progRows.map((p: any) => p.name).join(", ")})
- Active personas: ${personaRows.length} (${personaRows.map((p: any) => `${p.name}/${p.role}`).join(", ")})

For each recommendation, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [resource_allocation, marketing_strategy, agent_optimization, cost_reduction, growth_opportunity]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence actionable recommendation
5. DETAILS: Specific steps to implement

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a strategic AI operations analyst for an autonomous AI corporation platform. Analyze data and provide actionable recommendations for resource allocation, marketing strategies, and operational optimization. Be specific and data-driven.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let recommendations: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      recommendations = JSON.parse(cleaned);
    } catch {
      recommendations = [{ title: "Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const rec of recommendations) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.DECISION,
        category: rec.category || "general",
        title: rec.title || "Strategic Recommendation",
        summary: rec.summary || "",
        details: rec.details || "",
        priority: rec.priority || "medium",
        dataSnapshot: JSON.stringify(data),
      });
      count++;
    }

    console.log(`[decision-engine] Generated ${count} insights for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[decision-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runPredictiveEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[predictive-engine] Running for tenant ${tenantId}...`);
    const data = await gatherOperationalData(tenantId);

    const recentExperiments = await db.execute(sql`
      SELECT re.hypothesis, re.result, re.status, re.metric_value, rp.name as program_name
      FROM research_experiments re
      JOIN research_programs rp ON rp.id = re.program_id
      WHERE re.tenant_id = ${tenantId} AND re.status = 'keep'
      ORDER BY re.created_at DESC LIMIT 20
    `).catch(() => ({ rows: [] }));
    const expRows = (recentExperiments as any).rows || recentExperiments;

    const recentLogs = await db.execute(sql`
      SELECT task_name, status, output FROM heartbeat_logs
      WHERE status = 'success'
      ORDER BY created_at DESC LIMIT 10
    `).catch(() => ({ rows: [] }));
    const logRows = (recentLogs as any).rows || recentLogs;

    const prompt = `Based on this platform data, identify 3-5 trends and predict future opportunities.

PLATFORM METRICS:
- Message volume: ${data.messages.total_messages} total, ${data.messages.week_messages}/week, ${data.messages.month_messages}/month
- Research performance: ${data.experiments.kept}/${data.experiments.total} experiments kept (${data.experiments.total > 0 ? Math.round((parseInt(String(data.experiments.kept)) / parseInt(String(data.experiments.total))) * 100) : 0}% success rate)
- Conversation growth: ${data.conversations.week_new} new this week out of ${data.conversations.total} total

TOP RESEARCH FINDINGS (kept experiments):
${expRows.slice(0, 10).map((e: any) => `- [${e.program_name}] ${e.hypothesis} → Score: ${e.metric_value || "N/A"}`).join("\n") || "No kept experiments yet"}

RECENT AUTOMATED ACTIVITIES:
${logRows.slice(0, 5).map((l: any) => `- ${l.task_name}: ${String(l.output || "").slice(0, 100)}`).join("\n") || "No recent activity"}

For each trend/prediction, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [market_trend, product_opportunity, growth_forecast, risk_alert, competitive_insight]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence prediction with reasoning
5. DETAILS: Supporting evidence and recommended actions

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a predictive analytics AI specializing in trend forecasting for an autonomous AI corporation. Analyze patterns in operational data and research findings to identify emerging trends, market opportunities, and potential risks. Be forward-looking and data-driven. Focus on actionable predictions.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let predictions: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      predictions = JSON.parse(cleaned);
    } catch {
      predictions = [{ title: "Trend Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const pred of predictions) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.PREDICTION,
        category: pred.category || "general",
        title: pred.title || "Trend Prediction",
        summary: pred.summary || "",
        details: pred.details || "",
        priority: pred.priority || "medium",
        dataSnapshot: JSON.stringify({ metrics: data, topExperiments: expRows.slice(0, 5) }),
      });
      count++;
    }

    console.log(`[predictive-engine] Generated ${count} predictions for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[predictive-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runOptimizationEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[optimization-engine] Running for tenant ${tenantId}...`);

    const heartbeatPerformance = await db.execute(sql`
      SELECT task_name, status, COUNT(*) as count, AVG(duration_ms) as avg_duration
      FROM heartbeat_logs
      GROUP BY task_name, status
      ORDER BY count DESC LIMIT 20
    `).catch(() => ({ rows: [] }));
    const hbRows = (heartbeatPerformance as any).rows || heartbeatPerformance;

    const schedules = await db.execute(sql`
      SELECT name, cron_expression, is_enabled, last_run_at, run_all
      FROM research_schedules WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [] }));
    const schedRows = (schedules as any).rows || schedules;

    const taskConfig = await db.execute(sql`
      SELECT name, cron_expression, enabled, last_run_at FROM heartbeat_tasks
      WHERE enabled = true ORDER BY name
    `).catch(() => ({ rows: [] }));
    const taskRows = (taskConfig as any).rows || taskConfig;

    const emailActivity = await db.execute(sql`
      SELECT COUNT(*) as total FROM messages
      WHERE tenant_id = ${tenantId} AND role = 'assistant'
      AND created_at > NOW() - INTERVAL '7 days'
    `).catch(() => ({ rows: [{ total: 0 }] }));
    const emailRows = (emailActivity as any).rows || emailActivity;

    const data = await gatherOperationalData(tenantId);

    const prompt = `Analyze these workflow and process metrics, then recommend 3-5 specific optimizations.

HEARTBEAT TASK PERFORMANCE:
${hbRows.map((h: any) => `- ${h.task_name}: ${h.count} runs, ${h.status}, avg ${Math.round(h.avg_duration || 0)}ms`).join("\n") || "No task data"}

ACTIVE SCHEDULES:
${schedRows.map((s: any) => `- ${s.name}: ${s.cron_expression}, enabled: ${s.is_enabled}, run_all: ${s.run_all}, last: ${s.last_run_at || "never"}`).join("\n") || "No schedules"}

AUTOMATED TASKS:
${taskRows.map((t: any) => `- ${t.name}: ${t.cron_expression}, last: ${t.last_run_at || "never"}`).join("\n") || "No tasks"}

AI RESPONSE VOLUME:
- ${emailRows[0]?.total || 0} AI responses in last 7 days
- ${data.messages.week_messages} total messages this week
- Research: ${data.experiments.kept} kept / ${data.experiments.total} total experiments

OPTIMIZATION AREAS TO ANALYZE:
1. Email/communication workflow efficiency
2. Social media and content scheduling
3. Research program scheduling and model selection
4. Heartbeat task frequency and resource usage
5. Agent utilization and persona workload distribution

For each optimization, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [email_optimization, social_optimization, scheduling_optimization, resource_optimization, workflow_automation]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence optimization recommendation
5. DETAILS: Specific implementation steps and expected improvement

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a process optimization AI that specializes in improving automated workflows for an AI corporation platform. Analyze task performance, scheduling patterns, and resource utilization to suggest concrete optimizations. Focus on reducing waste, improving efficiency, and automating repetitive processes. Be specific about expected improvements.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let optimizations: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      optimizations = JSON.parse(cleaned);
    } catch {
      optimizations = [{ title: "Optimization Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const opt of optimizations) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.OPTIMIZATION,
        category: opt.category || "general",
        title: opt.title || "Process Optimization",
        summary: opt.summary || "",
        details: opt.details || "",
        priority: opt.priority || "medium",
        dataSnapshot: JSON.stringify({ heartbeat: hbRows.slice(0, 10), schedules: schedRows }),
      });
      count++;
    }

    console.log(`[optimization-engine] Generated ${count} optimizations for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[optimization-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runAllEngines(tenantId: number) {
  const results = {
    decision: await runDecisionEngine(tenantId),
    prediction: await runPredictiveEngine(tenantId),
    optimization: await runOptimizationEngine(tenantId),
  };
  const total = results.decision.insights + results.prediction.insights + results.optimization.insights;
  console.log(`[agentic-engines] All engines complete for tenant ${tenantId}: ${total} total insights`);
  // R63: catch any insights that bypassed storeInsight (legacy paths) and apply policy.
  await autoApplyEligibleInsights();
  return results;
}

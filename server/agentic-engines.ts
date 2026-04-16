import { db } from "./db";
import { sql } from "drizzle-orm";
import { getModelForTierAsync, getClientForModel, getAvailableModels } from "./providers";
import { executeWithFailover } from "./model-failover";

const ENGINE_TYPES = {
  DECISION: "decision",
  PREDICTION: "prediction",
  OPTIMIZATION: "optimization",
} as const;

async function storeInsight(params: {
  tenantId: number;
  engineType: string;
  category: string;
  title: string;
  summary: string;
  details?: string;
  priority: string;
  dataSnapshot?: string;
}) {
  const tenantId = params.tenantId ?? 1;
  const engineType = params.engineType || "unknown";
  const category = params.category || "general";
  const title = (params.title || "Insight").slice(0, 500);
  const summary = (params.summary || "").slice(0, 5000);
  const details = params.details ? params.details.slice(0, 10000) : null;
  const priority = params.priority || "medium";
  const dataSnapshot = params.dataSnapshot ? params.dataSnapshot.slice(0, 20000) : null;
  await db.execute(sql`
    INSERT INTO ai_insights (tenant_id, engine_type, category, title, summary, details, priority, data_snapshot)
    VALUES (${tenantId}, ${engineType}, ${category}, ${title},
            ${summary}, ${details}, ${priority}, ${dataSnapshot})
  `);
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
  return results;
}

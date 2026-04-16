import { db } from "./db";
import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export interface SculptorSessionParams {
  tenantId: number;
  title: string;
  task: string;
  plan?: string[];
  personaId?: number;
  model?: string;
  comparisonGroup?: string;
  parentSessionId?: number;
}

export interface SculptorSession {
  id: number;
  tenantId: number;
  title: string;
  task: string;
  plan: string[];
  personaId: number | null;
  model: string | null;
  status: string;
  conversationId: number | null;
  parentSessionId: number | null;
  comparisonGroup: string | null;
  result: string | null;
  reviewResult: any;
  toolCallsCount: number;
  tokensUsed: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function rowToSession(r: any): SculptorSession {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    title: r.title,
    task: r.task,
    plan: r.plan || [],
    personaId: r.persona_id,
    model: r.model,
    status: r.status,
    conversationId: r.conversation_id,
    parentSessionId: r.parent_session_id,
    comparisonGroup: r.comparison_group,
    result: r.result,
    reviewResult: r.review_result,
    toolCallsCount: r.tool_calls_count || 0,
    tokensUsed: r.tokens_used || 0,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function createAgentSession(params: SculptorSessionParams): Promise<{
  success: boolean;
  session?: SculptorSession;
  runId?: string;
  error?: string;
}> {
  if (!params.tenantId) return { success: false, error: "tenantId required" };
  if (!params.task || params.task.trim().length === 0) return { success: false, error: "task required" };

  const title = params.title || params.task.slice(0, 80);
  const plan = params.plan || [];
  const compGroup = params.comparisonGroup || null;

  const res = await db.execute(sql`
    INSERT INTO sculptor_sessions (tenant_id, title, task, plan, persona_id, model, status, comparison_group, parent_session_id, started_at)
    VALUES (${params.tenantId}, ${title}, ${params.task}, ${JSON.stringify(plan)}::jsonb, ${params.personaId || null}, ${params.model || null}, 'running', ${compGroup}, ${params.parentSessionId || null}, NOW())
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Failed to create session" };

  const session = rowToSession(rows[0]);

  const { launchAutonomousConversation } = await import("./agent-manager");
  const runResult = await launchAutonomousConversation({
    tenantId: params.tenantId,
    task: buildSessionPrompt(params.task, plan),
    personaId: params.personaId,
    model: params.model,
  });

  if (!runResult.success) {
    await db.execute(sql`
      UPDATE sculptor_sessions SET status = 'failed', result = ${"Launch failed: " + (runResult.error || "unknown")} WHERE id = ${session.id}
    `);
    return { success: false, error: "Failed to launch autonomous conversation", session };
  }

  if (runResult.conversationId) {
    await db.execute(sql`
      UPDATE sculptor_sessions SET conversation_id = ${runResult.conversationId} WHERE id = ${session.id}
    `);
    session.conversationId = runResult.conversationId;
  }

  monitorSession(session.id, runResult.runId, params.tenantId);

  return { success: true, session, runId: runResult.runId };
}

function buildSessionPrompt(task: string, plan: string[]): string {
  let prompt = task;
  if (plan.length > 0) {
    prompt += "\n\n**Execution Plan:**\n" + plan.map((step, i) => `${i + 1}. ${step}`).join("\n");
    prompt += "\n\nFollow this plan step by step. Report progress on each step.";
  }
  return prompt;
}

async function monitorSession(sessionId: number, runId: string, tenantId: number) {
  const { getAutonomousRun } = await import("./agent-manager");
  const checkInterval = setInterval(async () => {
    try {
      const run = getAutonomousRun(runId, tenantId);
      if (!run || run.status === "completed" || run.status === "failed" || run.status === "timeout") {
        clearInterval(checkInterval);

        let toolCount = 0;
        let tokens = 0;
        let resultText = run?.result || run?.error || "";

        if (run?.conversationId) {
          try {
            const msgRes = await db.execute(sql`
              SELECT COUNT(*) as cnt FROM messages m
              JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = ${tenantId}
              WHERE m.conversation_id = ${run.conversationId} AND m.role = 'tool'
            `);
            const msgRows = (msgRes as any).rows || msgRes;
            toolCount = parseInt(msgRows[0]?.cnt || "0");

            const tokenRes = await db.execute(sql`
              SELECT COALESCE(SUM(COALESCE((m.metadata->>'promptTokens')::int, 0) + COALESCE((m.metadata->>'completionTokens')::int, 0)), 0) as total
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = ${tenantId}
              WHERE m.conversation_id = ${run.conversationId} AND m.role = 'assistant'
            `);
            const tokenRows = (tokenRes as any).rows || tokenRes;
            tokens = parseInt(tokenRows[0]?.total || "0");
          } catch (err: any) {
            console.error(`[sculptor] monitorSession stats error for session ${sessionId}:`, err.message);
          }
        }

        await db.execute(sql`
          UPDATE sculptor_sessions
          SET status = ${run?.status || "failed"},
              result = ${resultText.slice(0, 10000)},
              tool_calls_count = ${toolCount},
              tokens_used = ${tokens},
              completed_at = NOW()
          WHERE id = ${sessionId}
        `);
      }
    } catch (err: any) {
      console.error(`[sculptor] monitorSession fatal error for session ${sessionId}:`, err.message);
      clearInterval(checkInterval);
    }
  }, 5000);

  setTimeout(() => clearInterval(checkInterval), 30 * 60 * 1000);
}

export async function launchParallelSessions(params: {
  tenantId: number;
  task: string;
  plan?: string[];
  variants: Array<{ title?: string; personaId?: number; model?: string }>;
}): Promise<{
  success: boolean;
  comparisonGroup: string;
  sessions: Array<{ sessionId: number; runId?: string; title: string }>;
}> {
  const comparisonGroup = `cmp-${uuid().slice(0, 8)}`;
  const sessions: Array<{ sessionId: number; runId?: string; title: string }> = [];

  for (const variant of params.variants) {
    const title = variant.title || `${params.task.slice(0, 40)} [${variant.model || "default"}]`;
    const result = await createAgentSession({
      tenantId: params.tenantId,
      title,
      task: params.task,
      plan: params.plan,
      personaId: variant.personaId,
      model: variant.model,
      comparisonGroup,
    });
    if (result.success && result.session) {
      sessions.push({ sessionId: result.session.id, runId: result.runId, title });
    }
  }

  return { success: true, comparisonGroup, sessions };
}

export async function compareSessionResults(comparisonGroup: string, tenantId: number): Promise<{
  success: boolean;
  group: string;
  sessions: Array<{
    id: number;
    title: string;
    status: string;
    model: string | null;
    personaId: number | null;
    toolCallsCount: number;
    tokensUsed: number;
    resultPreview: string;
    duration: string | null;
  }>;
  analysis?: string;
}> {
  const res = await db.execute(sql`
    SELECT * FROM sculptor_sessions
    WHERE comparison_group = ${comparisonGroup} AND tenant_id = ${tenantId}
    ORDER BY id
  `);
  const rows = (res as any).rows || res;
  if (!rows.length) return { success: false, group: comparisonGroup, sessions: [] };

  const sessions = rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    model: r.model,
    personaId: r.persona_id,
    toolCallsCount: r.tool_calls_count || 0,
    tokensUsed: r.tokens_used || 0,
    resultPreview: (r.result || "").slice(0, 500),
    duration: r.started_at && r.completed_at
      ? `${Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)}s`
      : null,
  }));

  const allDone = sessions.every((s: any) => s.status !== "running" && s.status !== "pending");

  let analysis: string | undefined;
  if (allDone && sessions.length >= 2) {
    try {
      const { callLlm } = await import("./chat-engine");
      const summaries = sessions.map((s: any) =>
        `**${s.title}** (${s.model || "default"}, ${s.duration || "?"}):\nTools: ${s.toolCallsCount}, Tokens: ${s.tokensUsed}\nResult: ${s.resultPreview}`
      ).join("\n\n---\n\n");

      const llmResult = await callLlm({
        messages: [
          { role: "system", content: "You are analyzing parallel AI agent session results. Compare quality, efficiency, and completeness. Be concise and actionable." },
          { role: "user", content: `Compare these ${sessions.length} parallel agent sessions that worked on the same task:\n\n${summaries}\n\nWhich produced the best result and why? Rate each on quality (1-10), efficiency (1-10), and completeness (1-10).` }
        ],
        model: "fast",
        tenantId,
      });
      analysis = typeof llmResult === "string" ? llmResult : (llmResult as any)?.content || JSON.stringify(llmResult);
    } catch (err: any) {
      analysis = `Comparison analysis unavailable: ${err.message}`;
    }
  }

  return { success: true, group: comparisonGroup, sessions, analysis };
}

export async function reviewSessionWork(sessionId: number, tenantId: number): Promise<{
  success: boolean;
  review?: {
    verdict: "approve" | "revise" | "reject";
    score: number;
    strengths: string[];
    issues: string[];
    suggestions: string[];
    summary: string;
  };
  error?: string;
}> {
  const res = await db.execute(sql`
    SELECT * FROM sculptor_sessions WHERE id = ${sessionId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Session not found" };

  const session = rows[0];
  if (session.status === "running" || session.status === "pending") {
    return { success: false, error: "Session still running — wait for completion" };
  }

  let conversationContext = "";
  if (session.conversation_id) {
    try {
      const msgRes = await db.execute(sql`
        SELECT m.role, m.content FROM messages m
        JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = ${tenantId}
        WHERE m.conversation_id = ${session.conversation_id}
        ORDER BY m.created_at
        LIMIT 30
      `);
      const msgs = (msgRes as any).rows || msgRes;
      conversationContext = msgs.map((m: any) => `[${m.role}]: ${(m.content || "").slice(0, 500)}`).join("\n\n");
    } catch (err: any) {
      console.error(`[sculptor] reviewSessionWork message fetch error for session ${sessionId}:`, err.message);
    }
  }

  try {
    const { callLlm } = await import("./chat-engine");
    const reviewPrompt = `Review this AI agent session's work:

**Task:** ${session.task}
**Plan:** ${JSON.stringify(session.plan || [])}
**Result:** ${(session.result || "No result").slice(0, 3000)}
**Tool Calls:** ${session.tool_calls_count}
**Tokens Used:** ${session.tokens_used}

${conversationContext ? `**Conversation Excerpt:**\n${conversationContext.slice(0, 4000)}` : ""}

Evaluate the work and respond in this exact JSON format:
{
  "verdict": "approve" | "revise" | "reject",
  "score": 1-10,
  "strengths": ["..."],
  "issues": ["..."],
  "suggestions": ["..."],
  "summary": "..."
}`;

    const llmResult = await callLlm({
      messages: [
        { role: "system", content: "You are Proof, a meticulous AI quality reviewer. Evaluate agent work objectively. Respond ONLY with valid JSON." },
        { role: "user", content: reviewPrompt }
      ],
      model: "balanced",
      tenantId,
    });

    const text = typeof llmResult === "string" ? llmResult : (llmResult as any)?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const review = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: "revise", score: 5, strengths: [], issues: ["Could not parse review"], suggestions: [], summary: text.slice(0, 500) };

    await db.execute(sql`
      UPDATE sculptor_sessions SET review_result = ${JSON.stringify(review)}::jsonb WHERE id = ${sessionId}
    `);

    return { success: true, review };
  } catch (err: any) {
    return { success: false, error: `Review failed: ${err.message}` };
  }
}

export async function getSessionReplay(sessionId: number, tenantId: number): Promise<{
  success: boolean;
  session?: SculptorSession;
  timeline?: Array<{
    timestamp: string;
    type: "message" | "tool_call" | "tool_result";
    role?: string;
    content?: string;
    toolName?: string;
    duration?: number;
  }>;
  error?: string;
}> {
  const res = await db.execute(sql`
    SELECT * FROM sculptor_sessions WHERE id = ${sessionId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Session not found" };

  const session = rowToSession(rows[0]);
  const timeline: any[] = [];

  if (session.conversationId) {
    try {
      const msgRes = await db.execute(sql`
        SELECT m.role, m.content, m.tool_name, m.created_at,
               COALESCE((m.metadata->>'promptTokens')::int, 0) + COALESCE((m.metadata->>'completionTokens')::int, 0) as tokens
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = ${tenantId}
        WHERE m.conversation_id = ${session.conversationId}
        ORDER BY m.created_at
        LIMIT 100
      `);
      const msgs = (msgRes as any).rows || msgRes;

      for (const msg of msgs) {
        if (msg.role === "tool") {
          timeline.push({
            timestamp: new Date(msg.created_at).toISOString(),
            type: "tool_result",
            toolName: msg.tool_name || "unknown",
            content: (msg.content || "").slice(0, 300),
          });
        } else if (msg.role === "assistant" && msg.tool_name) {
          timeline.push({
            timestamp: new Date(msg.created_at).toISOString(),
            type: "tool_call",
            toolName: msg.tool_name,
            content: (msg.content || "").slice(0, 300),
          });
        } else {
          timeline.push({
            timestamp: new Date(msg.created_at).toISOString(),
            type: "message",
            role: msg.role,
            content: (msg.content || "").slice(0, 500),
          });
        }
      }
    } catch (err: any) {
      console.error(`[sculptor] getSessionReplay message fetch error for session ${sessionId}:`, err.message);
    }
  }

  return { success: true, session, timeline };
}

export async function listSessions(tenantId: number, opts?: {
  status?: string;
  comparisonGroup?: string;
  limit?: number;
}): Promise<SculptorSession[]> {
  const lim = Math.min(opts?.limit || 50, 100);
  const statusFilter = opts?.status || null;
  const groupFilter = opts?.comparisonGroup || null;

  const res = await db.execute(sql`
    SELECT * FROM sculptor_sessions
    WHERE tenant_id = ${tenantId}
      AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (${groupFilter}::text IS NULL OR comparison_group = ${groupFilter})
    ORDER BY created_at DESC
    LIMIT ${lim}
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToSession);
}

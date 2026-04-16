import { db } from "./db";
import { sql } from "drizzle-orm";

export interface MindConfig {
  idle_event_delay_minutes?: number[];
  welcome_message?: string;
  is_message_batching_enabled?: boolean;
}

export interface Mind {
  id: number;
  tenantId: number;
  name: string;
  purpose: string;
  soul: string;
  status: string;
  config: MindConfig;
  talkingPersonaId: number | null;
  thinkingPersonaId: number | null;
  maxConcurrentWorkers: number;
  memory: Record<string, any>;
  workLog: Array<{ timestamp: string; entry: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface MindTicket {
  id: number;
  mindId: number;
  tenantId: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: number;
  ticketType: string;
  status: string;
  assignedAgentId: string | null;
  dependsOn: number[];
  result: any;
  verdict: { verdict: "PASSED" | "FAILED"; confidence: number; reasoning: string } | null;
  nextSteps: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MindEvent {
  id: number;
  mindId: number;
  tenantId: number;
  eventType: string;
  source: string;
  payload: Record<string, any>;
  handled: boolean;
  handledAt: string | null;
  createdAt: string;
}

function rowToMind(r: any): Mind {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    purpose: r.purpose,
    soul: r.soul,
    status: r.status,
    config: r.config || {},
    talkingPersonaId: r.talking_persona_id,
    thinkingPersonaId: r.thinking_persona_id,
    maxConcurrentWorkers: r.max_concurrent_workers || 5,
    memory: r.memory || {},
    workLog: r.work_log || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToTicket(r: any): MindTicket {
  return {
    id: r.id,
    mindId: r.mind_id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    acceptanceCriteria: r.acceptance_criteria || "",
    priority: r.priority,
    ticketType: r.ticket_type,
    status: r.status,
    assignedAgentId: r.assigned_agent_id,
    dependsOn: r.depends_on || [],
    result: r.result,
    verdict: r.verdict,
    nextSteps: r.next_steps,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToEvent(r: any): MindEvent {
  return {
    id: r.id,
    mindId: r.mind_id,
    tenantId: r.tenant_id,
    eventType: r.event_type,
    source: r.source,
    payload: r.payload || {},
    handled: r.handled,
    handledAt: r.handled_at,
    createdAt: r.created_at,
  };
}

export async function createMind(params: {
  tenantId: number;
  name: string;
  purpose: string;
  soul?: string;
  config?: MindConfig;
  talkingPersonaId?: number;
  thinkingPersonaId?: number;
  maxConcurrentWorkers?: number;
}): Promise<{ success: boolean; mind?: Mind; error?: string }> {
  if (!params.tenantId) return { success: false, error: "tenantId required" };
  if (!params.name?.trim()) return { success: false, error: "name required" };
  if (!params.purpose?.trim()) return { success: false, error: "purpose required" };

  const res = await db.execute(sql`
    INSERT INTO minds (tenant_id, name, purpose, soul, config, talking_persona_id, thinking_persona_id, max_concurrent_workers)
    VALUES (
      ${params.tenantId},
      ${params.name.slice(0, 200)},
      ${params.purpose.slice(0, 4000)},
      ${(params.soul || "You are loyal, helpful, honest, reliable, and trustworthy.").slice(0, 2000)},
      ${JSON.stringify(params.config || {})}::jsonb,
      ${params.talkingPersonaId || null},
      ${params.thinkingPersonaId || null},
      ${Math.min(params.maxConcurrentWorkers || 5, 20)}
    )
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Failed to create mind" };
  return { success: true, mind: rowToMind(rows[0]) };
}

export async function getMind(mindId: number, tenantId: number): Promise<Mind | null> {
  const res = await db.execute(sql`
    SELECT * FROM minds WHERE id = ${mindId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? rowToMind(rows[0]) : null;
}

export async function listMinds(tenantId: number): Promise<Mind[]> {
  const res = await db.execute(sql`
    SELECT * FROM minds WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToMind);
}

export async function updateMind(mindId: number, tenantId: number, updates: {
  name?: string;
  purpose?: string;
  soul?: string;
  status?: string;
  config?: MindConfig;
  maxConcurrentWorkers?: number;
}): Promise<{ success: boolean; mind?: Mind; error?: string }> {
  const mind = await getMind(mindId, tenantId);
  if (!mind) return { success: false, error: "Mind not found" };

  const res = await db.execute(sql`
    UPDATE minds SET
      name = ${updates.name?.slice(0, 200) || mind.name},
      purpose = ${updates.purpose?.slice(0, 4000) || mind.purpose},
      soul = ${updates.soul?.slice(0, 2000) || mind.soul},
      status = ${updates.status || mind.status},
      config = ${JSON.stringify(updates.config || mind.config)}::jsonb,
      max_concurrent_workers = ${Math.min(updates.maxConcurrentWorkers || mind.maxConcurrentWorkers, 20)},
      updated_at = NOW()
    WHERE id = ${mindId} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true, mind: rowToMind(rows[0]) } : { success: false, error: "Update failed" };
}

export async function createTicket(params: {
  mindId: number;
  tenantId: number;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  priority?: number;
  ticketType?: string;
  dependsOn?: number[];
}): Promise<{ success: boolean; ticket?: MindTicket; error?: string }> {
  const mind = await getMind(params.mindId, params.tenantId);
  if (!mind) return { success: false, error: "Mind not found" };
  if (!params.title?.trim()) return { success: false, error: "title required" };

  const priority = Math.max(0, Math.min(params.priority ?? 2, 3));
  const res = await db.execute(sql`
    INSERT INTO mind_tickets (mind_id, tenant_id, title, description, acceptance_criteria, priority, ticket_type, depends_on)
    VALUES (
      ${params.mindId},
      ${params.tenantId},
      ${params.title.slice(0, 500)},
      ${(params.description || "").slice(0, 4000)},
      ${(params.acceptanceCriteria || "").slice(0, 2000)},
      ${priority},
      ${(params.ticketType || "task").slice(0, 50)},
      ${params.dependsOn && params.dependsOn.length > 0 ? `{${params.dependsOn.join(",")}}` : null}
    )
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Failed to create ticket" };
  return { success: true, ticket: rowToTicket(rows[0]) };
}

export async function listTickets(mindId: number, tenantId: number, opts?: {
  status?: string;
  priority?: number;
}): Promise<MindTicket[]> {
  const statusFilter = opts?.status || null;
  const priorityFilter = opts?.priority ?? null;

  const res = await db.execute(sql`
    SELECT * FROM mind_tickets
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId}
      AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (${priorityFilter}::int IS NULL OR priority = ${priorityFilter})
    ORDER BY priority ASC, created_at ASC
    LIMIT 100
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToTicket);
}

export async function getReadyTickets(mindId: number, tenantId: number): Promise<MindTicket[]> {
  const allTickets = await listTickets(mindId, tenantId, { status: "ready" });

  const readyTickets: MindTicket[] = [];
  for (const t of allTickets) {
    if (!t.dependsOn || t.dependsOn.length === 0) {
      readyTickets.push(t);
    } else {
      const depsMet = await checkDependenciesMet(t, tenantId);
      if (depsMet) readyTickets.push(t);
    }
  }
  return readyTickets;
}

async function checkDependenciesMet(ticket: MindTicket, tenantId: number): Promise<boolean> {
  if (!ticket.dependsOn || ticket.dependsOn.length === 0) return true;

  const res = await db.execute(sql`
    SELECT id, status FROM mind_tickets
    WHERE id = ANY(${`{${ticket.dependsOn.join(",")}}`}::int[])
      AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  return rows.every((r: any) => r.status === "done" || r.status === "passed");
}

export async function updateTicketStatus(ticketId: number, tenantId: number, status: string, extras?: {
  assignedAgentId?: string;
  result?: any;
  verdict?: { verdict: "PASSED" | "FAILED"; confidence: number; reasoning: string };
  nextSteps?: string;
}): Promise<{ success: boolean; ticket?: MindTicket; error?: string }> {
  const validStatuses = ["ready", "in_progress", "blocked", "done", "passed", "failed", "cancelled"];
  if (!validStatuses.includes(status)) return { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` };

  const res = await db.execute(sql`
    UPDATE mind_tickets SET
      status = ${status},
      assigned_agent_id = COALESCE(${extras?.assignedAgentId || null}, assigned_agent_id),
      result = COALESCE(${extras?.result ? JSON.stringify(extras.result) : null}::jsonb, result),
      verdict = COALESCE(${extras?.verdict ? JSON.stringify(extras.verdict) : null}::jsonb, verdict),
      next_steps = COALESCE(${extras?.nextSteps || null}, next_steps),
      updated_at = NOW()
    WHERE id = ${ticketId} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true, ticket: rowToTicket(rows[0]) } : { success: false, error: "Ticket not found" };
}

export async function emitEvent(params: {
  mindId: number;
  tenantId: number;
  eventType: string;
  source: string;
  payload?: Record<string, any>;
}): Promise<{ success: boolean; event?: MindEvent; error?: string }> {
  if (!params.eventType?.trim()) return { success: false, error: "eventType required" };

  const res = await db.execute(sql`
    INSERT INTO mind_events (mind_id, tenant_id, event_type, source, payload)
    VALUES (${params.mindId}, ${params.tenantId}, ${params.eventType.slice(0, 100)}, ${(params.source || "system").slice(0, 200)}, ${JSON.stringify(params.payload || {})}::jsonb)
    RETURNING *
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Failed to emit event" };
  return { success: true, event: rowToEvent(rows[0]) };
}

export async function getUnhandledEvents(mindId: number, tenantId: number, limit: number = 20): Promise<MindEvent[]> {
  const res = await db.execute(sql`
    SELECT * FROM mind_events
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId} AND handled = FALSE
    ORDER BY created_at ASC
    LIMIT ${Math.min(limit, 100)}
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToEvent);
}

export async function markEventsHandled(eventIds: number[], tenantId: number): Promise<number> {
  if (!eventIds.length) return 0;
  const res = await db.execute(sql`
    UPDATE mind_events SET handled = TRUE, handled_at = NOW()
    WHERE id = ANY(${`{${eventIds.join(",")}}`}::int[]) AND tenant_id = ${tenantId}
  `);
  return (res as any).rowCount || 0;
}

export async function delegateTicketToWorker(ticketId: number, tenantId: number, opts?: {
  personaId?: number;
  model?: string;
}): Promise<{ success: boolean; runId?: string; conversationId?: number; error?: string }> {
  const res = await db.execute(sql`
    SELECT t.*, m.name as mind_name, m.purpose as mind_purpose, m.soul as mind_soul
    FROM mind_tickets t
    JOIN minds m ON m.id = t.mind_id AND m.tenant_id = ${tenantId}
    WHERE t.id = ${ticketId} AND t.tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Ticket not found" };

  const ticket = rows[0];
  if (ticket.status !== "ready") return { success: false, error: `Ticket status is '${ticket.status}', expected 'ready'` };

  const depsMet = await checkDependenciesMet(rowToTicket(ticket), tenantId);
  if (!depsMet) return { success: false, error: "Ticket dependencies not yet met" };

  const taskPrompt = `# Task: ${ticket.title}

## Context
You are working as part of the "${ticket.mind_name}" Mind system.
Purpose: ${ticket.mind_purpose}
Soul: ${ticket.mind_soul}

## What to do
${ticket.description}

## Success criteria
${ticket.acceptance_criteria || "Complete the task as described above."}

## Output
When you finish, provide:
1. A summary of what you did
2. Any artifacts or results produced
3. Any open questions or issues
4. Your assessment of whether the task is complete`;

  const { launchAutonomousConversation } = await import("./agent-manager");
  const runResult = await launchAutonomousConversation({
    tenantId,
    task: taskPrompt,
    personaId: opts?.personaId,
    model: opts?.model,
  });

  if (!runResult.success) {
    await updateTicketStatus(ticketId, tenantId, "failed", {
      result: { error: "Failed to launch worker: " + (runResult.error || "unknown") },
    });
    return { success: false, error: "Failed to launch worker" };
  }

  await updateTicketStatus(ticketId, tenantId, "in_progress", {
    assignedAgentId: runResult.runId,
  });

  monitorTicketWorker(ticketId, tenantId, runResult.runId, ticket.mind_id);

  return { success: true, runId: runResult.runId, conversationId: runResult.conversationId };
}

function monitorTicketWorker(ticketId: number, tenantId: number, runId: string, mindId: number) {
  const { getAutonomousRun } = require("./agent-manager");
  const checkInterval = setInterval(async () => {
    try {
      const run = getAutonomousRun(runId, tenantId);
      if (!run || run.status === "completed" || run.status === "failed" || run.status === "timeout") {
        clearInterval(checkInterval);

        const resultText = run?.result || run?.error || "No result";
        await updateTicketStatus(ticketId, tenantId, "done", {
          result: { output: resultText.slice(0, 10000), workerStatus: run?.status || "unknown" },
        });

        await emitEvent({
          mindId,
          tenantId,
          eventType: "worker_completed",
          source: "mngr/agent_states",
          payload: {
            ticketId,
            runId,
            status: run?.status || "unknown",
            resultPreview: resultText.slice(0, 500),
          },
        });
      }
    } catch (err: any) {
      console.error(`[minds] monitorTicketWorker error for ticket ${ticketId}:`, err.message);
      clearInterval(checkInterval);
    }
  }, 5000);

  setTimeout(() => clearInterval(checkInterval), 30 * 60 * 1000);
}

export async function verifyTicketResult(ticketId: number, tenantId: number): Promise<{
  success: boolean;
  verdict?: { verdict: "PASSED" | "FAILED"; confidence: number; reasoning: string };
  nextSteps?: string;
  error?: string;
}> {
  const res = await db.execute(sql`
    SELECT t.*, m.purpose as mind_purpose
    FROM mind_tickets t
    JOIN minds m ON m.id = t.mind_id AND m.tenant_id = ${tenantId}
    WHERE t.id = ${ticketId} AND t.tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  if (!rows[0]) return { success: false, error: "Ticket not found" };

  const ticket = rows[0];
  if (ticket.status !== "done") return { success: false, error: `Ticket status is '${ticket.status}', expected 'done'` };

  const result = ticket.result || {};

  let workerTranscript = "";
  if (ticket.assigned_agent_id) {
    try {
      const { getAutonomousRun } = await import("./agent-manager");
      const run = getAutonomousRun(ticket.assigned_agent_id, tenantId);
      if (run?.conversationId) {
        const msgRes = await db.execute(sql`
          SELECT m.role, m.content FROM messages m
          JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = ${tenantId}
          WHERE m.conversation_id = ${run.conversationId}
          ORDER BY m.created_at DESC
          LIMIT 10
        `);
        const msgs = (msgRes as any).rows || msgRes;
        workerTranscript = msgs.reverse().map((m: any) => `[${m.role}]: ${(m.content || "").slice(0, 500)}`).join("\n\n");
      }
    } catch (err: any) {
      console.error(`[minds] verifyTicketResult transcript fetch error for ticket ${ticketId}:`, err.message);
    }
  }

  try {
    const { callLlm } = await import("./chat-engine");
    const verifyPrompt = `You are a verifying agent. Your job is to judge whether a task was accomplished correctly.

## Original Task
**Title:** ${ticket.title}
**Description:** ${ticket.description}
**Acceptance Criteria:** ${ticket.acceptance_criteria || "Not specified"}
**Mind Purpose:** ${ticket.mind_purpose}

## Worker Output
${JSON.stringify(result.output || result).slice(0, 4000)}

${workerTranscript ? `## Worker Conversation (last 10 messages)\n${workerTranscript.slice(0, 4000)}` : ""}

## Your Task
1. Evaluate whether the task was completed successfully based on the acceptance criteria
2. Assign a confidence score (0.0 to 1.0) for your judgment
3. List concrete next steps (even if PASSED, note any follow-up items)

Respond in this exact JSON format:
{
  "verdict": "PASSED" or "FAILED",
  "confidence": 0.0-1.0,
  "reasoning": "explanation",
  "next_steps": "concrete list of what to do next"
}`;

    const llmResult = await callLlm({
      messages: [
        { role: "system", content: "You are a rigorous quality verifier. If the task did not clearly pass, it has FAILED. Be specific and actionable." },
        { role: "user", content: verifyPrompt }
      ],
      model: "fast",
      tenantId,
    });

    const responseText = typeof llmResult === "string" ? llmResult : (llmResult as any)?.content || JSON.stringify(llmResult);

    let parsed: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return { success: false, error: "Verifier produced non-parseable response" };
    }

    const verdict = {
      verdict: parsed.verdict === "PASSED" ? "PASSED" as const : "FAILED" as const,
      confidence: Math.max(0, Math.min(parseFloat(parsed.confidence) || 0.5, 1)),
      reasoning: (parsed.reasoning || "").slice(0, 2000),
    };
    const nextSteps = (parsed.next_steps || "").slice(0, 2000);

    const newStatus = verdict.verdict === "PASSED" ? "passed" : "failed";
    await updateTicketStatus(ticketId, tenantId, newStatus, { verdict, nextSteps });

    const ticketRes = await db.execute(sql`
      SELECT mind_id FROM mind_tickets WHERE id = ${ticketId} AND tenant_id = ${tenantId}
    `);
    const ticketRows = (ticketRes as any).rows || ticketRes;
    if (ticketRows[0]) {
      await emitEvent({
        mindId: ticketRows[0].mind_id,
        tenantId,
        eventType: "verification_complete",
        source: "mngr/verification",
        payload: { ticketId, verdict: verdict.verdict, confidence: verdict.confidence },
      });
    }

    return { success: true, verdict, nextSteps };
  } catch (err: any) {
    console.error(`[minds] verifyTicketResult LLM error for ticket ${ticketId}:`, err.message);
    return { success: false, error: `Verification failed: ${err.message}` };
  }
}

export async function processIdleCheck(mindId: number, tenantId: number): Promise<{
  actions: string[];
  unhandledEvents: number;
  readyTickets: number;
  activeWorkers: number;
}> {
  const mind = await getMind(mindId, tenantId);
  if (!mind) return { actions: ["Mind not found"], unhandledEvents: 0, readyTickets: 0, activeWorkers: 0 };

  const actions: string[] = [];

  const unhandled = await getUnhandledEvents(mindId, tenantId);

  const ready = await getReadyTickets(mindId, tenantId);

  let activeWorkers = 0;
  const inProgressRes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM mind_tickets
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId} AND status = 'in_progress'
  `);
  const ipRows = (inProgressRes as any).rows || inProgressRes;
  activeWorkers = parseInt(ipRows[0]?.cnt || "0");

  if (unhandled.length > 0) {
    actions.push(`${unhandled.length} unhandled event(s) need processing`);
  }

  if (ready.length > 0 && activeWorkers < mind.maxConcurrentWorkers) {
    const capacity = mind.maxConcurrentWorkers - activeWorkers;
    actions.push(`${ready.length} ready ticket(s), ${capacity} worker slot(s) available`);
  }

  if (activeWorkers > 0) {
    actions.push(`${activeWorkers} worker(s) currently active — monitor for completion`);
  }

  const doneUnverified = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM mind_tickets
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId} AND status = 'done'
  `);
  const duRows = (doneUnverified as any).rows || doneUnverified;
  const unverifiedCount = parseInt(duRows[0]?.cnt || "0");
  if (unverifiedCount > 0) {
    actions.push(`${unverifiedCount} completed ticket(s) awaiting verification`);
  }

  if (actions.length === 0) {
    actions.push("All clear — no pending work");
  }

  return {
    actions,
    unhandledEvents: unhandled.length,
    readyTickets: ready.length,
    activeWorkers,
  };
}

export async function updateMemory(mindId: number, tenantId: number, key: string, value: any): Promise<{ success: boolean; error?: string }> {
  if (!key?.trim()) return { success: false, error: "key required" };

  const mind = await getMind(mindId, tenantId);
  if (!mind) return { success: false, error: "Mind not found" };

  const newMemory = { ...mind.memory, [key]: value };

  await db.execute(sql`
    UPDATE minds SET memory = ${JSON.stringify(newMemory)}::jsonb, updated_at = NOW()
    WHERE id = ${mindId} AND tenant_id = ${tenantId}
  `);

  return { success: true };
}

export async function appendWorkLog(mindId: number, tenantId: number, entry: string): Promise<{ success: boolean }> {
  const logEntry = { timestamp: new Date().toISOString(), entry: entry.slice(0, 500) };

  await db.execute(sql`
    UPDATE minds SET
      work_log = (
        SELECT jsonb_agg(elem) FROM (
          SELECT elem FROM jsonb_array_elements(COALESCE(work_log, '[]'::jsonb)) AS elem
          UNION ALL
          SELECT ${JSON.stringify(logEntry)}::jsonb
        ) sub
      ),
      updated_at = NOW()
    WHERE id = ${mindId} AND tenant_id = ${tenantId}
  `);

  return { success: true };
}

export async function getMindDashboard(mindId: number, tenantId: number): Promise<{
  mind: Mind | null;
  ticketSummary: { ready: number; inProgress: number; done: number; passed: number; failed: number; total: number };
  recentEvents: MindEvent[];
  activeWorkers: number;
}> {
  const mind = await getMind(mindId, tenantId);
  if (!mind) return {
    mind: null,
    ticketSummary: { ready: 0, inProgress: 0, done: 0, passed: 0, failed: 0, total: 0 },
    recentEvents: [],
    activeWorkers: 0,
  };

  const ticketRes = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM mind_tickets
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId}
    GROUP BY status
  `);
  const ticketRows = (ticketRes as any).rows || ticketRes;
  const summary = { ready: 0, inProgress: 0, done: 0, passed: 0, failed: 0, total: 0 };
  for (const row of ticketRows) {
    const count = parseInt(row.cnt || "0");
    summary.total += count;
    if (row.status === "ready") summary.ready = count;
    else if (row.status === "in_progress") summary.inProgress = count;
    else if (row.status === "done") summary.done = count;
    else if (row.status === "passed") summary.passed = count;
    else if (row.status === "failed") summary.failed = count;
  }

  const eventRes = await db.execute(sql`
    SELECT * FROM mind_events
    WHERE mind_id = ${mindId} AND tenant_id = ${tenantId}
    ORDER BY created_at DESC LIMIT 10
  `);
  const eventRows = (eventRes as any).rows || eventRes;

  return {
    mind,
    ticketSummary: summary,
    recentEvents: eventRows.map(rowToEvent),
    activeWorkers: summary.inProgress,
  };
}

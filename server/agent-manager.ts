import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { processMessage } from "./chat-engine";
import { getSubagentRuns, type SubagentRun } from "./subagents";
import { getTasksByTenant, type BackgroundTask } from "./background-tasks";

export interface AutonomousRun {
  id: string;
  tenantId: number;
  conversationId: number;
  personaId: number | null;
  model: string;
  task: string;
  status: "running" | "completed" | "failed" | "timeout";
  createdAt: number;
  completedAt: number | null;
  result: string | null;
  error: string | null;
  messagesProcessed: number;
}

const autonomousRuns = new Map<string, AutonomousRun>();
const MAX_AUTONOMOUS_PER_TENANT = 3;
const AUTONOMOUS_TIMEOUT_MS = 10 * 60 * 1000;

export async function launchAutonomousConversation(params: {
  tenantId: number;
  task: string;
  personaId?: number;
  model?: string;
}): Promise<{ success: boolean; runId?: string; conversationId?: number; error?: string }> {
  const tenantRuns = Array.from(autonomousRuns.values())
    .filter(r => r.tenantId === params.tenantId && r.status === "running");
  if (tenantRuns.length >= MAX_AUTONOMOUS_PER_TENANT) {
    return { success: false, error: `Limit reached (${MAX_AUTONOMOUS_PER_TENANT} concurrent autonomous runs)` };
  }

  const { getModelForTierAsync } = await import("./providers");
  const model = params.model || await getModelForTierAsync("balanced").catch(() => "gemini-2.5-flash");

  const conv = await storage.createConversation({
    title: `[Autonomous] ${params.task.slice(0, 80)}`,
    model,
    personaId: params.personaId || null,
    tenantId: params.tenantId,
  });

  const runId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const run: AutonomousRun = {
    id: runId,
    tenantId: params.tenantId,
    conversationId: conv.id,
    personaId: params.personaId || null,
    model,
    task: params.task,
    status: "running",
    createdAt: Date.now(),
    completedAt: null,
    result: null,
    error: null,
    messagesProcessed: 0,
  };

  autonomousRuns.set(runId, run);
  console.log(`[agent-manager] Autonomous run ${runId} started: "${params.task.slice(0, 80)}" (conv ${conv.id})`);

  const timeoutHandle = setTimeout(() => {
    if (run.status === "running") {
      run.status = "timeout";
      run.completedAt = Date.now();
      run.error = "Exceeded maximum execution time";
      console.log(`[agent-manager] Autonomous run ${runId} timed out after ${AUTONOMOUS_TIMEOUT_MS / 1000}s`);
    }
  }, AUTONOMOUS_TIMEOUT_MS);

  setImmediate(async () => {
    try {
      const result = await processMessage(
        conv.id,
        params.task,
        { source: `autonomous:${runId}`, enableTools: true, depth: 1 }
      );

      run.messagesProcessed = 1;
      run.result = typeof result === "string"
        ? result
        : (result as any)?.text || (result as any)?.response || JSON.stringify(result).slice(0, 2000);
      run.status = "completed";
      run.completedAt = Date.now();

      const elapsed = Math.round((run.completedAt - run.createdAt) / 1000);
      console.log(`[agent-manager] Autonomous run ${runId} completed in ${elapsed}s`);

      try {
        const { postMessage } = await import("./agent-channels");
        await postMessage({
          tenantId: params.tenantId,
          channelName: "operations",
          fromPersonaId: params.personaId || 1,
          content: `**Autonomous Task Complete** (${elapsed}s)\n\n**Task:** ${params.task.slice(0, 200)}\n\n**Result:** ${(run.result || "").slice(0, 500)}`,
        });
      } catch (channelErr: any) {
        console.warn(`[agent-manager] Failed to post to operations channel:`, channelErr?.message);
      }
    } catch (err: any) {
      run.status = "failed";
      run.error = err.message;
      run.completedAt = Date.now();
      console.error(`[agent-manager] Autonomous run ${runId} failed:`, err.message);
    } finally {
      clearTimeout(timeoutHandle);
    }
  });

  return { success: true, runId, conversationId: conv.id };
}

export function getAutonomousRun(runId: string, tenantId: number): AutonomousRun | null {
  const run = autonomousRuns.get(runId);
  if (!run || run.tenantId !== tenantId) return null;
  return run;
}

export function getAutonomousRunsByTenant(tenantId: number): AutonomousRun[] {
  return Array.from(autonomousRuns.values())
    .filter(r => r.tenantId === tenantId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function forkConversation(
  sourceConversationId: number,
  tenantId: number,
  options?: { messageLimit?: number; newTitle?: string }
): Promise<{ success: boolean; newConversationId?: number; messagesCopied?: number; error?: string }> {
  const sourceConv = await storage.getConversation(sourceConversationId);
  if (!sourceConv) return { success: false, error: "Source conversation not found" };
  if (sourceConv.tenantId !== tenantId) return { success: false, error: "Access denied" };

  const newConv = await storage.createConversation({
    title: options?.newTitle || `[Fork] ${sourceConv.title || "Untitled"}`,
    model: sourceConv.model,
    personaId: sourceConv.personaId,
    tenantId,
  });

  const messages = await storage.getMessages(sourceConversationId);
  const limit = options?.messageLimit || messages.length;
  const toCopy = messages.slice(0, limit);

  let copied = 0;
  for (const msg of toCopy) {
    await storage.createMessage({
      conversationId: newConv.id,
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
      model: msg.model,
      personaId: msg.personaId,
      tokenUsage: msg.tokenUsage,
    });
    copied++;
  }

  console.log(`[agent-manager] Forked conversation ${sourceConversationId} → ${newConv.id} (${copied} messages)`);

  return { success: true, newConversationId: newConv.id, messagesCopied: copied };
}

export interface UnifiedAgentStatus {
  summary: {
    totalActive: number;
    subagentsRunning: number;
    backgroundTasksRunning: number;
    autonomousRunsRunning: number;
    heartbeatTasksActive: number;
  };
  subagents: Array<{
    id: string;
    label: string;
    status: string;
    task: string;
    model: string | undefined;
    elapsed: number;
    depth: number;
  }>;
  backgroundTasks: Array<{
    id: string;
    toolName: string;
    status: string;
    elapsed: number;
    progress: string[];
  }>;
  autonomousRuns: Array<{
    id: string;
    task: string;
    status: string;
    personaId: number | null;
    model: string;
    conversationId: number;
    elapsed: number;
    messagesProcessed: number;
  }>;
  heartbeatTasks: Array<{
    id: number;
    name: string;
    type: string;
    enabled: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastStatus: string | null;
  }>;
}

export async function getUnifiedAgentStatus(tenantId: number): Promise<UnifiedAgentStatus> {
  const now = Date.now();

  const subagentRuns = getSubagentRuns();
  const subagents = subagentRuns.map(r => ({
    id: r.id,
    label: r.label,
    status: r.status,
    task: r.task.slice(0, 150),
    model: r.model,
    elapsed: Math.round((now - r.createdAt) / 1000),
    depth: r.depth,
  }));

  const bgTasks = getTasksByTenant(tenantId);
  const backgroundTasks = bgTasks.map(t => ({
    id: t.id,
    toolName: t.toolName,
    status: t.status,
    elapsed: Math.round(((t.completedAt || now) - t.createdAt) / 1000),
    progress: t.progressUpdates.slice(-3),
  }));

  const autoRuns = getAutonomousRunsByTenant(tenantId);
  const autonomousRunsData = autoRuns.map(r => ({
    id: r.id,
    task: r.task.slice(0, 150),
    status: r.status,
    personaId: r.personaId,
    model: r.model,
    conversationId: r.conversationId,
    elapsed: Math.round(((r.completedAt || now) - r.createdAt) / 1000),
    messagesProcessed: r.messagesProcessed,
  }));

  let heartbeatTasks: UnifiedAgentStatus["heartbeatTasks"] = [];
  try {
    const result = await db.execute(sql`
      SELECT ht.id, ht.name, ht.type, ht.enabled, ht.next_run_at,
        (SELECT hl.status FROM heartbeat_logs hl WHERE hl.task_id = ht.id ORDER BY hl.created_at DESC LIMIT 1) as last_status,
        (SELECT hl.created_at FROM heartbeat_logs hl WHERE hl.task_id = ht.id ORDER BY hl.created_at DESC LIMIT 1) as last_run_at
      FROM heartbeat_tasks ht
      WHERE ht.tenant_id = ${tenantId}
      ORDER BY ht.enabled DESC, ht.name
    `);
    const rows = (result as any).rows || result;
    heartbeatTasks = (rows as any[]).map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
      nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
      lastStatus: r.last_status,
    }));
  } catch (hbErr: any) {
    console.warn(`[agent-manager] Failed to load heartbeat tasks:`, hbErr?.message);
  }

  const subagentsRunning = subagents.filter(s => s.status === "running").length;
  const bgRunning = backgroundTasks.filter(t => t.status === "running" || t.status === "pending").length;
  const autoRunning = autonomousRunsData.filter(r => r.status === "running").length;
  const hbActive = heartbeatTasks.filter(t => t.enabled).length;

  return {
    summary: {
      totalActive: subagentsRunning + bgRunning + autoRunning,
      subagentsRunning,
      backgroundTasksRunning: bgRunning,
      autonomousRunsRunning: autoRunning,
      heartbeatTasksActive: hbActive,
    },
    subagents,
    backgroundTasks,
    autonomousRuns: autonomousRunsData,
    heartbeatTasks,
  };
}

setInterval(() => {
  const now = Date.now();
  const maxAge = 4 * 60 * 60 * 1000;
  for (const [id, run] of autonomousRuns) {
    if (run.completedAt && now - run.completedAt > maxAge) {
      autonomousRuns.delete(id);
    }
  }
}, 15 * 60 * 1000);

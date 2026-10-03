import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

export interface DeskTask {
  id: string;
  title: string;
  description?: string;
  source: "sprint_plan" | "delegation" | "event" | "self_initiated";
  sourceRef?: string;
  keyResultId?: number;
  priority: "critical" | "high" | "medium" | "low";
  status: "not_started" | "in_progress" | "paused" | "blocked" | "review";
  startedAt?: string;
  estimatedCompletionAt?: string;
  progressNotes: { timestamp: string; note: string }[];
  blockedBy?: string;
  relatedConversationIds?: number[];
  artifacts?: string[];
}

export interface WaitingItem {
  id: string;
  description: string;
  waitingForPersonaId: number;
  relatedTaskId?: string;
  requestedAt: string;
  expectedBy?: string;
  status: "waiting" | "received" | "overdue";
}

export interface AgentDesk {
  id: number;
  tenantId: number;
  personaId: number;
  activeTasks: DeskTask[];
  blockedItems: DeskTask[];
  waitingFor: WaitingItem[];
  queue: DeskTask[];
  recentCompletions: DeskTask[];
  focusArea: string | null;
  statusNote: string | null;
  lastActiveAt: string | null;
  updatedAt: string;
}

export async function getDesk(tenantId: number, personaId: number): Promise<AgentDesk> {
  const result = await db.execute(sql`
    SELECT * FROM agent_desks WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  const rows = (result as any).rows || result;

  if (rows.length > 0) {
    return parseDeskRow(rows[0]);
  }

  const insertResult = await db.execute(sql`
    INSERT INTO agent_desks (tenant_id, persona_id, active_tasks, blocked_items, waiting_for, queue, recent_completions)
    VALUES (${tenantId}, ${personaId}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
    ON CONFLICT (tenant_id, persona_id) DO NOTHING
    RETURNING *
  `);
  const insertRows = (insertResult as any).rows || insertResult;

  if (insertRows.length > 0) {
    return parseDeskRow(insertRows[0]);
  }

  const refetch = await db.execute(sql`
    SELECT * FROM agent_desks WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  return parseDeskRow(((refetch as any).rows || refetch)[0]);
}

function parseDeskRow(row: any): AgentDesk {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personaId: row.persona_id,
    activeTasks: Array.isArray(row.active_tasks) ? row.active_tasks : [],
    blockedItems: Array.isArray(row.blocked_items) ? row.blocked_items : [],
    waitingFor: Array.isArray(row.waiting_for) ? row.waiting_for : [],
    queue: Array.isArray(row.queue) ? row.queue : [],
    recentCompletions: Array.isArray(row.recent_completions) ? row.recent_completions : [],
    focusArea: row.focus_area,
    statusNote: row.status_note,
    lastActiveAt: row.last_active_at,
    updatedAt: row.updated_at,
  };
}

export async function addDeskTask(tenantId: number, personaId: number, task: Partial<DeskTask>): Promise<DeskTask> {
  const desk = await getDesk(tenantId, personaId);
  const newTask: DeskTask = {
    id: task.id || `desk-${crypto.randomUUID().slice(0, 8)}`,
    title: task.title || "Untitled task",
    description: task.description,
    source: task.source || "self_initiated",
    sourceRef: task.sourceRef,
    keyResultId: task.keyResultId,
    priority: task.priority || "medium",
    status: "not_started",
    startedAt: new Date().toISOString(),
    progressNotes: [],
    ...task,
  };

  desk.activeTasks.push(newTask);
  await saveDeskField(tenantId, personaId, "active_tasks", desk.activeTasks);
  return newTask;
}

export async function updateDeskTask(
  tenantId: number,
  personaId: number,
  taskId: string,
  updates: { progressNote?: string; status?: string; priority?: string }
): Promise<DeskTask | null> {
  const desk = await getDesk(tenantId, personaId);
  const task = desk.activeTasks.find(t => t.id === taskId);
  if (!task) return null;

  if (updates.progressNote) {
    task.progressNotes.push({ timestamp: new Date().toISOString(), note: updates.progressNote });
  }
  if (updates.status) task.status = updates.status as DeskTask["status"];
  if (updates.priority) task.priority = updates.priority as DeskTask["priority"];

  await saveDeskField(tenantId, personaId, "active_tasks", desk.activeTasks);
  return task;
}

export async function completeDeskTask(tenantId: number, personaId: number, taskId: string, note?: string): Promise<boolean> {
  const desk = await getDesk(tenantId, personaId);
  const idx = desk.activeTasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  const task = desk.activeTasks.splice(idx, 1)[0];
  task.status = "not_started";
  if (note) task.progressNotes.push({ timestamp: new Date().toISOString(), note });

  desk.recentCompletions.unshift(task);
  if (desk.recentCompletions.length > 10) desk.recentCompletions = desk.recentCompletions.slice(0, 10);

  await db.execute(sql`
    UPDATE agent_desks SET
      active_tasks = ${JSON.stringify(desk.activeTasks)}::jsonb,
      recent_completions = ${JSON.stringify(desk.recentCompletions)}::jsonb,
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  return true;
}

export async function blockDeskTask(tenantId: number, personaId: number, taskId: string, blockedBy: string): Promise<boolean> {
  const desk = await getDesk(tenantId, personaId);
  const idx = desk.activeTasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  const task = desk.activeTasks.splice(idx, 1)[0];
  task.status = "blocked";
  task.blockedBy = blockedBy;
  task.progressNotes.push({ timestamp: new Date().toISOString(), note: `Blocked: ${blockedBy}` });

  desk.blockedItems.push(task);

  await db.execute(sql`
    UPDATE agent_desks SET
      active_tasks = ${JSON.stringify(desk.activeTasks)}::jsonb,
      blocked_items = ${JSON.stringify(desk.blockedItems)}::jsonb,
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  return true;
}

export async function unblockDeskTask(tenantId: number, personaId: number, taskId: string): Promise<boolean> {
  const desk = await getDesk(tenantId, personaId);
  const idx = desk.blockedItems.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  const task = desk.blockedItems.splice(idx, 1)[0];
  task.status = "in_progress";
  task.blockedBy = undefined;
  task.progressNotes.push({ timestamp: new Date().toISOString(), note: "Unblocked" });

  desk.activeTasks.push(task);

  await db.execute(sql`
    UPDATE agent_desks SET
      active_tasks = ${JSON.stringify(desk.activeTasks)}::jsonb,
      blocked_items = ${JSON.stringify(desk.blockedItems)}::jsonb,
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  return true;
}

export async function addToQueue(tenantId: number, personaId: number, task: Partial<DeskTask>): Promise<DeskTask> {
  const desk = await getDesk(tenantId, personaId);
  const newTask: DeskTask = {
    id: `desk-${crypto.randomUUID().slice(0, 8)}`,
    title: task.title || "Untitled",
    priority: task.priority || "medium",
    source: task.source || "self_initiated",
    status: "not_started",
    progressNotes: [],
    ...task,
  } as DeskTask;

  desk.queue.push(newTask);
  await saveDeskField(tenantId, personaId, "queue", desk.queue);
  return newTask;
}

export async function pickFromQueue(tenantId: number, personaId: number, taskId?: string): Promise<DeskTask | null> {
  const desk = await getDesk(tenantId, personaId);
  if (desk.queue.length === 0) return null;

  let idx = 0;
  if (taskId) {
    idx = desk.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
  }

  const task = desk.queue.splice(idx, 1)[0];
  task.status = "in_progress";
  task.startedAt = new Date().toISOString();
  desk.activeTasks.push(task);

  await db.execute(sql`
    UPDATE agent_desks SET
      active_tasks = ${JSON.stringify(desk.activeTasks)}::jsonb,
      queue = ${JSON.stringify(desk.queue)}::jsonb,
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
  return task;
}

export async function setDeskFocus(tenantId: number, personaId: number, focusArea: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_desks SET focus_area = ${focusArea}, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
}

export async function setDeskStatus(tenantId: number, personaId: number, statusNote: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_desks SET status_note = ${statusNote}, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
}

export async function addWaiting(
  tenantId: number,
  personaId: number,
  item: { description: string; waitingForPersonaId: number; relatedTaskId?: string; expectedBy?: string }
): Promise<WaitingItem> {
  const desk = await getDesk(tenantId, personaId);
  const waitItem: WaitingItem = {
    id: `wait-${crypto.randomUUID().slice(0, 8)}`,
    description: item.description,
    waitingForPersonaId: item.waitingForPersonaId,
    relatedTaskId: item.relatedTaskId,
    requestedAt: new Date().toISOString(),
    expectedBy: item.expectedBy,
    status: "waiting",
  };

  desk.waitingFor.push(waitItem);
  await saveDeskField(tenantId, personaId, "waiting_for", desk.waitingFor);
  return waitItem;
}

export async function resolveWaiting(tenantId: number, personaId: number, waitId: string): Promise<boolean> {
  const desk = await getDesk(tenantId, personaId);
  const idx = desk.waitingFor.findIndex(w => w.id === waitId);
  if (idx === -1) return false;

  desk.waitingFor[idx].status = "received";
  desk.waitingFor.splice(idx, 1);
  await saveDeskField(tenantId, personaId, "waiting_for", desk.waitingFor);
  return true;
}

export async function getAllDesks(tenantId: number): Promise<AgentDesk[]> {
  const result = await db.execute(sql`
    SELECT * FROM agent_desks WHERE tenant_id = ${tenantId} ORDER BY persona_id
  `);
  const rows = (result as any).rows || result;
  return rows.map(parseDeskRow);
}

export async function getDesksOverview(tenantId: number): Promise<any> {
  const desks = await getAllDesks(tenantId);
  const personaResult = await db.execute(sql`SELECT id, name FROM personas`);
  const personaRows = (personaResult as any).rows || personaResult;
  const personaMap = new Map<number, string>();
  for (const p of personaRows) personaMap.set(p.id, p.name);

  const today = new Date().toISOString().split("T")[0];

  return desks.map(d => ({
    personaId: d.personaId,
    personaName: personaMap.get(d.personaId) || `Persona #${d.personaId}`,
    focusArea: d.focusArea,
    statusNote: d.statusNote,
    activeTasks: d.activeTasks,
    queue: d.queue,
    waitingOn: d.waitingFor,
    completedToday: (d.recentCompletions || []).filter((t: any) => t.completedAt?.startsWith(today)).length,
    lastActive: d.lastActiveAt,
  }));
}

export function buildDeskContext(desk: AgentDesk): string {
  const activeTasks = desk.activeTasks || [];
  const blockedItems = desk.blockedItems || [];
  const waitingFor = desk.waitingFor || [];
  const queue = desk.queue || [];

  if (activeTasks.length === 0 && queue.length === 0 && blockedItems.length === 0 && waitingFor.length === 0) {
    return "## Your Desk\nNo active tasks. Check sprint plan or event queue for new work.";
  }

  let context = `## Your Desk — Current State\n`;

  if (desk.focusArea) {
    context += `**Current Focus**: ${desk.focusArea}\n`;
  }
  if (desk.statusNote) {
    context += `**Status**: ${desk.statusNote}\n`;
  }

  if (activeTasks.length > 0) {
    context += `\n### Active Tasks (${activeTasks.length})\n`;
    for (const task of activeTasks) {
      context += `- **[${task.priority}]** ${task.title} — ${task.status}`;
      if (task.progressNotes?.length > 0) {
        const lastNote = task.progressNotes[task.progressNotes.length - 1];
        context += ` (Last: ${lastNote.note})`;
      }
      context += '\n';
    }
  }

  if (blockedItems.length > 0) {
    context += `\n### Blocked (${blockedItems.length})\n`;
    for (const item of blockedItems) {
      context += `- ${item.title} — Blocked by: ${item.blockedBy}\n`;
    }
  }

  if (waitingFor.length > 0) {
    context += `\n### Waiting For (${waitingFor.length})\n`;
    for (const item of waitingFor) {
      context += `- ${item.description} — Since: ${new Date(item.requestedAt).toLocaleDateString()}\n`;
    }
  }

  if (queue.length > 0) {
    context += `\n### Queue (${queue.length} items)\n`;
    for (const item of queue.slice(0, 5)) {
      context += `- [${item.priority}] ${item.title}\n`;
    }
    if (queue.length > 5) {
      context += `- ...and ${queue.length - 5} more\n`;
    }
  }

  return context;
}

// R79.3 loaded-gun guard: every current caller passes one of these three
// hardcoded literals, but the function signature accepts any string and sinks
// it into sql.raw() (drizzle@0.39 bypasses identifier escaping — fixed in
// 0.45.2 but we deferred the major bump). This explicit allowlist makes the
// safe-by-construction property survive future callers.
const ALLOWED_DESK_FIELDS: ReadonlySet<string> = new Set([
  "active_tasks",
  "queue",
  "waiting_for",
]);

async function saveDeskField(tenantId: number, personaId: number, field: string, value: any): Promise<void> {
  if (!ALLOWED_DESK_FIELDS.has(field)) {
    throw new Error(`saveDeskField: field "${field}" not in allowlist (R79.3 SQL-injection guard)`);
  }
  const jsonVal = JSON.stringify(value);
  await db.execute(sql`
    UPDATE agent_desks SET ${sql.raw(field)} = ${jsonVal}::jsonb, updated_at = NOW(), last_active_at = NOW()
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
  `);
}

export async function touchDesk(tenantId: number, personaId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO agent_desks (tenant_id, persona_id)
    VALUES (${tenantId}, ${personaId})
    ON CONFLICT (tenant_id, persona_id) DO UPDATE SET last_active_at = NOW()
  `);
}

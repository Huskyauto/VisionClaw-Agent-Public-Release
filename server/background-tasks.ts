import crypto from "crypto";
import { executeTool } from "./tools";

const MAX_CONCURRENT_PER_TENANT = 5;
const MAX_TOTAL_TASKS = 50;

export interface BackgroundTask {
  id: string;
  tenantId: number;
  toolName: string;
  params: Record<string, any>;
  status: "pending" | "running" | "completed" | "failed";
  result: any;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  progressUpdates: string[];
}

const tasks = new Map<string, BackgroundTask>();

function generateTaskId(): string {
  return `bg_${crypto.randomBytes(16).toString("hex")}`;
}

function getActiveTenantCount(tenantId: number): number {
  let count = 0;
  for (const task of tasks.values()) {
    if (task.tenantId === tenantId && (task.status === "pending" || task.status === "running")) {
      count++;
    }
  }
  return count;
}

export function launchBackgroundTask(
  tenantId: number,
  toolName: string,
  params: Record<string, any>
): BackgroundTask {
  if (getActiveTenantCount(tenantId) >= MAX_CONCURRENT_PER_TENANT) {
    throw new Error(`Concurrent task limit reached (${MAX_CONCURRENT_PER_TENANT}). Wait for existing tasks to complete.`);
  }

  const activeTotal = Array.from(tasks.values()).filter(t => t.status === "pending" || t.status === "running").length;
  if (activeTotal >= MAX_TOTAL_TASKS) {
    throw new Error("System-wide task limit reached. Please wait for existing tasks to complete.");
  }

  const taskId = generateTaskId();
  const task: BackgroundTask = {
    id: taskId,
    tenantId,
    toolName,
    params,
    status: "pending",
    result: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    progressUpdates: [],
  };

  tasks.set(taskId, task);

  setImmediate(async () => {
    task.status = "running";
    task.startedAt = Date.now();
    task.progressUpdates.push(`Started executing ${toolName}`);

    try {
      const result = await executeTool(toolName, { ...params, _tenantId: tenantId });
      task.result = result;
      task.status = "completed";
      task.completedAt = Date.now();
      const elapsed = task.completedAt - (task.startedAt || task.createdAt);
      task.progressUpdates.push(`Completed in ${elapsed}ms`);
      console.log(`[background-task] ${taskId} (${toolName}) completed in ${elapsed}ms`);
    } catch (err: any) {
      task.error = err.message;
      task.status = "failed";
      task.completedAt = Date.now();
      task.progressUpdates.push(`Failed: ${err.message}`);
      console.error(`[background-task] ${taskId} (${toolName}) failed:`, err.message);
    }
  });

  console.log(`[background-task] Launched ${taskId}: ${toolName} for tenant ${tenantId}`);
  return task;
}

export function getTask(taskId: string, requesterTenantId: number): BackgroundTask | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (task.tenantId !== requesterTenantId) return null;
  return task;
}

export function getTasksByTenant(tenantId: number): BackgroundTask[] {
  return Array.from(tasks.values())
    .filter(t => t.tenantId === tenantId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pollTask(taskId: string, requesterTenantId: number): {
  id: string;
  status: string;
  elapsed: number;
  result?: any;
  error?: string;
  progress: string[];
} | null {
  const task = getTask(taskId, requesterTenantId);
  if (!task) return null;

  const elapsed = (task.completedAt || Date.now()) - task.createdAt;
  const response: any = {
    id: task.id,
    status: task.status,
    toolName: task.toolName,
    elapsed,
    progress: task.progressUpdates,
  };

  if (task.status === "completed") response.result = task.result;
  if (task.status === "failed") response.error = task.error;

  return response;
}

export async function waitForTask(taskId: string, requesterTenantId: number, timeoutMs = 60000): Promise<BackgroundTask | null> {
  const task = getTask(taskId, requesterTenantId);
  if (!task) return null;
  if (task.status === "completed" || task.status === "failed") return task;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (task.status === "completed" || task.status === "failed") return task;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return task;
}

setInterval(() => {
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000;
  for (const [id, task] of tasks) {
    if (task.completedAt && now - task.completedAt > maxAge) {
      tasks.delete(id);
    }
  }
}, 10 * 60 * 1000);

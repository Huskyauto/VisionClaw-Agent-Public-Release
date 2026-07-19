/**
 * Tools-layer-split S25u — background-tasks-domain migrated handlers.
 *
 * Selection: the 3 contiguous background-task tools — `run_background_task`,
 * `check_background_task`, `list_background_tasks`. All three are backed solely by
 * `server/background-tasks` (`launchBackgroundTask` / `pollTask` / `waitForTask` /
 * `getTasksByTenant`) — one coherent async-job launch/poll/list cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * trust signal `params._tenantId` as the tenant scope for the backing lib call
 * (`launchBackgroundTask(params._tenantId, …)`, `pollTask/waitForTask(…,
 * params._tenantId)`, `getTasksByTenant(params._tenantId)`). `_tenantId` is a
 * TRUST_SIGNAL_KEY stripped by the dispatcher (server/tools/context.ts), so the
 * migrated handlers read the trusted `ctx.tenantId` instead — same value (the
 * dispatcher derives `ctx.tenantId` from the same pre-strip `params._tenantId`).
 *
 * TENANT GUARD (added R125+125, post-edit-code-review 2026-07-07 — deliberate
 * behavior change from the mechanical move): all three handlers now fail CLOSED
 * when `ctx.tenantId` is missing or non-positive, instead of letting `undefined`
 * flow into the backing lib as the legacy `any`-typed arms did. Rationale: a
 * missing tenant context on a background-task launch/poll/list is a cross-tenant
 * isolation risk, not a benign default.
 *
 * The backing `../../../background-tasks` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  runBackgroundTaskDefinition,
  checkBackgroundTaskDefinition,
  listBackgroundTasksDefinition,
} from "./definitions";

async function runBackgroundTaskHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (typeof ctx.tenantId !== "number" || ctx.tenantId <= 0) {
    return { error: "run_background_task requires tenant context (cross-tenant isolation guard)" };
  }
  const { launchBackgroundTask } = await import("../../../background-tasks");
  const bgToolName = params.tool_name;
  if (!bgToolName) return { error: "tool_name is required" };
  const bgParams = params.params || {};
  const task = launchBackgroundTask(ctx.tenantId, bgToolName, bgParams);
  return {
    task_id: task.id,
    status: task.status,
    toolName: bgToolName,
    message: `Tool "${bgToolName}" launched in background. Use check_background_task with task_id "${task.id}" to poll for results.`,
  };
}

async function checkBackgroundTaskHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (typeof ctx.tenantId !== "number" || ctx.tenantId <= 0) {
    return { error: "check_background_task requires tenant context (cross-tenant isolation guard)" };
  }
  const { pollTask, waitForTask } = await import("../../../background-tasks");
  if (!params.task_id) return { error: "task_id is required" };
  const reqTenantId = ctx.tenantId;
  if (params.wait) {
    const task = await waitForTask(params.task_id, reqTenantId, 60000);
    if (!task) return { error: `Task ${params.task_id} not found` };
    // Type-only seam cast: pollTask returns `{...} | null`; legacy arm was
    // `any`-typed and returned the value verbatim (runtime unchanged).
    return pollTask(params.task_id, reqTenantId) as ToolResult;
  }
  const poll = pollTask(params.task_id, reqTenantId);
  if (!poll) return { error: `Task ${params.task_id} not found` };
  return poll;
}

async function listBackgroundTasksHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (typeof ctx.tenantId !== "number" || ctx.tenantId <= 0) {
    return { error: "list_background_tasks requires tenant context (cross-tenant isolation guard)" };
  }
  const { getTasksByTenant } = await import("../../../background-tasks");
  const tenantTasks = getTasksByTenant(ctx.tenantId);
  return {
    tasks: tenantTasks.map(t => ({
      id: t.id,
      toolName: t.toolName,
      status: t.status,
      elapsed: ((t.completedAt || Date.now()) - t.createdAt) + "ms",
      progress: t.progressUpdates,
    })),
    total: tenantTasks.length,
  };
}

/** Registered by ./index.ts at import time. */
export const backgroundDomainTools: RegisteredTool[] = [
  defineTool(runBackgroundTaskDefinition, runBackgroundTaskHandler),
  defineTool(checkBackgroundTaskDefinition, checkBackgroundTaskHandler),
  defineTool(listBackgroundTasksDefinition, listBackgroundTasksHandler),
];

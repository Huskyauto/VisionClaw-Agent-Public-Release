/**
 * Tools-layer-split S25z — task-forces-domain migrated handlers.
 *
 * Selection: the 4 task-force lifecycle tools — `create_task_force` /
 * `list_task_forces` / `charge_task_force` / `sunset_task_force`. Backed solely by
 * `server/agentic/task-forces` (`createTaskForce` / `listTaskForces` /
 * `chargeTaskForce` / `sunsetTaskForce`) — one coherent cluster; grep confirmed
 * `server/tools.ts` is the ONLY external caller of that backing module.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * trust signals DIRECTLY — `params._tenantId` for its pre-existing fail-closed
 * guard (`if (!params._tenantId) return { error: "... cross-tenant isolation
 * guard" }`) AND as the backing-lib `tenantId` scope; `create_task_force`
 * additionally read `params._personaId` for the `createdBy` audit stamp. Migrated
 * handlers read `ctx.tenantId` / `ctx.personaId` (the same platform-derived values)
 * in the SAME order with IDENTICAL error strings, guards, and value-validation. No
 * re-stamp is needed (the arms consumed the signals themselves — for a guard and as
 * discrete args — they did not forward the whole params object into the lib).
 * `_tenantId` and `_personaId` are the ONLY stripped signals these arms read
 * (grepped).
 *
 * The backing `../../../agentic/task-forces` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `task-forces` does not import the tools facade
 * (it imports only db / drizzle / event-bus / silent-catch — grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createTaskForceDefinition,
  listTaskForcesDefinition,
  chargeTaskForceDefinition,
  sunsetTaskForceDefinition,
} from "./definitions";

async function createTaskForceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for create_task_force (cross-tenant isolation guard)" };
  if (!params.name || !params.mission) return { error: "name and mission are required" };
  if (params.budgetUsd !== undefined && (typeof params.budgetUsd !== "number" || !Number.isFinite(params.budgetUsd) || params.budgetUsd < 0)) return { error: "budgetUsd must be a non-negative finite number" };
  if (params.deadline !== undefined && params.deadline !== null && Number.isNaN(new Date(params.deadline).getTime())) return { error: "deadline must be a valid date" };
  try {
    const { createTaskForce } = await import("../../../agentic/task-forces");
    return await createTaskForce({
      tenantId: ctx.tenantId,
      name: params.name,
      mission: params.mission,
      personaIds: Array.isArray(params.personaIds) ? params.personaIds : undefined,
      budgetUsd: typeof params.budgetUsd === "number" ? params.budgetUsd : undefined,
      deadline: params.deadline ? new Date(params.deadline) : null,
      createdBy: typeof ctx.personaId === "number" ? `persona:${ctx.personaId}` : "agent",
    });
  } catch (e: any) { return { error: e?.message || "create_task_force failed" }; }
}

async function listTaskForcesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for list_task_forces (cross-tenant isolation guard)" };
  try {
    const { listTaskForces } = await import("../../../agentic/task-forces");
    const taskForces = await listTaskForces(ctx.tenantId, params.status);
    return { count: taskForces.length, taskForces };
  } catch (e: any) { return { error: e?.message || "list_task_forces failed" }; }
}

async function chargeTaskForceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for charge_task_force (cross-tenant isolation guard)" };
  if (typeof params.id !== "number" || typeof params.amountUsd !== "number" || !Number.isFinite(params.amountUsd) || params.amountUsd < 0) return { error: "id and a non-negative numeric amountUsd are required" };
  try {
    const { chargeTaskForce } = await import("../../../agentic/task-forces");
    const r = await chargeTaskForce(ctx.tenantId, params.id, params.amountUsd);
    if (!r) return { error: `task-force ${params.id} not found` };
    return r;
  } catch (e: any) { return { error: e?.message || "charge_task_force failed" }; }
}

async function sunsetTaskForceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for sunset_task_force (cross-tenant isolation guard)" };
  if (typeof params.id !== "number") return { error: "id is required" };
  try {
    const { sunsetTaskForce } = await import("../../../agentic/task-forces");
    const ok = await sunsetTaskForce(ctx.tenantId, params.id, params.result);
    return { ok, sunset: ok };
  } catch (e: any) { return { error: e?.message || "sunset_task_force failed" }; }
}

/** Registered by ./index.ts at import time. */
export const taskForcesDomainTools: RegisteredTool[] = [
  defineTool(createTaskForceDefinition, createTaskForceHandler),
  defineTool(listTaskForcesDefinition, listTaskForcesHandler),
  defineTool(chargeTaskForceDefinition, chargeTaskForceHandler),
  defineTool(sunsetTaskForceDefinition, sunsetTaskForceHandler),
];

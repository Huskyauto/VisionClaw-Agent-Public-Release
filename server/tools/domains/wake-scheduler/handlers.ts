/**
 * Tools-layer-split S26c — wake-scheduler-domain migrated handlers.
 *
 * Selection: the 3 durable-wake tools — `schedule_wake` / `cancel_wake` /
 * `list_wakes`. Backed solely by `server/agentic/wake-scheduler`
 * (`scheduleWake` / `cancelWake` / `listWakes`).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — for its fail-closed guard
 * (`if (!params._tenantId) return { error: "... cross-tenant isolation guard" }`)
 * AND as the backing-lib `tenantId` scope. `schedule_wake` additionally read
 * `params._personaId` — mapped to the lib's `personaId` (`typeof ... === "number"
 * ? ... : null` — NOTE: `null`, not `undefined`) AND into the `createdBy`
 * attribution string (`persona:${_personaId}` else `"agent"`). Migrated handlers
 * read `ctx.tenantId` / `ctx.personaId` (the same platform-derived values) in the
 * SAME order with IDENTICAL error strings, guards, and validation. All PUBLIC
 * caller params (`goal` / `wakeAt` / `kind` / `maxAttempts` / `id` / `status`) stay
 * read from `params`.
 *
 * The backing `../../../agentic/wake-scheduler` module is pulled via call-time
 * dynamic `import(...)` — NOT a top-level static import (acyclicity invariant,
 * plan.md S2). `wake-scheduler` does not import the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  scheduleWakeDefinition,
  cancelWakeDefinition,
  listWakesDefinition,
} from "./definitions";

async function scheduleWakeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for schedule_wake (cross-tenant isolation guard)" };
  if (!params.goal || typeof params.goal !== "string") return { error: "goal is required" };
  const wakeAt = new Date(params.wakeAt);
  if (isNaN(wakeAt.getTime())) return { error: "wakeAt must be a valid ISO timestamp" };
  if (wakeAt.getTime() <= Date.now()) return { error: "wakeAt must be in the future" };
  try {
    const { scheduleWake } = await import("../../../agentic/wake-scheduler");
    return await scheduleWake({
      tenantId: ctx.tenantId,
      goal: params.goal,
      wakeAt,
      personaId: typeof ctx.personaId === "number" ? ctx.personaId : null,
      kind: params.kind,
      maxAttempts: params.maxAttempts,
      createdBy: typeof ctx.personaId === "number" ? `persona:${ctx.personaId}` : "agent",
      triggerEvent: typeof params.triggerEvent === "string" ? params.triggerEvent : null,
      triggerFilter: params.triggerFilter && typeof params.triggerFilter === "object" && !Array.isArray(params.triggerFilter) ? params.triggerFilter : null,
    });
  } catch (e: any) { return { error: e?.message || "schedule_wake failed" }; }
}

async function cancelWakeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for cancel_wake (cross-tenant isolation guard)" };
  if (typeof params.id !== "number") return { error: "id is required" };
  try {
    const { cancelWake } = await import("../../../agentic/wake-scheduler");
    const ok = await cancelWake(ctx.tenantId, params.id);
    return { ok, cancelled: ok };
  } catch (e: any) { return { error: e?.message || "cancel_wake failed" }; }
}

async function listWakesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for list_wakes (cross-tenant isolation guard)" };
  try {
    const { listWakes } = await import("../../../agentic/wake-scheduler");
    const wakes = await listWakes(ctx.tenantId, params.status);
    return { count: wakes.length, wakes };
  } catch (e: any) { return { error: e?.message || "list_wakes failed" }; }
}

/** Registered by ./index.ts at import time. */
export const wakeSchedulerDomainTools: RegisteredTool[] = [
  defineTool(scheduleWakeDefinition, scheduleWakeHandler),
  defineTool(cancelWakeDefinition, cancelWakeHandler),
  defineTool(listWakesDefinition, listWakesHandler),
];

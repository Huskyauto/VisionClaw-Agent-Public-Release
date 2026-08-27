/**
 * Tools-layer-split S25v — minerva-planner-domain migrated handlers.
 *
 * Selection: the 3 Minerva planning tools — `create_plan`, `list_plans`,
 * `get_plan`. All three are backed solely by `server/minerva-planner`
 * (`createPlan` / `listPlans` / `getPlan`) — one coherent plan compose/list/read
 * cluster. (`get_minerva_roster`, the adjacent legacy arm, is backed by
 * `server/capability-registry` — a different lib — so it stays legacy.)
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * trust signal `params._tenantId` — once for the pre-existing fail-closed guard
 * (`if (!params._tenantId) return { error: "Tenant context required" }`) and once
 * as the `tenantId` scope passed to the backing-lib call. The migrated handlers
 * read the trusted `ctx.tenantId` (platform-derived; same value) in the SAME
 * order with the SAME error strings. The `if (!ctx.tenantId) return` guard NARROWS
 * `ctx.tenantId` from `number | undefined` to `number` for the backing-lib call, so
 * NO type cast is required (the guard is preserved exactly where the legacy had it).
 *
 * The backing `../../../minerva-planner` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). Each dynamic import stays INSIDE the try
 * block, matching the legacy arms (module-load failure returns the `{ error }`
 * envelope, never throws upward).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createPlanDefinition,
  listPlansDefinition,
  getPlanDefinition,
} from "./definitions";

async function createPlanHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  if (!params.objective || typeof params.objective !== "string") return { error: "objective is required" };
  const revisionFeedback = params.revisionFeedback || params.revisionReason;
  if (params.parentPlanId && !revisionFeedback) {
    return { error: "revisionFeedback is required when parentPlanId is set (Minerva must cite what changed)" };
  }
  try {
    const { createPlan } = await import("../../../minerva-planner");
    const { planId, plan } = await createPlan({
      tenantId: ctx.tenantId,
      objective: params.objective,
      source: params.source || "agent",
      sourceRef: params.sourceRef,
      parentPlanId: params.parentPlanId,
      revisionFeedback,
    });
    return {
      success: true,
      planId,
      status: "awaiting_approval",
      stepCount: plan.steps?.length ?? 0,
      totalEstimatedCostUsd: plan.total_estimated_cost_usd,
      totalEstimatedMinutes: plan.total_estimated_minutes,
      message: `Plan #${planId} is awaiting Felix's decision (plan.proposed event emitted).`,
      plan,
    };
  } catch (e: any) {
    return { error: `create_plan failed: ${e?.message || e}` };
  }
}

async function listPlansHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  try {
    const { listPlans } = await import("../../../minerva-planner");
    const plans = await listPlans({
      tenantId: ctx.tenantId,
      status: params.status,
      limit: typeof params.limit === "number" ? params.limit : 20,
    });
    return { success: true, count: Array.isArray(plans) ? plans.length : 0, plans };
  } catch (e: any) {
    return { error: `list_plans failed: ${e?.message || e}` };
  }
}

async function getPlanHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  if (!params.planId || typeof params.planId !== "number") return { error: "planId (number) is required" };
  try {
    const { getPlan } = await import("../../../minerva-planner");
    const plan = await getPlan(params.planId, ctx.tenantId);
    if (!plan) return { error: `Plan #${params.planId} not found` };
    return { success: true, plan };
  } catch (e: any) {
    return { error: `get_plan failed: ${e?.message || e}` };
  }
}

/** Registered by ./index.ts at import time. */
export const minervaDomainTools: RegisteredTool[] = [
  defineTool(createPlanDefinition, createPlanHandler),
  defineTool(listPlansDefinition, listPlansHandler),
  defineTool(getPlanDefinition, getPlanHandler),
];

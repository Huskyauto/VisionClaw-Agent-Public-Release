/**
 * Tools-layer-split S26a — department-budgets-domain migrated handlers.
 *
 * Selection: the 2 department-budget tools — `set_department_budget` /
 * `check_department_budget`. Backed solely by `server/agentic/department-budgets`
 * (`setDepartmentBudget` / `checkDepartmentBudget` / `checkAllBudgets`) — one
 * coherent cluster; grep confirmed `server/tools.ts` is the ONLY external caller of
 * those backing fns.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — for its pre-existing fail-closed guard
 * (`if (!params._tenantId) return { error: "... cross-tenant isolation guard" }`)
 * AND as the backing-lib `tenantId` scope. Migrated handlers read `ctx.tenantId`
 * (the same platform-derived value) in the SAME order with IDENTICAL error strings,
 * guards, and value-validation. No re-stamp is needed (the arms consumed the signal
 * themselves — for a guard and as a discrete arg — they did not forward the whole
 * params object into the lib). `_tenantId` is the ONLY stripped signal these arms
 * read (grepped — no `_personaId`/`_conversationId`/`_projectId`).
 *
 * The backing `../../../agentic/department-budgets` module is pulled via call-time
 * dynamic `import(...)` — NOT a top-level static import — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the app
 * graph (acyclicity invariant, plan.md S2). `department-budgets` does not import the
 * tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  setDepartmentBudgetDefinition,
  checkDepartmentBudgetDefinition,
} from "./definitions";

async function setDepartmentBudgetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for set_department_budget (cross-tenant isolation guard)" };
  if (!params.department || typeof params.limitUsd !== "number" || !Number.isFinite(params.limitUsd) || params.limitUsd < 0) return { error: "department and a non-negative numeric limitUsd are required" };
  try {
    const { setDepartmentBudget } = await import("../../../agentic/department-budgets");
    return await setDepartmentBudget(ctx.tenantId, params.department, params.limitUsd, params.period === "weekly" ? "weekly" : "monthly");
  } catch (e: any) { return { error: e?.message || "set_department_budget failed" }; }
}

async function checkDepartmentBudgetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for check_department_budget (cross-tenant isolation guard)" };
  try {
    const { checkDepartmentBudget, checkAllBudgets } = await import("../../../agentic/department-budgets");
    if (params.department) return await checkDepartmentBudget(ctx.tenantId, params.department);
    const all = await checkAllBudgets(ctx.tenantId);
    return { count: all.length, budgets: all };
  } catch (e: any) { return { error: e?.message || "check_department_budget failed" }; }
}

/** Registered by ./index.ts at import time. */
export const departmentBudgetsDomainTools: RegisteredTool[] = [
  defineTool(setDepartmentBudgetDefinition, setDepartmentBudgetHandler),
  defineTool(checkDepartmentBudgetDefinition, checkDepartmentBudgetHandler),
];

/**
 * Tools-layer-split S26c — cost-ledger-domain migrated handlers.
 *
 * Selection: the 2 owner-only financial tools — `revenue_vs_cost` /
 * `agent_cost_summary`. Backed solely by `server/agentic/cost-ledger`
 * (`getRevenueVsCost` / `getCostSummary`).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required" }`), for the
 * OWNER-ONLY authorization guard (env-configurable `ownerTenantId()` — single source of truth with the route layer),
 * AND as the backing-lib `tenantId` scope. Migrated handlers read `ctx.tenantId`
 * (the same platform-derived value) in the SAME order with IDENTICAL error strings,
 * guards, and value-validation (the `days` clamp `Math.max(1, Math.min(Number(days) || 7, 90))`).
 * `_tenantId` is the ONLY stripped signal these arms read (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * The backing `../../../agentic/cost-ledger` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `cost-ledger` does not import the tools facade
 * (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  revenueVsCostDefinition,
  agentCostSummaryDefinition,
} from "./definitions";

async function revenueVsCostHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) return { error: "revenue_vs_cost is owner-only (reveals platform margin data)" };
  const days = Math.max(1, Math.min(Number(params.days) || 7, 90));
  try {
    const { getRevenueVsCost } = await import("../../../agentic/cost-ledger");
    const summary = await getRevenueVsCost(tenantId, days);
    return summary;
  } catch (err: any) {
    return { error: `revenue_vs_cost failed: ${err.message}` };
  }
}

async function agentCostSummaryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) return { error: "agent_cost_summary is owner-only" };
  const days = Math.max(1, Math.min(Number(params.days) || 7, 90));
  try {
    const { getCostSummary } = await import("../../../agentic/cost-ledger");
    return await getCostSummary(tenantId, days);
  } catch (err: any) {
    return { error: `agent_cost_summary failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const costLedgerDomainTools: RegisteredTool[] = [
  defineTool(revenueVsCostDefinition, revenueVsCostHandler),
  defineTool(agentCostSummaryDefinition, agentCostSummaryHandler),
];

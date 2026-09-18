/**
 * Tools-layer-split S4 — first migrated handlers (system domain).
 *
 * Selection per plan.md S4 acceptance: read-only, no-network, no-DB-write,
 * non-destructive. `test_api_keys` and `check_system_status` stay in the
 * legacy switch (they probe providers / the web server over the network).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no schema edits). Tenant context now arrives via the
 * trusted ToolContext instead of `params._tenantId` — same value, same
 * fail-closed refusal copy.
 *
 * App-module imports are DYNAMIC (call-time), mirroring the legacy arms'
 * `await import(...)` pattern. The acyclicity invariant is about the STATIC
 * (load-time) import graph — a call-time import cannot create a load cycle,
 * and keeps this package importable in isolation by unit tests.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  listModelsDefinition,
  templateScraperStatsDefinition,
  getUsageAnalyticsDefinition,
} from "./definitions";

export async function listModelsHandler(): Promise<ToolResult> {
  const { getAvailableModels } = await import("../../../providers");
  return { models: await getAvailableModels() };
}

export async function templateScraperStatsHandler(): Promise<ToolResult> {
  const { templateScraperStats } = await import("../../../structured-extraction");
  return templateScraperStats();
}

export async function getUsageAnalyticsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for get_usage_analytics" };
  const { getUsageInsights } = await import("../../../insights-engine");
  const days = Math.min(365, Math.max(1, Number(params.days) || 30));
  return getUsageInsights({ tenantId: ctx.tenantId, days });
}

/** Registered by ./index.ts at import time. */
export const systemDomainTools: RegisteredTool[] = [
  defineTool(listModelsDefinition, listModelsHandler),
  defineTool(templateScraperStatsDefinition, templateScraperStatsHandler),
  defineTool(getUsageAnalyticsDefinition, getUsageAnalyticsHandler),
];

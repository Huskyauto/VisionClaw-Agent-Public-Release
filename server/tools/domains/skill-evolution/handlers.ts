/**
 * Tools-layer-split S26e — skill-evolution-domain migrated handler.
 *
 * Selection: the single tool-performance tool — `tool_performance_report`. Backed
 * solely by `server/skill-evolution` (`getToolPerformanceReport` /
 * `runEvolutionCycle` / `getEvolutionSummary`).
 *
 * Handler body is a MECHANICAL move of the legacy switch arm (standing rules:
 * no renames, no behavior change, no added/removed gate) — the inner
 * `action` branch dispatch is preserved VERBATIM.
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required" }`) AND as the
 * backing-lib `tenantId` scope. Migrated handler reads `ctx.tenantId` (the same
 * platform-derived value) in the SAME order with the IDENTICAL error string.
 * `_tenantId` is the ONLY stripped signal this arm read (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * The backing `../../../skill-evolution` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `skill-evolution` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  toolPerformanceReportDefinition,
  detectFatigueDefinition,
  microSabbaticalDefinition,
} from "./definitions";

async function toolPerformanceReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  try {
    const action = params.action || "report";
    if (action === "evolve") {
      const { runEvolutionCycle } = await import("../../../skill-evolution");
      const improvements = await runEvolutionCycle(ctx.tenantId);
      return { action: "evolve", improvements };
    } else if (action === "summary") {
      const { getEvolutionSummary } = await import("../../../skill-evolution");
      const summary = await getEvolutionSummary(ctx.tenantId);
      return { action: "summary", summary };
    } else {
      const { getToolPerformanceReport } = await import("../../../skill-evolution");
      const report = await getToolPerformanceReport(ctx.tenantId);
      return { action: "report", report };
    }
  } catch (err: any) {
    return { error: `Tool performance report failed: ${err.message}` };
  }
}

// Tools-layer-split S26g — wellness fatigue pair. PURE transforms (SEAM: NONE):
// neither arm read any dispatcher-stripped trust signal, so `ctx` is unused. Bodies
// are a MECHANICAL move of the legacy switch arms, verbatim.
async function detectFatigueHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { detectUserFatigue } = await import("../../../skill-evolution");
  return detectUserFatigue(params.message || "");
}

async function microSabbaticalHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { generateMicroSabbaticalIntervention } = await import("../../../skill-evolution");
  const result = generateMicroSabbaticalIntervention(
    { detected: true, confidence: 100, fatigueType: params.fatigue_type || "general_exhaustion" },
    Array.isArray(params.previous_intervention_ids) ? params.previous_intervention_ids : [],
  );
  return result || { error: "No intervention available" };
}

/** Registered by ./index.ts at import time. */
export const skillEvolutionDomainTools: RegisteredTool[] = [
  defineTool(toolPerformanceReportDefinition, toolPerformanceReportHandler),
  defineTool(detectFatigueDefinition, detectFatigueHandler),
  defineTool(microSabbaticalDefinition, microSabbaticalHandler),
];

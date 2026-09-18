/**
 * Tools-layer-split S26e — outcome-tracking-domain migrated handler.
 *
 * Selection: the single outcome-learning tool — `track_outcome`. Backed solely by
 * `server/outcome-tracker` (`trackAction` / `recordOutcome` / `getOutcomes` /
 * `getPatterns`).
 *
 * Handler body is a MECHANICAL move of the legacy switch arm (standing rules:
 * no renames, no behavior change, no added/removed gate) — the inner
 * `switch (params.action)` is preserved VERBATIM.
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required for track_outcome" }`)
 * AND as the backing-lib `tenantId` scope, plus `params._personaId` (`|| 0`) as the
 * persona stamp. Migrated handler reads `ctx.tenantId` / `ctx.personaId` (the same
 * platform-derived values) in the SAME order with IDENTICAL error strings and the
 * SAME `|| 0` default. `_tenantId`/`_personaId` are the ONLY stripped signals this
 * arm read (grepped — no `_conversationId`/`_projectId`). The public `params.personaId`
 * used inside the `view` case is a caller-supplied filter, NOT a trust signal — it
 * stays a plain param.
 *
 * The backing `../../../outcome-tracker` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `outcome-tracker` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { trackOutcomeDefinition } from "./definitions";

async function trackOutcomeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tracker = await import("../../../outcome-tracker");
  if (!ctx.tenantId) return { error: "Tenant context required for track_outcome" };
  const tenantId = ctx.tenantId;
  const personaId = ctx.personaId || 0;
  switch (params.action) {
    case "track": {
      const id = await tracker.trackAction({
        tenantId, personaId,
        actionType: params.actionType || "general",
        actionRef: params.actionRef,
        description: params.description || "Action tracked",
        expectedOutcome: params.expectedOutcome,
        expectedMetric: params.expectedMetric,
        expectedValue: params.expectedValue,
      });
      return { success: true, outcomeId: id, message: `Action tracked as outcome #${id}` };
    }
    case "record_result": {
      if (!params.outcomeId) return { error: "outcomeId required for record_result" };
      await tracker.recordOutcome(params.outcomeId, tenantId, params.actualValue ?? null, params.actualOutcome || "", params.status || "unknown");
      return { success: true, message: `Outcome #${params.outcomeId} updated to ${params.status}` };
    }
    case "view": {
      const outcomes = await tracker.getOutcomes(tenantId, {
        personaId: params.personaId || personaId || undefined,
        actionType: params.actionType,
        status: params.status,
        limit: 20,
      });
      return { outcomes, count: outcomes.length };
    }
    case "view_patterns": {
      const patterns = await tracker.getPatterns(tenantId, personaId || undefined);
      return { patterns, count: patterns.length };
    }
    default:
      return { error: `Unknown action: ${params.action}` };
  }
}

/** Registered by ./index.ts at import time. */
export const outcomeTrackingDomainTools: RegisteredTool[] = [
  defineTool(trackOutcomeDefinition, trackOutcomeHandler),
];

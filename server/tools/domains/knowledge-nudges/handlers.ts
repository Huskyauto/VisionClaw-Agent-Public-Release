/**
 * Tools-layer-split S26e — knowledge-nudges-domain migrated handler.
 *
 * Selection: the single nudge-stats tool — `knowledge_nudge_stats`. Backed solely
 * by `server/knowledge-nudges` (`getNudgeStats`).
 *
 * Handler body is a MECHANICAL move of the legacy switch arm (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required" }`) AND as the
 * backing-lib `tenantId` scope. Migrated handler reads `ctx.tenantId` (the same
 * platform-derived value) in the SAME order with the IDENTICAL error string.
 * `_tenantId` is the ONLY stripped signal this arm read (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * The backing `../../../knowledge-nudges` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `knowledge-nudges` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { knowledgeNudgeStatsDefinition } from "./definitions";

async function knowledgeNudgeStatsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  try {
    const { getNudgeStats } = await import("../../../knowledge-nudges");
    const stats = await getNudgeStats(ctx.tenantId);
    return { stats };
  } catch (err: any) {
    return { error: `Knowledge nudge stats failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const knowledgeNudgesDomainTools: RegisteredTool[] = [
  defineTool(knowledgeNudgeStatsDefinition, knowledgeNudgeStatsHandler),
];

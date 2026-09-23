/**
 * Tools-layer-split S26e — user-modeling-domain migrated handler.
 *
 * Selection: the single dialectic user-model tool — `user_model_query`. Backed
 * solely by `server/user-modeling` (`queryUserModel`).
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
 * The backing `../../../user-modeling` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `user-modeling` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { userModelQueryDefinition } from "./definitions";

async function userModelQueryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  try {
    const { queryUserModel } = await import("../../../user-modeling");
    const result = await queryUserModel(ctx.tenantId, params.question);
    return { profile: result };
  } catch (err: any) {
    return { error: `User model query failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const userModelingDomainTools: RegisteredTool[] = [
  defineTool(userModelQueryDefinition, userModelQueryHandler),
];

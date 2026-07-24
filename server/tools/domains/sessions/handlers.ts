/**
 * Tools-layer-split S33 — sessions-domain migrated handlers.
 *
 * Selection: the 2 read-only session-inspection tools — `sessions_list` /
 * `sessions_history`. Backed solely by `server/sessions` (`sessionsList` /
 * `sessionsHistory`). `sessions_send` (reads `_sourcePersonaName` — deferred
 * carve-out) and `sessions_spawn` (subagent module, different backing) stay
 * legacy — see definitions.ts header.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — for its pre-existing fail-closed guard
 * (`if (!params._tenantId) return { error: "... cross-tenant isolation guard" }`)
 * AND as the backing-lib `tenantId` scope. Migrated handlers read `ctx.tenantId`
 * (the same platform-derived value) in the SAME order with IDENTICAL error
 * strings, guards, and forwarded params. No re-stamp is needed (the arms consumed
 * the signal themselves — a guard plus a discrete arg). `_tenantId` is the ONLY
 * stripped signal these two arms read (grepped — no `_personaId` /
 * `_conversationId` / `_projectId` / `_sourcePersonaName`).
 *
 * The backing `../../../sessions` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `server/sessions` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  sessionsListDefinition,
  sessionsHistoryDefinition,
} from "./definitions";

async function sessionsListHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for sessions_list (cross-tenant isolation guard)" };
  const { sessionsList } = await import("../../../sessions");
  return sessionsList({
    kinds: params.kinds,
    limit: params.limit,
    activeMinutes: params.activeMinutes,
    messageLimit: params.messageLimit,
    tenantId: ctx.tenantId,
  });
}

async function sessionsHistoryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for sessions_history (cross-tenant isolation guard)" };
  const { sessionsHistory } = await import("../../../sessions");
  return sessionsHistory({
    sessionKey: params.sessionKey,
    limit: params.limit,
    includeTools: params.includeTools,
    tenantId: ctx.tenantId,
  });
}

/** Registered by ./index.ts at import time. */
export const sessionsDomainTools: RegisteredTool[] = [
  defineTool(sessionsListDefinition, sessionsListHandler),
  defineTool(sessionsHistoryDefinition, sessionsHistoryHandler),
];

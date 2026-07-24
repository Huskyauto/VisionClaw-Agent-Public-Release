/**
 * Tools-layer-split — procedures-domain migrated handlers.
 *
 * The 3 AEvo procedure-edit tools reading only `_tenantId`. In the legacy
 * facade each was an individual switch arm that dispatched into
 * `./lib/aevo-meta-editor`.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (no renames, no
 * behavior change, no added gate). The ONLY edits: the caller-supplied
 * `params._tenantId` read becomes `ctx.tenantId` (the dispatcher strips +
 * re-stamps it from the trusted context), and the dynamic-import specifier is
 * re-based from the facade's `./lib/aevo-meta-editor` to
 * `../../../lib/aevo-meta-editor`. VERIFIED SAFE: the editor fns
 * (`listProcedureEdits`, `applyProcedureEdit`, `rollbackProcedureEdit`) read the
 * tenant solely via the explicit `tenantId` arg and read NO `_`-prefixed trust
 * signal; the destructive mutators self-enforce the platform-admin tenant gate
 * internally (unchanged). The sole external dependency is pulled via a
 * call-time dynamic `import(...)` inside each handler (acyclicity invariant,
 * plan.md S2; same seam as the finance/crm domains).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  listProcedureEditsDefinition,
  applyProcedureEditDefinition,
  rollbackProcedureEditDefinition,
} from "./definitions";

async function listProcedureEditsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for list_procedure_edits" };
  try {
    const { listProcedureEdits } = await import("../../../lib/aevo-meta-editor");
    const edits = await listProcedureEdits({
      tenantId: ctx.tenantId,
      status: params.status ? String(params.status) : undefined,
      targetId: params.targetId ? String(params.targetId) : undefined,
      limit: params.limit ? Number(params.limit) : undefined,
    });
    return { ok: true, edits };
  } catch (e: any) {
    return { ok: false, error: e?.message || "list_procedure_edits failed" };
  }
}

async function applyProcedureEditHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for apply_procedure_edit" };
  try {
    const { applyProcedureEdit } = await import("../../../lib/aevo-meta-editor");
    const editId = Number(params.editId);
    if (!Number.isInteger(editId) || editId <= 0) return { ok: false, error: "editId must be a positive integer" };
    return await applyProcedureEdit({ editId, tenantId: ctx.tenantId });
  } catch (e: any) {
    return { ok: false, error: e?.message || "apply_procedure_edit failed" };
  }
}

async function rollbackProcedureEditHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for rollback_procedure_edit" };
  try {
    const { rollbackProcedureEdit } = await import("../../../lib/aevo-meta-editor");
    const editId = Number(params.editId);
    if (!Number.isInteger(editId) || editId <= 0) return { ok: false, error: "editId must be a positive integer" };
    const reason = String(params.reason || "manual_rollback");
    return await rollbackProcedureEdit({ editId, tenantId: ctx.tenantId, reason });
  } catch (e: any) {
    return { ok: false, error: e?.message || "rollback_procedure_edit failed" };
  }
}

/** Registered by ./index.ts at import time. */
export const proceduresDomainTools: RegisteredTool[] = [
  defineTool(listProcedureEditsDefinition, listProcedureEditsHandler),
  defineTool(applyProcedureEditDefinition, applyProcedureEditHandler),
  defineTool(rollbackProcedureEditDefinition, rollbackProcedureEditHandler),
];

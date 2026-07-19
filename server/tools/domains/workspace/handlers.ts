/**
 * Tools-layer-split S13 — workspace-domain migrated handlers.
 *
 * Selection: the 6 durable per-task workspace-artifact tools (R98.27.7) —
 * `workspace_init`, `workspace_update_status`, `workspace_log_artifact`,
 * `workspace_read`, `workspace_finalize`, `workspace_list`. Adjacent
 * workspace-adjacent tools stay legacy per smallest-safe-batch:
 * `google_workspace` / `calendar_sync` are network-touching Google
 * integrations (network arms stay legacy — S9 pattern) and `project` is a
 * separate scattered arm.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edits: caller-supplied `params._tenantId` / `params._personaId` reads become
 * `ctx.tenantId` / `ctx.personaId` (the dispatcher strips + re-stamps them from
 * the trusted context), and the sole external dependency (`../../../lib/
 * task-workspace`) is pulled via a call-time dynamic `import(...)` inside each
 * handler — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2; same seam S8/S9/S11/S12 used). The
 * `typeof tid !== "number" || tid <= 0` tenant gate is preserved verbatim. No
 * tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  workspaceInitDefinition,
  workspaceUpdateStatusDefinition,
  workspaceLogArtifactDefinition,
  workspaceReadDefinition,
  workspaceFinalizeDefinition,
  workspaceListDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function workspaceInitHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_init requires tenant context" };
  try {
    const { initWorkspace } = await import("../../../lib/task-workspace");
    const out = await initWorkspace({
      tenantId: tid,
      jobId: String(params.job_id || ""),
      personaId: ctx.personaId,
      goal: String(params.goal || ""),
      plan: Array.isArray(params.plan) ? params.plan.map((s: any) => String(s)) : undefined,
      context: typeof params.context === "string" ? params.context : undefined,
    });
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_init failed: ${e?.message || String(e)}` };
  }
}

async function workspaceUpdateStatusHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_update_status requires tenant context" };
  try {
    const { updateWorkspaceStatus } = await import("../../../lib/task-workspace");
    const out = await updateWorkspaceStatus({
      tenantId: tid,
      jobId: String(params.job_id || ""),
      status: params.status,
      progress_note: typeof params.progress_note === "string" ? params.progress_note : undefined,
      next_steps: Array.isArray(params.next_steps) ? params.next_steps.map((s: any) => String(s)) : undefined,
      open_questions: Array.isArray(params.open_questions) ? params.open_questions.map((s: any) => String(s)) : undefined,
    });
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_update_status failed: ${e?.message || String(e)}` };
  }
}

async function workspaceLogArtifactHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_log_artifact requires tenant context" };
  try {
    const { logArtifact } = await import("../../../lib/task-workspace");
    const out = await logArtifact({
      tenantId: tid,
      jobId: String(params.job_id || ""),
      name: String(params.name || ""),
      content: String(params.content || ""),
    });
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_log_artifact failed: ${e?.message || String(e)}` };
  }
}

async function workspaceReadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_read requires tenant context" };
  try {
    const { readWorkspace } = await import("../../../lib/task-workspace");
    const out = await readWorkspace(tid, String(params.job_id || ""));
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_read failed: ${e?.message || String(e)}` };
  }
}

async function workspaceListHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_list requires tenant context" };
  try {
    const { listWorkspaces } = await import("../../../lib/task-workspace");
    const out = await listWorkspaces(tid, {
      include_finalized: params.include_finalized === true,
      limit: typeof params.limit === "number" ? params.limit : undefined,
    });
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_list failed: ${e?.message || String(e)}` };
  }
}

async function workspaceFinalizeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "workspace_finalize requires tenant context" };
  try {
    const { finalizeWorkspace } = await import("../../../lib/task-workspace");
    const out = await finalizeWorkspace({
      tenantId: tid,
      jobId: String(params.job_id || ""),
      outcome: params.outcome,
      summary: String(params.summary || ""),
      next_session_handoff: typeof params.next_session_handoff === "string" ? params.next_session_handoff : undefined,
    });
    return { success: true, ...out };
  } catch (e: any) {
    return { error: `workspace_finalize failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const workspaceDomainTools: RegisteredTool[] = [
  defineTool(workspaceInitDefinition, workspaceInitHandler),
  defineTool(workspaceUpdateStatusDefinition, workspaceUpdateStatusHandler),
  defineTool(workspaceLogArtifactDefinition, workspaceLogArtifactHandler),
  defineTool(workspaceReadDefinition, workspaceReadHandler),
  defineTool(workspaceFinalizeDefinition, workspaceFinalizeHandler),
  defineTool(workspaceListDefinition, workspaceListHandler),
];

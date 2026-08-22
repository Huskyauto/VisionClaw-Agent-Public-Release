/**
 * Tools-layer-split S25d — commitment-domain migrated handlers.
 *
 * Selection: the 5 contiguous `commitment_*` tools (R104 long-running-promise
 * primitive) — `commitment_create`, `commitment_list`, `commitment_heartbeat`,
 * `commitment_complete`, `commitment_cancel`. All 5 are backed by the single
 * `server/commitments` module (createCommitment / listCommitments /
 * recordHeartbeat / setCommitmentStatus), so they form a clean smallest-safe
 * batch.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edit: caller-supplied `params._tenantId` reads become `ctx.tenantId` (the
 * dispatcher strips + re-stamps it from the trusted context). No other trust
 * signal is read — `commitment_create` reads `params._personaName`, which is a
 * DELIBERATELY non-stripped, non-authoritative passthrough (see
 * server/tools/context.ts TRUST_SIGNAL_KEYS note) and therefore stays a verbatim
 * `params` read. The backing dependency (`../../../commitments`) is pulled via a
 * call-time dynamic `import(...)` inside each handler — NOT a top-level static
 * import — so the domain module statically imports only within server/tools/ and
 * cannot recurse back into the app graph (acyclicity invariant, plan.md S2; same
 * seam S8/S9/S11 used). No tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  commitmentCreateDefinition,
  commitmentListDefinition,
  commitmentHeartbeatDefinition,
  commitmentCompleteDefinition,
  commitmentCancelDefinition,
} from "./definitions";

async function commitmentCreateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for commitment_create" };
  const { createCommitment } = await import("../../../commitments");
  try {
    const row = await createCommitment({
      tenantId: ctx.tenantId,
      persona: params._personaName ? String(params._personaName) : (params.persona ? String(params.persona) : undefined),
      description: String(params.description || ""),
      dueAt: params.due_at || params.dueAt || null,
      heartbeatIntervalMs: params.heartbeat_interval_ms ? Number(params.heartbeat_interval_ms) : undefined,
    });
    return { ok: true, id: row.id, status: row.status, due_at: row.dueAt, heartbeat_interval_ms: row.heartbeatIntervalMs };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function commitmentListHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for commitment_list" };
  const { listCommitments } = await import("../../../commitments");
  const rows = await listCommitments(ctx.tenantId, params.status as any);
  return { count: rows.length, commitments: rows };
}

async function commitmentHeartbeatHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for commitment_heartbeat" };
  if (!params.id) return { error: "id is required" };
  const { recordHeartbeat } = await import("../../../commitments");
  try {
    const row = await recordHeartbeat(ctx.tenantId, Number(params.id), String(params.note || ""), params.evidence);
    return { ok: true, id: row.id, status: row.status, last_heartbeat_at: row.lastHeartbeatAt };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function commitmentCompleteHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for commitment_complete" };
  if (!params.id) return { error: "id is required" };
  const { setCommitmentStatus } = await import("../../../commitments");
  try {
    const row = await setCommitmentStatus(ctx.tenantId, Number(params.id), "completed", params.note ? String(params.note) : undefined);
    return { ok: true, id: row.id, status: row.status };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function commitmentCancelHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for commitment_cancel" };
  if (!params.id) return { error: "id is required" };
  const { setCommitmentStatus } = await import("../../../commitments");
  try {
    const row = await setCommitmentStatus(ctx.tenantId, Number(params.id), "cancelled", params.reason ? String(params.reason) : undefined);
    return { ok: true, id: row.id, status: row.status };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

/** Registered by ./index.ts at import time. */
export const commitmentDomainTools: RegisteredTool[] = [
  defineTool(commitmentCreateDefinition, commitmentCreateHandler),
  defineTool(commitmentListDefinition, commitmentListHandler),
  defineTool(commitmentHeartbeatDefinition, commitmentHeartbeatHandler),
  defineTool(commitmentCompleteDefinition, commitmentCompleteHandler),
  defineTool(commitmentCancelDefinition, commitmentCancelHandler),
];

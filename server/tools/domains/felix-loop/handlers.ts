/**
 * Tools-layer-split S25i — felix-loop-domain migrated handlers.
 *
 * Selection: the 7 contiguous Felix autonomous-loop tools —
 * `felix_loop_status`, `list_felix_loop_runs`, `list_felix_proposals`,
 * `approve_felix_proposal`, `reject_felix_proposal`, `felix_loop_run_now`,
 * `execute_felix_proposal`. All backed by the single `server/felix-loop`
 * module, one thematically coherent cluster. (`verify_felix_proposal_spec`
 * already migrated in S10 → the quality domain; it is NOT part of this slice.)
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). Seam edit:
 * the caller-supplied trust signal becomes the trusted `ctx` value (the
 * dispatcher strips + re-stamps it) — `params._tenantId`→`ctx.tenantId`
 * everywhere. This includes the four OWNER-ONLY tools whose guard is the
 * VERBATIM Bob-only check `_tenantId !== 1` → `ctx.tenantId !== 1`
 * (approve/reject/run_now/execute); the check is moved unchanged, only its
 * source flips from the forgeable param to the trusted ctx (a STRENGTHENING —
 * the owner gate can no longer be spoofed by a caller-supplied `_tenantId`).
 * The PUBLIC params (`params.id`, `params.reason`, `params.limit`,
 * `params.status`) stay verbatim `params` reads — none is a trust signal.
 * The backing dependency (`../../../felix-loop`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import —
 * so the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8/S9/S11/S25d/S25e/S25g/S25h used).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  felixLoopStatusDefinition,
  listFelixLoopRunsDefinition,
  listFelixProposalsDefinition,
  approveFelixProposalDefinition,
  rejectFelixProposalDefinition,
  felixLoopRunNowDefinition,
  executeFelixProposalDefinition,
} from "./definitions";

async function felixLoopStatusHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for felix_loop_status (R95.c — no tenant-1 fallback)" };
  const { getFelixLoopStatus } = await import("../../../felix-loop");
  return await getFelixLoopStatus(ctx.tenantId);
}

async function listFelixLoopRunsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for list_felix_loop_runs (R95.c — no tenant-1 fallback)" };
  const { listFelixLoopRuns } = await import("../../../felix-loop");
  return await listFelixLoopRuns(ctx.tenantId, Number(params.limit) || 10);
}

async function listFelixProposalsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for list_felix_proposals (R95.c — no tenant-1 fallback)" };
  const { listFelixProposals } = await import("../../../felix-loop");
  return await listFelixProposals({ tenantId: ctx.tenantId, status: params.status, limit: Number(params.limit) || 20 });
}

async function approveFelixProposalHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "approve_felix_proposal is Bob-only (owner tenant)" };
  if (!params.id) return { error: "id is required" };
  const { approveFelixProposal } = await import("../../../felix-loop");
  return await approveFelixProposal(Number(params.id), ctx.tenantId, "bob");
}

async function rejectFelixProposalHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "reject_felix_proposal is Bob-only (owner tenant)" };
  if (!params.id) return { error: "id is required" };
  if (!params.reason) return { error: "reason is required so Felix learns what not to propose" };
  const { rejectFelixProposal } = await import("../../../felix-loop");
  return await rejectFelixProposal(Number(params.id), String(params.reason), ctx.tenantId, "bob");
}

async function felixLoopRunNowHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "felix_loop_run_now is Bob-only (owner tenant)" };
  const { runFelixLoop } = await import("../../../felix-loop");
  return await runFelixLoop({ tenantId: ctx.tenantId, force: true });
}

async function executeFelixProposalHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "execute_felix_proposal is Bob-only (owner tenant)" };
  if (!params.id) return { error: "id is required" };
  const { executeFelixProposal } = await import("../../../felix-loop");
  return await executeFelixProposal(Number(params.id), ctx.tenantId, "bob");
}

/** Registered by ./index.ts at import time. */
export const felixLoopDomainTools: RegisteredTool[] = [
  defineTool(felixLoopStatusDefinition, felixLoopStatusHandler),
  defineTool(listFelixLoopRunsDefinition, listFelixLoopRunsHandler),
  defineTool(listFelixProposalsDefinition, listFelixProposalsHandler),
  defineTool(approveFelixProposalDefinition, approveFelixProposalHandler),
  defineTool(rejectFelixProposalDefinition, rejectFelixProposalHandler),
  defineTool(felixLoopRunNowDefinition, felixLoopRunNowHandler),
  defineTool(executeFelixProposalDefinition, executeFelixProposalHandler),
];

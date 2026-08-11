/**
 * Tools-layer-split S25k — sprint-contracts-domain migrated handlers.
 *
 * Selection: the 3 contiguous R115.5 "Sprint Contract" tools —
 * `pin_done_condition`, `get_done_condition`, `evaluate_against_contract`. All
 * backed by `server/lib/sprint-contract` (pinDoneCondition / getDoneCondition /
 * evaluateAgainstContract), one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). Seam edit:
 * the caller-supplied trust signal becomes the trusted `ctx` value (the
 * dispatcher strips + re-stamps it) — `params._tenantId`→`ctx.tenantId`. The
 * attribution reads `params._personaName` / `params._userId` (pinnedBy /
 * scoredBy) STAY verbatim `params` reads: they are DELIBERATELY absent from the
 * dispatcher's TRUST_SIGNAL_KEYS (non-authoritative passthroughs, see
 * server/tools/context.ts), so a migrated handler reads them from params
 * exactly as the legacy arm did (media/agentic precedent). All other PUBLIC
 * params (refKind, refId, doneCondition, criteria, force, status, evidence,
 * verdict, scoredBy, notes) stay verbatim `params` reads — none is a trust
 * signal. The backing dependency (`../../../lib/sprint-contract`) is pulled via
 * call-time dynamic `import(...)` inside each handler — NOT a top-level static
 * import — so the domain module statically imports only within server/tools/
 * and cannot recurse back into the app graph (acyclicity invariant, plan.md S2;
 * mirrors the tensions/memory/knowledge domains' dynamic-import seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  pinDoneConditionDefinition,
  getDoneConditionDefinition,
  evaluateAgainstContractDefinition,
} from "./definitions";

async function pinDoneConditionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for pin_done_condition" };
  try {
    const { pinDoneCondition } = await import("../../../lib/sprint-contract");
    return await pinDoneCondition({
      tenantId: ctx.tenantId,
      refKind: String(params.refKind || ""),
      refId: String(params.refId || ""),
      doneCondition: String(params.doneCondition || ""),
      criteria: (params.criteria && typeof params.criteria === "object") ? params.criteria : undefined,
      pinnedBy: String(params._personaName || params._userId || "agent"),
      force: Boolean(params.force),
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "pin_done_condition failed" };
  }
}

async function getDoneConditionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for get_done_condition" };
  try {
    const { getDoneCondition } = await import("../../../lib/sprint-contract");
    return await getDoneCondition({
      tenantId: ctx.tenantId,
      refKind: String(params.refKind || ""),
      refId: String(params.refId || ""),
      status: params.status ? String(params.status) as any : undefined,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "get_done_condition failed" };
  }
}

async function evaluateAgainstContractHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for evaluate_against_contract" };
  try {
    const { evaluateAgainstContract } = await import("../../../lib/sprint-contract");
    return await evaluateAgainstContract({
      tenantId: ctx.tenantId,
      refKind: String(params.refKind || ""),
      refId: String(params.refId || ""),
      evidence: String(params.evidence || ""),
      verdict: String(params.verdict || "") as any,
      scoredBy: params.scoredBy ? String(params.scoredBy) : String(params._personaName || params._userId || "agent"),
      notes: params.notes ? String(params.notes) : undefined,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "evaluate_against_contract failed" };
  }
}

/** Registered by ./index.ts at import time. */
export const sprintContractsDomainTools: RegisteredTool[] = [
  defineTool(pinDoneConditionDefinition, pinDoneConditionHandler),
  defineTool(getDoneConditionDefinition, getDoneConditionHandler),
  defineTool(evaluateAgainstContractDefinition, evaluateAgainstContractHandler),
];

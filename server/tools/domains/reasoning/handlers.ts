/**
 * Tools-layer-split S25e — reasoning-domain migrated handlers.
 *
 * Selection: the 7 contiguous "LuaN1aoAgent nuggets" reasoning primitives —
 * `attribute_failure` (R106 N1, failure attribution), `hypothesis_pin` /
 * `hypothesis_list_pinned` (R106 N4, pinned hypotheses), `plan_graph_edit` /
 * `plan_graph_query` (R106 N5, Plan-on-Graph), `hypothesis_attach_evidence` /
 * `hypothesis_evidence_chain` (R108 B, causal-graph evidence). Backed by three
 * server/lib modules (`failure-attribution`, `pinned-hypotheses`, `plan-graph`),
 * all thematically one agentic-reasoning cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). Seam edits:
 * caller-supplied trust signals become the trusted `ctx` values (the dispatcher
 * strips + re-stamps them) — `params._tenantId`→`ctx.tenantId` (all 7),
 * `params._conversationId`→`ctx.conversationId` and `params._personaId`→
 * `ctx.personaId` (only `hypothesis_pin` + `hypothesis_list_pinned`, which read
 * them). The PUBLIC `params.conversation_id` param on `hypothesis_list_pinned`
 * is NOT a trust signal and stays a verbatim `params` read (it only falls back
 * to `ctx.conversationId`). No other trust key is read. Backing dependencies
 * (`../../../lib/failure-attribution`, `../../../lib/pinned-hypotheses`,
 * `../../../lib/plan-graph`) are pulled via call-time dynamic `import(...)`
 * inside each handler — NOT top-level static imports — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2; same seam S8/S9/S11/S25d used).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  attributeFailureDefinition,
  hypothesisPinDefinition,
  hypothesisListPinnedDefinition,
  planGraphEditDefinition,
  planGraphQueryDefinition,
  hypothesisAttachEvidenceDefinition,
  hypothesisEvidenceChainDefinition,
} from "./definitions";

async function attributeFailureHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for attribute_failure" };
  if (!params.scope || !params.scope_ref || !params.level || !params.detail) {
    return { error: "scope, scope_ref, level, detail are required" };
  }
  const lvl = String(params.level).toUpperCase();
  if (!["L0", "L1", "L2", "L3", "L4", "L5"].includes(lvl)) return { error: "level must be one of L0..L5" };
  const { recordAttribution, recentAttributions, decideNextAction } = await import("../../../lib/failure-attribution");
  try {
    const row = await recordAttribution({
      tenantId: ctx.tenantId,
      scope: String(params.scope),
      scopeRef: String(params.scope_ref),
      level: lvl as any,
      detail: String(params.detail || ""),
      context: typeof params.context === "object" && params.context !== null ? params.context : {},
    });
    const history = await recentAttributions(ctx.tenantId, row.scope, row.scopeRef, 10);
    const decision = decideNextAction(history);
    return {
      ok: true,
      id: row.id,
      level: row.level,
      recommended_action: decision.action,
      reason: decision.reason,
      promoted_to_strategic: decision.promoted === true,
      history_count: history.length,
    };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function hypothesisPinHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for hypothesis_pin" };
  if (!params.hypothesis) return { error: "hypothesis is required" };
  const ttl = typeof params.ttl_minutes === "number"
    ? Math.max(1, Math.min(1440, params.ttl_minutes))
    : undefined;
  const { pinHypothesis } = await import("../../../lib/pinned-hypotheses");
  try {
    const row = await pinHypothesis({
      tenantId: ctx.tenantId,
      conversationId: typeof ctx.conversationId === "number" ? ctx.conversationId : null,
      personaId: typeof ctx.personaId === "number" ? ctx.personaId : null,
      hypothesis: String(params.hypothesis).slice(0, 1000),
      confidence: typeof params.confidence === "number" ? params.confidence : undefined,
      ttlMinutes: ttl,
    });
    return { ok: true, id: row.id, expires_at: row.expiresAt };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function hypothesisListPinnedHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for hypothesis_list_pinned" };
  const { listActivePinned } = await import("../../../lib/pinned-hypotheses");
  const rows = await listActivePinned({
    tenantId: ctx.tenantId,
    conversationId: typeof params.conversation_id === "number" ? params.conversation_id
      : (typeof ctx.conversationId === "number" ? ctx.conversationId : undefined),
    personaId: typeof ctx.personaId === "number" ? ctx.personaId : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  return { count: rows.length, pinned: rows };
}

async function planGraphEditHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for plan_graph_edit" };
  if (!params.plan_id || !Array.isArray(params.ops)) return { error: "plan_id and ops[] are required" };
  const { applyPlanEdits } = await import("../../../lib/plan-graph");
  try {
    const r = await applyPlanEdits({
      tenantId: ctx.tenantId,
      planId: String(params.plan_id),
      ops: params.ops as any,
    });
    if (r.cycleDetected) {
      return { ok: false, applied: r.applied, plan_size: r.planSize, error: `cycle detected: ${r.cycleDetected}`, cycle: r.cycleDetected };
    }
    return { ok: true, applied: r.applied, plan_size: r.planSize };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function planGraphQueryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for plan_graph_query" };
  if (!params.plan_id) return { error: "plan_id is required" };
  const { queryPlan } = await import("../../../lib/plan-graph");
  const r = await queryPlan({ tenantId: ctx.tenantId, planId: String(params.plan_id) });
  return {
    plan_id: String(params.plan_id),
    node_count: r.nodes.length,
    ready: r.ready,
    blocked: r.blocked,
    completed: r.completed,
    failed: r.failed,
    nodes: r.nodes,
  };
}

async function hypothesisAttachEvidenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for hypothesis_attach_evidence" };
  if (typeof params.hypothesis_id !== "number") return { error: "hypothesis_id (number) is required" };
  if (!params.evidence_kind || !params.evidence_ref) return { error: "evidence_kind and evidence_ref are required" };
  const { attachEvidence } = await import("../../../lib/pinned-hypotheses");
  try {
    const r = await attachEvidence({
      tenantId: ctx.tenantId,
      hypothesisId: params.hypothesis_id,
      evidenceKind: String(params.evidence_kind),
      evidenceRef: String(params.evidence_ref).slice(0, 1000),
      confidence: typeof params.confidence === "number" ? params.confidence : undefined,
      note: typeof params.note === "string" ? params.note.slice(0, 1000) : null,
    });
    return { ok: true, id: r.id, created_at: r.createdAt };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function hypothesisEvidenceChainHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for hypothesis_evidence_chain" };
  if (typeof params.hypothesis_id !== "number") return { error: "hypothesis_id (number) is required" };
  const { listEvidence } = await import("../../../lib/pinned-hypotheses");
  const rows = await listEvidence({
    tenantId: ctx.tenantId,
    hypothesisId: params.hypothesis_id,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  return { count: rows.length, evidence: rows };
}

/** Registered by ./index.ts at import time. */
export const reasoningDomainTools: RegisteredTool[] = [
  defineTool(attributeFailureDefinition, attributeFailureHandler),
  defineTool(hypothesisPinDefinition, hypothesisPinHandler),
  defineTool(hypothesisListPinnedDefinition, hypothesisListPinnedHandler),
  defineTool(planGraphEditDefinition, planGraphEditHandler),
  defineTool(planGraphQueryDefinition, planGraphQueryHandler),
  defineTool(hypothesisAttachEvidenceDefinition, hypothesisAttachEvidenceHandler),
  defineTool(hypothesisEvidenceChainDefinition, hypothesisEvidenceChainHandler),
];

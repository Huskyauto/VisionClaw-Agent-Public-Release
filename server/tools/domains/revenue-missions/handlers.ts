/**
 * Verified Revenue Missions S5a — handlers for the 4 owner-only mission tools.
 *
 * All four gate on ctx.tenantId (dispatcher-derived, never params) with the
 * fail-closed owner-only check (tenantId !== 1 rejects) — mirrors the
 * cost-ledger domain pattern.
 *
 * Backing libs (`server/lib/revenue-missions`, `server/lib/mission-sample-harvest`)
 * are pulled via call-time dynamic import — NOT top-level static imports — so the
 * domain module statically imports only within server/tools/ (acyclicity
 * invariant, tools-layer-split plan.md S2). Neither lib imports the tools facade.
 *
 * SAFETY CONTRACT (data/feature-contracts/revenue-missions): approve/kill are
 * deliberately NOT tools — approval lives behind the owner API + admin UI only.
 * `revenue_mission_draft_experiment` sends nothing: it persists an
 * 'awaiting_approval' packet; the S3 launch path fail-closes on
 * approved_by_owner_at. Caps enforced in the lib (refuse-not-truncate).
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  revenueMissionCreateDefinition,
  revenueMissionListDefinition,
  revenueMissionStatusDefinition,
  revenueMissionDraftExperimentDefinition,
  missionPortfolioReviewDefinition,
} from "./definitions";

async function ownerGate(ctx: ToolContext, toolName: string): Promise<{ tenantId: number } | { error: string }> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  // Single source of truth for the owner tenant (env-configurable OWNER_TENANT_ID,
  // default 1) — matches the route-layer gate in server/routes/revenue-missions.ts.
  // Call-time dynamic import preserves the tools-layer acyclicity invariant.
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) return { error: `${toolName} is owner-only (revenue missions are the owner's business experiments)` };
  return { tenantId };
}

async function revenueMissionCreateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "revenue_mission_create");
  if ("error" in gate) return gate;
  const name = typeof params.name === "string" ? params.name.trim() : "";
  const hypothesis = typeof params.hypothesis === "string" ? params.hypothesis.trim() : "";
  const idealCustomer = typeof params.idealCustomer === "string" ? params.idealCustomer.trim() : "";
  const offer = typeof params.offer === "string" ? params.offer.trim() : "";
  if (!name || !hypothesis || !idealCustomer || !offer) {
    return { error: "revenue_mission_create requires non-empty name, hypothesis, idealCustomer, and offer" };
  }
  try {
    const { createMission } = await import("../../../lib/revenue-missions");
    const mission = await createMission({
      tenantId: gate.tenantId,
      name,
      hypothesis,
      idealCustomer,
      offer,
      priceUsd: typeof params.priceUsd === "number" && Number.isFinite(params.priceUsd) ? params.priceUsd : undefined,
      painStatement: typeof params.painStatement === "string" ? params.painStatement : undefined,
      successCriteria: typeof params.successCriteria === "string" ? params.successCriteria : undefined,
      killCriteria: typeof params.killCriteria === "string" ? params.killCriteria : undefined,
    });
    return {
      mission,
      note: "Mission created at stage 'hypothesis'. Nothing sends without a drafted experiment PLUS explicit owner approval in the admin UI (/admin/revenue-missions).",
    };
  } catch (err: any) {
    return { error: `revenue_mission_create failed: ${err.message}` };
  }
}

async function revenueMissionListHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "revenue_mission_list");
  if ("error" in gate) return gate;
  try {
    const { listMissions } = await import("../../../lib/revenue-missions");
    const missions = await listMissions(gate.tenantId);
    return { count: missions.length, missions };
  } catch (err: any) {
    return { error: `revenue_mission_list failed: ${err.message}` };
  }
}

async function revenueMissionStatusHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "revenue_mission_status");
  if ("error" in gate) return gate;
  const missionId = Number(params.missionId);
  if (!Number.isSafeInteger(missionId) || missionId <= 0) {
    return { error: "revenue_mission_status requires a positive integer missionId" };
  }
  try {
    const lib = await import("../../../lib/revenue-missions");
    const mission = await lib.getMission(gate.tenantId, missionId);
    if (!mission) return { error: `mission ${missionId} not found` };
    const [doneChecks, evidence, experiments] = await Promise.all([
      lib.computeDoneChecks(gate.tenantId, missionId),
      lib.listEvidence(gate.tenantId, missionId),
      lib.listExperiments(gate.tenantId, missionId),
    ]);
    return {
      mission,
      doneChecks,
      evidence: evidence.slice(0, 25),
      evidenceCount: evidence.length,
      experiments: experiments.map((e: any) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        approvedByOwnerAt: e.approved_by_owner_at ?? null,
        prospects: Array.isArray(e.prospects) ? e.prospects.length : null,
        maxProspects: e.max_prospects,
        maxSpendUsdCents: e.max_spend_usd_cents,
      })),
    };
  } catch (err: any) {
    return { error: `revenue_mission_status failed: ${err.message}` };
  }
}

async function revenueMissionDraftExperimentHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "revenue_mission_draft_experiment");
  if ("error" in gate) return gate;
  const missionId = Number(params.missionId);
  if (!Number.isSafeInteger(missionId) || missionId <= 0) {
    return { error: "revenue_mission_draft_experiment requires a positive integer missionId" };
  }
  try {
    const { draftSampleExperiment } = await import("../../../lib/mission-sample-harvest");
    const result = await draftSampleExperiment({
      tenantId: gate.tenantId,
      missionId,
      name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
    });
    return {
      experimentId: result.experiment?.id,
      status: result.experiment?.status,
      harvestedCount: result.harvestedCount,
      matchedCount: result.matchedCount,
      belowMinimum: result.belowMinimum,
      note: "Draft persisted as 'awaiting_approval'. NOTHING has been sent — the owner must approve this experiment in the admin UI (/admin/revenue-missions) before any outreach fires.",
    };
  } catch (err: any) {
    return { error: `revenue_mission_draft_experiment failed: ${err.message}` };
  }
}

async function missionPortfolioReviewHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "mission_portfolio_review");
  if ("error" in gate) return gate;
  try {
    const { reviewPortfolio } = await import("../../../lib/mission-capital-allocator");
    const review = await reviewPortfolio(gate.tenantId);
    return {
      ...review,
      note: "Advisory only — recommendations are inputs to the OWNER's decision in the admin UI (/admin/revenue-missions). Nothing here kills, approves, or changes autonomy.",
    };
  } catch (err: any) {
    return { error: `mission_portfolio_review failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const revenueMissionsDomainTools: RegisteredTool[] = [
  defineTool(revenueMissionCreateDefinition, revenueMissionCreateHandler),
  defineTool(revenueMissionListDefinition, revenueMissionListHandler),
  defineTool(revenueMissionStatusDefinition, revenueMissionStatusHandler),
  defineTool(revenueMissionDraftExperimentDefinition, revenueMissionDraftExperimentHandler),
  defineTool(missionPortfolioReviewDefinition, missionPortfolioReviewHandler),
];

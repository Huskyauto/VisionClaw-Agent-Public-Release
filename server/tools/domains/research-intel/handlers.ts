/**
 * Tools-layer-split S25k — research-intel domain migrated handlers.
 *
 * Selection: the 9 tools that remained in the SHARED case-fallthrough block that
 * dispatched (via one `fnMap`) into `./agentic-features` after S16 split the 8
 * outreach labels off the tail. In the legacy facade the block was one tenant
 * gate (`if (!params._tenantId) return { error: "Tenant context required" }`)
 * followed by `fn({ tenantId: params._tenantId, ...params })` where `fn` was
 * looked up by tool name in a single `fnMap`.
 *
 * Handler bodies are MECHANICAL moves of the legacy dispatch arm (standing
 * rules: no renames, no behavior change, error string verbatim). The ONLY edit:
 * the caller-supplied `params._tenantId` read becomes `ctx.tenantId` (the
 * dispatcher strips + re-stamps it from the trusted context). VERIFIED SAFE: the
 * 9 `agentic-features` fns take `{ tenantId, ...realParams }` and read NO
 * `_`-prefixed trust signal (no `_personaId`/`_conversationId`/`_userId`/
 * `_personaName` reads anywhere in `server/agentic-features.ts`), so passing the
 * dispatcher-stripped `params` alongside `tenantId: ctx.tenantId` is behavior-
 * identical to the legacy `fn({ tenantId, ...params })`. The sole external
 * dependency (`../../../agentic-features`) is pulled via a call-time dynamic
 * `import(...)` inside each handler — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8–S16/S25j used).
 *
 * The `{ tenantId, ...params } as any` cast is behavior-identical to the legacy
 * dispatch: the facade routed these through a `fnMap: Record<string, Function>`,
 * which erased the arg signatures so tsc never checked the concrete required
 * params (they arrive at runtime from the untyped tool `params` record). The
 * type-only cast reproduces that erasure exactly — zero runtime effect.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  saveEvidenceDefinition,
  queryEvidenceDefinition,
  synthesizeResearchDefinition,
  addCompetitorDefinition,
  listCompetitorsDefinition,
  takeCompetitorSnapshotDefinition,
  detectCompetitorChangesDefinition,
  competitorBriefingDefinition,
  defineIcpDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy shared fnMap dispatch arm)
// ---------------------------------------------------------------------------

async function saveEvidenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.saveEvidence({ tenantId: ctx.tenantId, ...params } as any);
}

async function queryEvidenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.queryEvidence({ tenantId: ctx.tenantId, ...params } as any);
}

async function synthesizeResearchHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.synthesizeResearch({ tenantId: ctx.tenantId, ...params } as any);
}

async function addCompetitorHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.addCompetitor({ tenantId: ctx.tenantId, ...params } as any);
}

async function listCompetitorsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.listCompetitors({ tenantId: ctx.tenantId, ...params } as any);
}

async function takeCompetitorSnapshotHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.takeCompetitorSnapshot({ tenantId: ctx.tenantId, ...params } as any);
}

async function detectCompetitorChangesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.detectCompetitorChanges({ tenantId: ctx.tenantId, ...params } as any);
}

async function competitorBriefingHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.competitorBriefing({ tenantId: ctx.tenantId, ...params } as any);
}

async function defineIcpHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.defineICP({ tenantId: ctx.tenantId, ...params } as any);
}

/** Registered by ./index.ts at import time. */
export const researchIntelDomainTools: RegisteredTool[] = [
  defineTool(saveEvidenceDefinition, saveEvidenceHandler),
  defineTool(queryEvidenceDefinition, queryEvidenceHandler),
  defineTool(synthesizeResearchDefinition, synthesizeResearchHandler),
  defineTool(addCompetitorDefinition, addCompetitorHandler),
  defineTool(listCompetitorsDefinition, listCompetitorsHandler),
  defineTool(takeCompetitorSnapshotDefinition, takeCompetitorSnapshotHandler),
  defineTool(detectCompetitorChangesDefinition, detectCompetitorChangesHandler),
  defineTool(competitorBriefingDefinition, competitorBriefingHandler),
  defineTool(defineIcpDefinition, defineIcpHandler),
];

/**
 * Tools-layer-split S25j — tensions-domain migrated handlers.
 *
 * Selection: the 6 contiguous DreamGraph "Tensions + ADRs" tools —
 * `create_tension`, `list_open_tensions`, `resolve_tension`, `create_adr`,
 * `list_adrs`, `supersede_adr` (R74.13z-quint+2). All backed by `storage`
 * methods (createTension / listTensions / resolveTension / createAdr /
 * listAdrs / supersedeAdr), one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim — including the
 * "(_tenantId)" fragment inside the tenant-context refusal strings). Seam edit:
 * the caller-supplied trust signal becomes the trusted `ctx` value (the
 * dispatcher strips + re-stamps it) — `params._tenantId`→`ctx.tenantId`
 * everywhere. The PUBLIC params (`params.title`, `params.tension_id`,
 * `params.old_adr_id`, etc.) stay verbatim `params` reads — none is a trust
 * signal. The backing dependency (`../../../storage`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import —
 * so the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8/S9/S11/S25d/S25e/S25g/S25h/S25i used, mirroring the memory/knowledge
 * domains' `const { storage } = await import("../../../storage")`).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createTensionDefinition,
  listOpenTensionsDefinition,
  resolveTensionDefinition,
  createAdrDefinition,
  listAdrsDefinition,
  supersedeAdrDefinition,
} from "./definitions";

async function createTensionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "create_tension requires tenant context (_tenantId). Refusing to default to owner tenant." };
  }
  const title = String(params.title || "").trim();
  if (!title) return { error: "title is required" };
  const { storage } = await import("../../../storage");
  const row = await storage.createTension({
    tenantId: ctx.tenantId,
    title,
    predictedState: params.predicted_state ?? {},
    actualState: params.actual_state ?? {},
    evidence: Array.isArray(params.evidence) ? params.evidence : [],
    ownerPersonaId: params.owner_persona_id ?? null,
    sourceKind: "manual",
    sourceId: null,
    status: "open",
  } as any);
  return { id: row.id, title: row.title, status: row.status, created_at: row.createdAt };
}

async function listOpenTensionsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "list_open_tensions requires tenant context (_tenantId)." };
  }
  const { storage } = await import("../../../storage");
  const rows = await storage.listTensions(ctx.tenantId, {
    status: params.status || "open",
    sourceKind: params.source_kind,
    ownerPersonaId: params.owner_persona_id,
    limit: Math.min(500, Number(params.limit) || 100),
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, source_kind: r.sourceKind,
    owner_persona_id: r.ownerPersonaId,
    predicted: r.predictedState, actual: r.actualState,
    evidence: r.evidence, created_at: r.createdAt,
  }));
}

async function resolveTensionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "resolve_tension requires tenant context (_tenantId)." };
  }
  const tensionId = Number(params.tension_id);
  if (!Number.isFinite(tensionId)) return { error: "tension_id must be a number" };
  const resolution = String(params.resolution || "").trim();
  if (!resolution) return { error: "resolution is required" };
  const { storage } = await import("../../../storage");
  const row = await storage.resolveTension(tensionId, ctx.tenantId, resolution, params.resolution_evidence ?? {});
  if (!row) return { error: `Tension ${tensionId} not found in this tenant` };
  return { id: row.id, status: row.status, resolved_at: row.resolvedAt, resolution: row.resolution };
}

async function createAdrHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "create_adr requires tenant context (_tenantId)." };
  }
  const title = String(params.title || "").trim();
  const context = String(params.context || "").trim();
  const decision = String(params.decision || "").trim();
  const consequences = String(params.consequences || "").trim();
  if (!title || !context || !decision || !consequences) {
    return { error: "title, context, decision, and consequences are all required" };
  }
  const status = ["proposed", "accepted", "deprecated", "superseded"].includes(params.status) ? params.status : "accepted";
  const { storage } = await import("../../../storage");
  const row = await storage.createAdr({
    tenantId: ctx.tenantId,
    title,
    context,
    decision,
    consequences,
    status,
    tags: Array.isArray(params.tags) ? params.tags : [],
    authorPersonaId: params.author_persona_id ?? null,
  } as any);
  return { id: row.id, title: row.title, status: row.status, created_at: row.createdAt };
}

async function listAdrsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "list_adrs requires tenant context (_tenantId)." };
  }
  const { storage } = await import("../../../storage");
  const rows = await storage.listAdrs(ctx.tenantId, {
    status: params.status,
    tag: params.tag,
    limit: Math.min(500, Number(params.limit) || 100),
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, tags: r.tags,
    context: r.context, decision: r.decision, consequences: r.consequences,
    supersedes: r.supersedes, superseded_by: r.supersededBy,
    author_persona_id: r.authorPersonaId, created_at: r.createdAt,
  }));
}

async function supersedeAdrHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { error: "supersede_adr requires tenant context (_tenantId)." };
  }
  const oldId = Number(params.old_adr_id);
  const newId = Number(params.new_adr_id);
  const reason = String(params.reason || "").trim();
  if (!Number.isFinite(oldId) || !Number.isFinite(newId)) return { error: "old_adr_id and new_adr_id must be numbers" };
  if (!reason) return { error: "reason is required" };
  const { storage } = await import("../../../storage");
  const result = await storage.supersedeAdr(oldId, newId, ctx.tenantId, reason);
  if (!result) return { error: "Could not find both ADRs in this tenant" };
  return {
    old: { id: result.old.id, status: result.old.status, superseded_by: result.old.supersededBy },
    new: { id: result.new.id, status: result.new.status, supersedes: result.new.supersedes },
  };
}

/** Registered by ./index.ts at import time. */
export const tensionsDomainTools: RegisteredTool[] = [
  defineTool(createTensionDefinition, createTensionHandler),
  defineTool(listOpenTensionsDefinition, listOpenTensionsHandler),
  defineTool(resolveTensionDefinition, resolveTensionHandler),
  defineTool(createAdrDefinition, createAdrHandler),
  defineTool(listAdrsDefinition, listAdrsHandler),
  defineTool(supersedeAdrDefinition, supersedeAdrHandler),
];

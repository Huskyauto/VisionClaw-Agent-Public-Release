/**
 * Tools-layer-split S16 — outreach-domain migrated handlers.
 *
 * Selection: the 8 AI-SDR lead/sequence tools — `enrich_lead`, `score_leads`,
 * `qualify_leads`, `create_sequence`, `enroll_in_sequence`, `advance_sequence`,
 * `classify_reply`, `list_sequences`. In the legacy facade these were the LAST 8
 * arms of a shared case-fallthrough block whose body was a single `fnMap`
 * dispatch into `./agentic-features` guarded by one tenant gate
 * (`if (!params._tenantId) return { error: "Tenant context required" }`) that
 * called `fn({ tenantId: params._tenantId, ...params })`. The block's other 9
 * arms (research `save_evidence`/`query_evidence`/`synthesize_research`,
 * competitor `add_competitor`/`list_competitors`/`take_competitor_snapshot`/
 * `detect_competitor_changes`/`competitor_briefing`, and `define_icp`) belong to
 * the agentic domain and STAY LEGACY per smallest-safe-batch — the split
 * re-anchors that block's brace to `case "define_icp"` and removes only the 8
 * outreach labels + their 8 (now-dead) fnMap entries.
 *
 * Handler bodies are MECHANICAL moves of the legacy dispatch arm (standing
 * rules: no renames, no behavior change, error string verbatim). The ONLY edit:
 * the caller-supplied `params._tenantId` read becomes `ctx.tenantId` (the
 * dispatcher strips + re-stamps it from the trusted context). VERIFIED SAFE: the
 * 8 `agentic-features` fns take `{ tenantId, ...realParams }` and read NO
 * `_`-prefixed trust signal (no `_personaId`/`_conversationId`/`_userId`/
 * `_personaName` reads anywhere in `server/agentic-features.ts`), so passing the
 * dispatcher-stripped `params` alongside `tenantId: ctx.tenantId` is behavior-
 * identical to the legacy `fn({ tenantId, ...params })`. The sole external
 * dependency (`../../../agentic-features`) is pulled via a call-time dynamic
 * `import(...)` inside each handler — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse
 * back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8–S15 used). No tools.ts module-scope helpers moved.
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
  enrichLeadDefinition,
  scoreLeadsDefinition,
  qualifyLeadsDefinition,
  createSequenceDefinition,
  enrollInSequenceDefinition,
  advanceSequenceDefinition,
  classifyReplyDefinition,
  listSequencesDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy shared fnMap dispatch arm)
// ---------------------------------------------------------------------------

async function enrichLeadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.enrichLead({ tenantId: ctx.tenantId, ...params } as any);
}

async function scoreLeadsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.scoreLeads({ tenantId: ctx.tenantId, ...params } as any);
}

async function qualifyLeadsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.qualifyLeads({ tenantId: ctx.tenantId, ...params } as any);
}

async function createSequenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.createSequence({ tenantId: ctx.tenantId, ...params } as any);
}

async function enrollInSequenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.enrollInSequence({ tenantId: ctx.tenantId, ...params } as any);
}

async function advanceSequenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.advanceSequence({ tenantId: ctx.tenantId, ...params } as any);
}

async function classifyReplyHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.classifyReply({ tenantId: ctx.tenantId, ...params } as any);
}

async function listSequencesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const af = await import("../../../agentic-features");
  return af.listSequences({ tenantId: ctx.tenantId, ...params } as any);
}

/** Registered by ./index.ts at import time. */
export const outreachDomainTools: RegisteredTool[] = [
  defineTool(enrichLeadDefinition, enrichLeadHandler),
  defineTool(scoreLeadsDefinition, scoreLeadsHandler),
  defineTool(qualifyLeadsDefinition, qualifyLeadsHandler),
  defineTool(createSequenceDefinition, createSequenceHandler),
  defineTool(enrollInSequenceDefinition, enrollInSequenceHandler),
  defineTool(advanceSequenceDefinition, advanceSequenceHandler),
  defineTool(classifyReplyDefinition, classifyReplyHandler),
  defineTool(listSequencesDefinition, listSequencesHandler),
];

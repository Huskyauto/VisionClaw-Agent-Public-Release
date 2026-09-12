/**
 * Tools-layer-split S26c — reference-learner-domain migrated handlers.
 *
 * Selection: the 2 taste-transfer tools — `learn_from_reference` /
 * `recall_references`. Backed solely by `server/reference-learner`
 * (`learnFromReference` / `recallReferences`).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read TWO dispatcher-STRIPPED
 * signals DIRECTLY — `params._tenantId` for its fail-closed guard
 * (`if (typeof tid !== "number" || tid <= 0) return { error: "... requires tenant context" }`)
 * AND as the backing-lib `tenantId` scope, plus `params._personaId` forwarded as the
 * optional `personaId` (mapped `typeof ... === "number" ? ... : undefined` — NOTE:
 * `undefined`, not `null`). Migrated handlers read `ctx.tenantId` / `ctx.personaId`
 * (the same platform-derived values) in the SAME order with IDENTICAL error strings,
 * guards, and the exact `undefined` fallback. All PUBLIC caller params
 * (`reference_url` / `deliverable_type` / `what_to_learn` / `model` / `style_tags` /
 * `limit`) stay read from `params`.
 *
 * The backing `../../../reference-learner` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import (acyclicity invariant, plan.md S2).
 * `reference-learner` does not import the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  learnFromReferenceDefinition,
  recallReferencesDefinition,
} from "./definitions";

async function learnFromReferenceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "learn_from_reference requires tenant context" };
  try {
    const { learnFromReference } = await import("../../../reference-learner");
    const r = await learnFromReference({
      tenantId: tid,
      personaId: typeof ctx.personaId === "number" ? ctx.personaId : undefined,
      referenceUrl: String(params.reference_url || ""),
      deliverableType: String(params.deliverable_type || ""),
      whatToLearn: params.what_to_learn ? String(params.what_to_learn) : undefined,
      model: params.model ? String(params.model) : undefined,
    });
    return r;
  } catch (e: any) { return { error: `learn_from_reference failed: ${e?.message || String(e)}` }; }
}

async function recallReferencesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "recall_references requires tenant context" };
  try {
    const { recallReferences } = await import("../../../reference-learner");
    const r = await recallReferences({
      tenantId: tid,
      personaId: typeof ctx.personaId === "number" ? ctx.personaId : undefined,
      deliverableType: params.deliverable_type ? String(params.deliverable_type) : undefined,
      styleTags: Array.isArray(params.style_tags) ? params.style_tags.map(String) : undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
    });
    return r;
  } catch (e: any) { return { error: `recall_references failed: ${e?.message || String(e)}` }; }
}

/** Registered by ./index.ts at import time. */
export const referenceLearnerDomainTools: RegisteredTool[] = [
  defineTool(learnFromReferenceDefinition, learnFromReferenceHandler),
  defineTool(recallReferencesDefinition, recallReferencesHandler),
];

/**
 * Tools-layer-split S32 — video-selectors-domain migrated handlers.
 *
 * The Felix Visual Continuity (ViMax) frame-selection family (2 tools):
 * `select_references_for_frame` + `select_best_image`. Both are thin wrappers
 * over server/video/{reference-selector,best-image-selector}.ts — bodies are a
 * MECHANICAL move of the legacy switch arms (standing rules: no renames, no
 * behavior change, no added/removed gate; result field shapes, coercions, and
 * error strings preserved VERBATIM).
 *
 * SEAM (read-from-ctx): each legacy arm read the dispatcher-stripped
 * `params._tenantId` for its fail-closed tenant guard
 * (`typeof !== "number" || <= 0`) AND threaded it into the backing-lib call.
 * These handlers read `ctx.tenantId` — the same platform-derived value — with
 * IDENTICAL guards + error strings. `_tenantId` is the ONLY stripped trust
 * signal these arms read; `job_id` / `frame_description` / `max_references` /
 * `candidates` / `references` / `target_description` are all PUBLIC request
 * params.
 *
 * The backing libs are pulled via call-time dynamic `import(...)` — NOT
 * top-level static imports — so the domain module statically imports only
 * within server/tools/ and cannot recurse into the app graph (acyclicity
 * invariant, plan.md S2). Neither `server/video/reference-selector` nor
 * `server/video/best-image-selector` imports the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  selectReferencesForFrameDefinition,
  selectBestImageDefinition,
} from "./definitions";

async function selectReferencesForFrameHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "select_references_for_frame requires tenant context" };
  try {
    const { selectReferencesForFrame } = await import("../../../video/reference-selector");
    const r = await selectReferencesForFrame({
      tenantId: tid,
      jobId: String(params.job_id || ""),
      frameDescription: String(params.frame_description || ""),
      maxReferences: typeof params.max_references === "number" ? params.max_references : undefined,
    });
    return { success: true, ...r };
  } catch (e: any) { return { error: `select_references_for_frame failed: ${e?.message || String(e)}` }; }
}

async function selectBestImageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "select_best_image requires tenant context" };
  try {
    const { selectBestImage } = await import("../../../video/best-image-selector");
    const r = await selectBestImage({
      candidates: Array.isArray(params.candidates) ? params.candidates.map(String) : [],
      references: Array.isArray(params.references) ? params.references.map(String) : [],
      targetDescription: String(params.target_description || ""),
      tenantId: tid,
    });
    return {
      success: true,
      winner_index: r.winnerIndex,
      winner_path: r.winnerPath,
      reason: r.reason,
      scores: r.scores,
      source: r.source,
      per_candidate: r.perCandidate,
    };
  } catch (e: any) { return { error: `select_best_image failed: ${e?.message || String(e)}` }; }
}

/** Registered by ./index.ts at import time. */
export const videoSelectorsDomainTools: RegisteredTool[] = [
  defineTool(selectReferencesForFrameDefinition, selectReferencesForFrameHandler),
  defineTool(selectBestImageDefinition, selectBestImageHandler),
];

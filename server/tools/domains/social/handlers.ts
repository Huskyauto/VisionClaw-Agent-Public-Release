/**
 * Tools-layer-split S14 — social-domain migrated handlers.
 *
 * Selection: the 4 MarTech content/social tools (R79, ported from Charlie
 * Hills' social-media-skills MIT) — `generate_hooks`, `format_post`,
 * `generate_content_matrix`, `score_post`. Adjacent social tools stay legacy
 * per smallest-safe-batch: the `x_*` Twitter cluster is the dedicated S15
 * x-twitter slice; the scattered marketing social-post tools and the
 * cross-platform scheduler cluster (incl. the destructive, requireApproval
 * `schedule_cross_platform_post`, which reads `_personaName`/`_userId` trust
 * channels outside ToolContext) migrate in a later pass.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edits: caller-supplied `params._tenantId` reads become `ctx.tenantId` (the
 * dispatcher strips + re-stamps it from the trusted context), and the sole
 * external dependency (`../../../martech-bundle`) is pulled via a call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import —
 * so the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8/S9/S11/S12/S13 used). The `typeof tid !== "number" || tid <= 0` tenant
 * gate is preserved verbatim. No tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  generateHooksDefinition,
  formatPostDefinition,
  generateContentMatrixDefinition,
  scorePostDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function generateHooksHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "generate_hooks requires explicit _tenantId" };
  }
  try {
    const { generateHooks } = await import("../../../martech-bundle");
    const result = await generateHooks({
      tenantId: tid,
      topic: String(params.topic || ""),
      count: Number.isInteger(params.count) ? (params.count as number) : undefined,
      voiceProfileName: params.voice_profile_name ? String(params.voice_profile_name) : undefined,
    });
    return result;
  } catch (e) {
    return { error: `generate_hooks failed: ${(e as Error).message}` };
  }
}

async function formatPostHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "format_post requires explicit _tenantId" };
  }
  try {
    const { formatPost } = await import("../../../martech-bundle");
    const result = await formatPost({
      tenantId: tid,
      topic: String(params.topic || ""),
      framework: String(params.framework || ""),
      platform: params.platform ? String(params.platform) : undefined,
      contextDump: params.context_dump ? String(params.context_dump) : undefined,
      voiceProfileName: params.voice_profile_name ? String(params.voice_profile_name) : undefined,
    });
    return result;
  } catch (e) {
    return { error: `format_post failed: ${(e as Error).message}` };
  }
}

async function generateContentMatrixHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "generate_content_matrix requires explicit _tenantId" };
  }
  try {
    const { generateContentMatrix } = await import("../../../martech-bundle");
    const result = await generateContentMatrix({
      tenantId: tid,
      pillars: Array.isArray(params.pillars) ? params.pillars.map((p: any) => String(p || "")).filter(Boolean) : undefined,
      formats: Array.isArray(params.formats) ? params.formats.map((f: any) => String(f || "")).filter(Boolean) : undefined,
      voiceProfileName: params.voice_profile_name ? String(params.voice_profile_name) : undefined,
    });
    return result;
  } catch (e) {
    return { error: `generate_content_matrix failed: ${(e as Error).message}` };
  }
}

async function scorePostHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "score_post requires explicit _tenantId" };
  }
  try {
    const { scorePost } = await import("../../../martech-bundle");
    const result = await scorePost({
      tenantId: tid,
      draft: String(params.draft || ""),
      platform: params.platform ? String(params.platform) : undefined,
      historicalPostsJson: params.historical_posts_json ? String(params.historical_posts_json) : undefined,
      voiceProfileName: params.voice_profile_name ? String(params.voice_profile_name) : undefined,
    });
    return result;
  } catch (e) {
    return { error: `score_post failed: ${(e as Error).message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const socialDomainTools: RegisteredTool[] = [
  defineTool(generateHooksDefinition, generateHooksHandler),
  defineTool(formatPostDefinition, formatPostHandler),
  defineTool(generateContentMatrixDefinition, generateContentMatrixHandler),
  defineTool(scorePostDefinition, scorePostHandler),
];

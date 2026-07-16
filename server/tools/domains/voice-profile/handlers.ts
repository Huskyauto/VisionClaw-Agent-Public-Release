/**
 * Tools-layer-split S25y — voice-profile-domain migrated handlers.
 *
 * Selection: the 2 per-tenant brand-voice tools — `build_voice_profile` /
 * `get_voice_profile`. Backed solely by `server/martech-bundle`
 * (`buildVoiceProfile` / `getVoiceProfile`) — one coherent cluster; grep confirmed
 * these are the ONLY two callers of those backing fns.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY (`const tid = params._tenantId`) — both for a
 * pre-existing fail-closed guard (`typeof tid !== "number" || tid <= 0` →
 * "... requires explicit _tenantId") AND as the backing-lib `tenantId` scope.
 * Migrated handlers read `ctx.tenantId` (the same platform-derived value) in the
 * SAME order with the IDENTICAL error strings and guard. No re-stamp is needed
 * (the arm consumed the signal itself, it was not merely forwarded to the lib).
 * `_tenantId` is the ONLY stripped signal these arms read (grepped).
 *
 * The backing `../../../martech-bundle` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `martech-bundle` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { buildVoiceProfileDefinition, getVoiceProfileDefinition } from "./definitions";

async function buildVoiceProfileHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "build_voice_profile requires explicit _tenantId" };
  }
  try {
    const { buildVoiceProfile } = await import("../../../martech-bundle");
    const samples = Array.isArray(params.samples) ? params.samples.map((s: any) => String(s || "")) : [];
    const result = await buildVoiceProfile({
      tenantId: tid,
      profileName: params.profile_name ? String(params.profile_name) : undefined,
      aboutMeAnswers: String(params.about_me_answers || ""),
      samples,
      pillars: Array.isArray(params.pillars) ? params.pillars.map((p: any) => String(p || "")).filter(Boolean) : undefined,
      audience: params.audience ? String(params.audience) : undefined,
    });
    return result;
  } catch (e) {
    return { error: `build_voice_profile failed: ${(e as Error).message}` };
  }
}

async function getVoiceProfileHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "get_voice_profile requires explicit _tenantId" };
  }
  try {
    const { getVoiceProfile } = await import("../../../martech-bundle");
    const profile = await getVoiceProfile({
      tenantId: tid,
      profileName: params.profile_name ? String(params.profile_name) : undefined,
    });
    if (!profile) return { success: true, found: false, profile: null };
    return {
      success: true,
      found: true,
      profile: {
        id: profile.id,
        profileName: profile.profileName,
        aboutMe: profile.aboutMe,
        voice: profile.voice,
        pillars: profile.pillars || [],
        audience: profile.audience || "",
        version: profile.version,
        updatedAt: profile.updatedAt,
      },
    };
  } catch (e) {
    return { error: `get_voice_profile failed: ${(e as Error).message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const voiceProfileDomainTools: RegisteredTool[] = [
  defineTool(buildVoiceProfileDefinition, buildVoiceProfileHandler),
  defineTool(getVoiceProfileDefinition, getVoiceProfileHandler),
];

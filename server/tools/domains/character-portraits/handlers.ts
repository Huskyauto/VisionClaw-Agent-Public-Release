/**
 * Tools-layer-split S31 — character-portraits domain migrated handlers.
 *
 * Felix Visual Continuity portrait-registry family (3 tools):
 * `register_character_portrait` + `list_character_portraits` +
 * `init_character_portraits`. All three are thin wrappers over
 * server/video/portrait-registry.ts — bodies are a MECHANICAL move of the
 * legacy switch arms (standing rules: no renames, no behavior change, no
 * added/removed gate; field coercions, hard caps and error strings preserved
 * VERBATIM).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-
 * STRIPPED `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * AND the `tenantId` threaded into every portrait-registry call. Migrated
 * handlers read `ctx.tenantId` (the same platform-derived value) with IDENTICAL
 * `typeof !== "number" || <= 0` guards and error strings. `_tenantId` is the
 * ONLY stripped signal these arms read — `identifier` / `view` / `image_path` /
 * `characters` / `default_views` are PUBLIC request params (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * `./video/portrait-registry` is pulled via call-time dynamic `import(...)` —
 * NOT a top-level static import — so the domain module statically imports only
 * within server/tools/ (acyclicity invariant, plan.md S2). The backing lib does
 * NOT import the tools facade; `init_character_portraits` needs the facade's
 * `executeTool` (to generate portraits via `generate_social_image`), which is
 * INJECTED as a callback — pulled via call-time dynamic `import("../../../tools")`
 * exactly as the legacy arm did (same lazy back-edge precedent as web/handlers).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  registerCharacterPortraitDefinition,
  listCharacterPortraitsDefinition,
  initCharacterPortraitsDefinition,
} from "./definitions";

async function registerCharacterPortraitHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "register_character_portrait requires tenant context" };
  try {
    const { registerPortrait } = await import("../../../video/portrait-registry");
    const r = await registerPortrait({
      tenantId: tid,
      identifier: String(params.identifier || ""),
      view: String(params.view || ""),
      imagePath: String(params.image_path || ""),
      description: params.description ? String(params.description) : undefined,
    });
    return { success: true, portrait: r };
  } catch (e: any) { return { error: `register_character_portrait failed: ${e?.message || String(e)}` }; }
}

async function listCharacterPortraitsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "list_character_portraits requires tenant context" };
  try {
    const { listPortraits } = await import("../../../video/portrait-registry");
    const portraits = await listPortraits({
      tenantId: tid,
      identifier: params.identifier ? String(params.identifier) : undefined,
    });
    return { success: true, count: portraits.length, portraits };
  } catch (e: any) { return { error: `list_character_portraits failed: ${e?.message || String(e)}` }; }
}

async function initCharacterPortraitsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "init_character_portraits requires tenant context" };
  try {
    const { initCharacterPortraits } = await import("../../../video/portrait-registry");
    const { executeTool } = await import("../../../tools");
    const characters = Array.isArray(params.characters) ? params.characters.map((c: any) => ({
      identifier: String(c.identifier || ""),
      description: String(c.description || ""),
      views: Array.isArray(c.views) ? c.views.map(String) : undefined,
      sourceImagePath: c.source_image_path ? String(c.source_image_path) : undefined,
    })) : [];
    const defaultViews = Array.isArray(params.default_views) ? params.default_views.map(String) : undefined;
    const r = await initCharacterPortraits({
      tenantId: tid,
      characters,
      defaultViews,
      executeTool: (n: string, p: any, t: number) => executeTool(n, { ...p, _tenantId: t }),
    });
    return { success: true, ...r };
  } catch (e: any) { return { error: `init_character_portraits failed: ${e?.message || String(e)}` }; }
}

/** Registered by ./index.ts at import time. */
export const characterPortraitsDomainTools: RegisteredTool[] = [
  defineTool(registerCharacterPortraitDefinition, registerCharacterPortraitHandler),
  defineTool(listCharacterPortraitsDefinition, listCharacterPortraitsHandler),
  defineTool(initCharacterPortraitsDefinition, initCharacterPortraitsHandler),
];

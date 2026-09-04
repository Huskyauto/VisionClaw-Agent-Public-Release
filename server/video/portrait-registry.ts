/**
 * R99 — Felix Visual Continuity (ViMax nugget #1)
 *
 * Tenant-scoped library of canonical character/asset portraits. A portrait is
 * generated ONCE per (identifier, view) and reused across every video job for
 * the tenant — that is what stops "Bob looks different in every shot."
 *
 * View vocabulary (free-form text, but these are the canonical values):
 *   'front'           — straight-on, eye-level
 *   'side'            — profile, eye-level
 *   'three_quarter'   — 3/4, eye-level
 *   'back'            — over-the-shoulder
 *   'env'             — environment / background asset (no person)
 *
 * Storage: rows in character_portrait_registry. Image bytes live on disk under
 * project-assets/portrait_registry/<tenantId>/<identifier>_<view>.png so they
 * survive process restarts and Drive uploads are decoupled.
 */
import { db } from "../db";
import { characterPortraitRegistry, type CharacterPortrait } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { logSilentCatch } from "../lib/silent-catch";
import { isPathInAllowedRoots } from "../lib/image-ref-jail";

const PORTRAIT_DIR = path.join(process.cwd(), "project-assets", "portrait_registry");

export const PORTRAIT_VIEWS_DEFAULT = ["front", "three_quarter", "side"] as const;
export const PORTRAIT_VIEWS_MAX_PER_CALL = 4;
export const PORTRAIT_CHARACTERS_MAX_PER_CALL = 5;

function tenantDir(tenantId: number): string {
  const dir = path.join(PORTRAIT_DIR, String(tenantId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeKey(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
}

/**
 * UPSERT a single portrait. Identifier + view is the natural key — the second
 * registration for the same (tenant, identifier, view) replaces image_path
 * and description but keeps the original id and created_at.
 */
export async function registerPortrait(args: {
  tenantId: number;
  identifier: string;
  view: string;
  imagePath: string;
  description?: string;
}): Promise<CharacterPortrait> {
  const { tenantId, identifier, view, imagePath, description } = args;
  if (!Number.isInteger(tenantId) || tenantId < 1) throw new Error("tenantId required");
  if (!identifier?.trim()) throw new Error("identifier required");
  if (!view?.trim()) throw new Error("view required");
  if (!imagePath?.trim()) throw new Error("imagePath required");
  // R99.1 +sec hardening (post-review fix): jail the imagePath BEFORE storing
  // it in the registry. The registry is a downstream source for the reference
  // selector and best-image grader — if an attacker-controlled path lands here,
  // it propagates to BOTH the OpenAI Edits multipart body AND the vision LLM
  // grader. Containing the bad path at write-time stops both sinks at the
  // source.
  if (!isPathInAllowedRoots(imagePath)) {
    throw new Error(`portrait imagePath outside allowed roots (project-assets/uploads/attached_assets)`);
  }
  if (!fs.existsSync(imagePath)) throw new Error(`portrait file does not exist: ${imagePath}`);

  const idKey = safeKey(identifier);
  const viewKey = safeKey(view);

  // R99 architect MEDIUM fix: atomic ON CONFLICT against the
  // (tenant_id, identifier, view) unique index. The previous read-then-write
  // logic was racy under concurrent init_character_portraits calls and could
  // leave duplicate rows that then fight for "winner" in listPortraits.
  // COALESCE on description preserves a prior non-empty description when the
  // re-register call passes an empty one.
  const upserted = await db
    .insert(characterPortraitRegistry)
    .values({ tenantId, identifier: idKey, view: viewKey, imagePath, description: description || "" })
    .onConflictDoUpdate({
      target: [characterPortraitRegistry.tenantId, characterPortraitRegistry.identifier, characterPortraitRegistry.view],
      set: {
        imagePath: sql`excluded.image_path`,
        description: sql`COALESCE(NULLIF(excluded.description, ''), ${characterPortraitRegistry.description})`,
      },
    })
    .returning();
  return upserted[0];
}

export async function listPortraits(args: {
  tenantId: number;
  identifier?: string;
}): Promise<CharacterPortrait[]> {
  const { tenantId, identifier } = args;
  if (!Number.isInteger(tenantId) || tenantId < 1) throw new Error("tenantId required");
  if (identifier) {
    return await db
      .select()
      .from(characterPortraitRegistry)
      .where(and(
        eq(characterPortraitRegistry.tenantId, tenantId),
        eq(characterPortraitRegistry.identifier, safeKey(identifier)),
      ))
      .orderBy(characterPortraitRegistry.identifier, characterPortraitRegistry.view);
  }
  return await db
    .select()
    .from(characterPortraitRegistry)
    .where(eq(characterPortraitRegistry.tenantId, tenantId))
    .orderBy(characterPortraitRegistry.identifier, characterPortraitRegistry.view);
}

/**
 * For a list of (identifier, description, views?) entries, generate the missing
 * portraits via gpt-image-2 and register them. Idempotent: portraits already in
 * the registry are skipped (cheaper than re-generating).
 *
 * Hard caps: PORTRAIT_CHARACTERS_MAX_PER_CALL characters × PORTRAIT_VIEWS_MAX_PER_CALL views
 * to prevent a runaway cost vector.
 */
export async function initCharacterPortraits(args: {
  tenantId: number;
  characters: { identifier: string; description: string; views?: string[]; sourceImagePath?: string }[];
  defaultViews?: string[];
  executeTool: (name: string, params: any, tenantId: number) => Promise<any>;
}): Promise<{
  created: { identifier: string; view: string; imagePath: string }[];
  skipped: { identifier: string; view: string; reason: string }[];
  failed: { identifier: string; view: string; reason: string }[];
}> {
  const { tenantId, characters, executeTool } = args;
  const defaultViews = (args.defaultViews && args.defaultViews.length > 0 ? args.defaultViews : [...PORTRAIT_VIEWS_DEFAULT]).slice(0, PORTRAIT_VIEWS_MAX_PER_CALL);
  const limited = (characters || []).slice(0, PORTRAIT_CHARACTERS_MAX_PER_CALL);

  const created: { identifier: string; view: string; imagePath: string }[] = [];
  const skipped: { identifier: string; view: string; reason: string }[] = [];
  const failed: { identifier: string; view: string; reason: string }[] = [];

  for (const ch of limited) {
    const idKey = safeKey(ch.identifier);
    const views = (ch.views && ch.views.length > 0 ? ch.views : defaultViews).slice(0, PORTRAIT_VIEWS_MAX_PER_CALL);

    const existing = await listPortraits({ tenantId, identifier: idKey });
    const existingViews = new Set(existing.map(p => p.view));

    // Generate missing portraits in parallel (max 4 per character per call, well
    // under the 8-parallel-agent ceiling).
    const tasks = views.filter(v => !existingViews.has(safeKey(v))).map(async (view) => {
      const viewKey = safeKey(view);
      const baseDir = tenantDir(tenantId);
      const outPath = path.join(baseDir, `${idKey}_${viewKey}.png`);
      try {
        // View-aware prompt suffix so the LLM produces a clean reference shot.
        const viewSuffix: Record<string, string> = {
          front: "front-facing portrait, eye level, neutral expression, plain studio background",
          three_quarter: "three-quarter angle portrait, eye level, neutral expression, plain studio background",
          side: "side profile portrait, eye level, neutral expression, plain studio background",
          back: "over-the-shoulder back view, plain studio background",
          env: "environment reference, no people, clean composition",
        };
        const suffix = viewSuffix[viewKey] || "reference image, plain background";
        const prompt = `${ch.description}. ${suffix}. Photorealistic, high detail, well-lit.`;

        const params: any = {
          prompt,
          style: "cinematic",
          aspect_ratio: viewKey === "env" ? "16:9" : "1:1",
          purpose: "customer_video_scene",
          _tenantId: tenantId,
        };
        // R99.1 +sec hardening (post-review fix): pass the customer's seed
        // photo through `reference_image_paths` (the actual gpt-image-2 edits
        // input) instead of the unused `imagePath` field. Jail-checked here
        // so the dispatch's own jail isn't the only line of defense — and
        // also so a misregistered seed path fails loudly at portrait
        // generation rather than silently being dropped at the dispatch.
        if (ch.sourceImagePath && isPathInAllowedRoots(ch.sourceImagePath) && fs.existsSync(ch.sourceImagePath)) {
          params.reference_image_paths = [ch.sourceImagePath];
        } else if (ch.sourceImagePath) {
          console.warn(`[portrait-registry] dropping sourceImagePath for ${idKey}: outside allowed roots OR missing`);
        }

        const imgResult = await executeTool("generate_social_image", params, tenantId);
        const localFile = imgResult?.file_path || imgResult?.local_path;
        if (!localFile || !fs.existsSync(localFile)) {
          failed.push({ identifier: idKey, view: viewKey, reason: "generator returned no local file" });
          return;
        }

        try {
          fs.copyFileSync(localFile, outPath);
        } catch (cpErr: any) {
          logSilentCatch("server/video/portrait-registry.ts:initCharacterPortraits:copyFileSync", cpErr);
        }
        const finalPath = fs.existsSync(outPath) ? outPath : localFile;

        await registerPortrait({
          tenantId,
          identifier: idKey,
          view: viewKey,
          imagePath: finalPath,
          description: ch.description,
        });
        created.push({ identifier: idKey, view: viewKey, imagePath: finalPath });
      } catch (err: any) {
        failed.push({ identifier: idKey, view: viewKey, reason: String(err?.message || err).slice(0, 200) });
      }
    });
    await Promise.all(tasks);

    for (const v of views) {
      const vk = safeKey(v);
      if (existingViews.has(vk)) skipped.push({ identifier: idKey, view: vk, reason: "already in registry" });
    }
  }

  return { created, skipped, failed };
}

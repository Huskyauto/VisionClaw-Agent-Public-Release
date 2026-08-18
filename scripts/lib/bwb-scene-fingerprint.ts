/**
 * scripts/lib/bwb-scene-fingerprint.ts
 *
 * Content-fingerprint sidecar for pre-baked Built With Bob scene images.
 *
 * WHY (Bob 2026-06-14): the weekly recap videoId is DATE-ONLY
 * (`weekly-YYYY-MM-DD`), so two runs on the same day share a scene dir
 * (`data/youtube/scenes/<videoId>/scene-N.png`). The render paths reuse a scene
 * image whenever its file exists AT THAT POSITION — by index, not by content. A
 * same-day re-run therefore paired fresh, correct narration with the PRIOR run's
 * images, so every slide was out of continuity with what Bob was saying while the
 * narration itself was perfect.
 *
 * Fix: when a scene image is baked, drop a sidecar holding the sha256 of the
 * prompt that produced it. Before reusing an on-disk image, require the sidecar
 * to match the CURRENT scene's prompt. A genuine resume (same script, same
 * prompts) still reuses every image (no double-spend); a same-day re-run with new
 * narration re-bakes the images that changed instead of silently reusing stale
 * ones. Pure + dependency-light so both render backends can share it.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Sidecar path for a baked scene image (e.g. scene-3.png -> scene-3.png.prompt). */
export function sidecarPathFor(imagePath: string): string {
  return `${imagePath}.prompt`;
}

/** Stable sha256 of a scene's image prompt (whitespace-normalized so trivial
 *  reformatting doesn't needlessly bust an otherwise-identical prompt). */
export function scenePromptHash(prompt: string): string {
  const normalized = (prompt || "").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Write the fingerprint sidecar next to a freshly-baked scene image. Best-effort:
 *  a sidecar write failure must never fail the render (worst case is a future run
 *  re-bakes the image because it can't confirm the match). */
export function writeScenePromptSidecar(imagePath: string, prompt: string): void {
  try {
    fs.writeFileSync(sidecarPathFor(imagePath), scenePromptHash(prompt));
  } catch {
    /* non-fatal — see doc above */
  }
}

/** True only when the on-disk image was baked for THIS exact prompt. Missing or
 *  mismatched sidecar => false (re-bake), so a pre-fingerprint or foreign image is
 *  never trusted by position. */
export function imageMatchesPrompt(imagePath: string, prompt: string): boolean {
  try {
    const sidecar = sidecarPathFor(imagePath);
    if (!fs.existsSync(sidecar)) return false;
    const recorded = fs.readFileSync(sidecar, "utf8").trim();
    return recorded.length > 0 && recorded === scenePromptHash(prompt);
  } catch {
    return false;
  }
}

/**
 * Sweep stale/orphan positional `scene-N.png` (+ sidecar) out of a (possibly
 * shared, date-only) sceneDir BEFORE an image bake pass. The weekly recap
 * videoId is date-only, so same-day re-runs share this dir; a scene whose count
 * shrank, whose order changed, or that now supplies a real `imagePath` can leave
 * a positional landmine that an imagePath-fallthrough or a non-fingerprint code
 * path could pick up and pair with the wrong narration.
 *
 * HYGIENE ONLY — image REUSE is still gated on `imageMatchesPrompt`, so a failed
 * unlink here can never cause a wrong image to ship (correctness must not depend
 * on an unlink succeeding; see the WHY in `imageMatchesPrompt`). This just keeps
 * the shared dir from carrying dead artifacts across runs.
 *
 * Removes `scene-N.png` when, for the CURRENT scene list:
 *   - N is beyond the current scene count (orphan from a longer prior draft), OR
 *   - that scene now supplies a usable `imagePath` (the baked png won't be used), OR
 *   - the scene has no `imagePrompt` to match against, OR
 *   - the sidecar fingerprint does not match the scene's current `imagePrompt`.
 * Keeps an image only when its fingerprint proves it was baked for the current prompt.
 */
export function pruneStaleSceneImages(
  sceneDir: string,
  scenes: { imagePrompt?: string; imagePath?: string }[],
): void {
  let files: string[];
  try {
    files = fs.readdirSync(sceneDir);
  } catch {
    return; // dir doesn't exist yet — nothing to prune
  }
  for (const f of files) {
    const m = /^scene-(\d+)\.png$/.exec(f);
    if (!m) continue;
    const n = Number(m[1]);
    const png = path.join(sceneDir, f);
    const scene = scenes[n - 1]; // scene-1 == scenes[0] (scene 1 is the hero)
    let stale: boolean;
    if (!scene) {
      stale = true; // orphan: beyond the current scene count
    } else if (scene.imagePath) {
      // A real imagePath wins. KEEP the png only if the imagePath IS this very
      // file (self-reference — deleting it would orphan the scene); otherwise the
      // baked png is dead weight and a real photo/hero will be used instead.
      stale = path.resolve(scene.imagePath) !== path.resolve(png);
    } else if (!scene.imagePrompt) {
      stale = true; // no imagePath and no prompt to fingerprint against
    } else {
      stale = !imageMatchesPrompt(png, scene.imagePrompt);
    }
    if (!stale) continue;
    try { fs.unlinkSync(png); } catch { /* hygiene only — reuse is fingerprint-gated */ }
    try { fs.unlinkSync(sidecarPathFor(png)); } catch { /* hygiene only */ }
  }
}

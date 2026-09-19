/**
 * R99.1 +sec — Reference image path jail.
 *
 * The `reference_image_paths` parameter on `generate_social_image` (and the
 * `referenceImagePaths` option on `generateImage`) accepts file paths that
 * end up read off disk and uploaded to the OpenAI Images Edits API. Without
 * a jail, a hallucinating or compromised agent could probe for or exfiltrate
 * arbitrary local files (`/etc/passwd`, `.env`, `server/storage.ts`, etc.).
 *
 * This module is the single source of truth for which directories legitimate
 * reference images can live in. Defense-in-depth: BOTH the tool dispatch
 * (server/tools.ts:generate_social_image) AND the low-level edits caller
 * (server/replit_integrations/image/client.ts:generateImageGptImage2WithRefs)
 * gate through `isPathInAllowedRoots` so removing one filter still leaves
 * the other in place.
 *
 * Allowed roots correspond to the directories where the platform legitimately
 * writes images: project-assets/ (mpeg job dirs + scene images, registry
 * portraits), uploads/ (delivery pipeline assets + customer uploads), and
 * attached_assets/ (user-uploaded references inside the IDE workspace).
 */
import * as path from "path";
import * as fs from "fs";

function defaultAllowedRoots(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "project-assets"),
    path.resolve(cwd, "uploads"),
    path.resolve(cwd, "attached_assets"),
  ];
}

/**
 * Real-path a candidate path so symlinks are dereferenced before the boundary
 * check. Without this, a symlink LIVING inside an allowed root that POINTS to
 * a sensitive file (e.g. `project-assets/link → /etc/passwd`) would pass the
 * naive prefix check and let `fs.readFile` happily upload the target bytes.
 *
 * Returns null if realpath fails (file missing, permission denied, etc.) —
 * caller treats null as "rejected" so a missing file never silently passes.
 *
 * If the file does NOT yet exist (e.g. a not-yet-written output path), we
 * realpath the longest existing parent directory and append the unresolved
 * tail. This still defeats parent-symlink shenanigans without breaking the
 * legitimate "checking a path before writing it" case.
 */
function safeRealpath(candidate: string): string | null {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    // File doesn't exist yet — realpath the deepest existing ancestor.
    let parent = path.dirname(candidate);
    let tail = path.basename(candidate);
    // Bound the climb so a pathological input (e.g. "//////") doesn't loop.
    for (let i = 0; i < 64; i++) {
      try {
        const realParent = fs.realpathSync.native(parent);
        return path.join(realParent, tail);
      } catch {
        const next = path.dirname(parent);
        if (next === parent) return null;
        tail = path.join(path.basename(parent), tail);
        parent = next;
      }
    }
    return null;
  }
}

/**
 * Returns true iff `candidate` is a path that — after `..` normalization AND
 * symlink dereferencing — resolves inside one of the allowed roots. Symlinks
 * are followed both on the candidate AND on the roots so legitimate setups
 * where `project-assets` is itself a symlink keep working.
 *
 * `roots` defaults to project-assets / uploads / attached_assets under cwd
 * but can be overridden in tests.
 */
export function isPathInAllowedRoots(candidate: string, roots: string[] = defaultAllowedRoots()): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  // R99.1 +sec hardening (post-review fix): realpath the candidate to defeat
  // symlinks-inside-allowed-root attacks. Realpath-fail (file missing or
  // permission denied) means we cannot prove safety → reject.
  const resolved = safeRealpath(candidate);
  if (resolved === null) return false;

  for (const root of roots) {
    // Realpath the root too so legitimate symlinked roots (e.g. /workspace ↔
    // /home/runner/workspace) still match. If the root itself doesn't exist,
    // skip it (boundary check would never match anyway).
    let realRoot: string;
    try {
      realRoot = fs.realpathSync.native(root);
    } catch {
      continue;
    }
    const r = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    if (resolved === realRoot || resolved.startsWith(r)) return true;
  }
  return false;
}

/**
 * Filters a list of candidate reference paths down to those that pass the
 * jail. Returns `{ allowed, rejected }` so callers can log how many were
 * dropped and surface a warning.
 */
export function filterAllowedRefPaths(paths: string[], roots?: string[]): { allowed: string[]; rejected: string[] } {
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const p of paths) {
    if (isPathInAllowedRoots(p, roots)) allowed.push(p);
    else rejected.push(p);
  }
  return { allowed, rejected };
}

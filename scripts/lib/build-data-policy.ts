import { existsSync } from "node:fs";
import { join } from "node:path";

/** The exporter creates this artifact only in the sanitized checkout. */
export function isPublicMirror(root = process.cwd()): boolean {
  return existsSync(join(root, "tests/public-test-manifest.json"));
}

/** Release verification must neither export DB rows nor retain old exports. */
export function buildDataPolicy(releaseCheck: boolean, skipSync: boolean, publicMirror = false) {
  return {
    syncDevData: !releaseCheck && !skipSync && !publicMirror,
    preserveDevSnapshot: !releaseCheck && !publicMirror,
  };
}

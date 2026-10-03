import fs from "node:fs";
import path from "node:path";
import { UPLOADS_DIR, isPathWithin } from "../../server/uploads-path";

/** The report tool returns a public URL path, not its absolute filesystem path. */
export function resolvePdfReplayArtifactPath(
  result: { file_path?: unknown; filePath?: unknown; localPath?: unknown },
  uploadsDir = UPLOADS_DIR,
): string | undefined {
  const raw = result?.file_path || result?.filePath || result?.localPath;
  if (typeof raw !== "string") return undefined;
  if (raw.startsWith("/uploads/")) {
    // Only a single PDF filename may be mapped into the private uploads directory.
    const match = /^\/uploads\/([^/\\?#]+\.pdf)$/i.exec(raw);
    return match ? path.join(uploadsDir, match[1]) : undefined;
  }
  return undefined;
}

export function isFreshPdfReplayArtifact(
  artifactPath: string,
  startedAtMs: number,
  uploadsDir = UPLOADS_DIR,
): boolean {
  try {
    const root = fs.realpathSync(uploadsDir);
    const file = fs.realpathSync(artifactPath);
    const stats = fs.statSync(file);
    return isPathWithin(root, file) && stats.isFile() && stats.mtimeMs >= startedAtMs - 5000;
  } catch {
    return false;
  }
}
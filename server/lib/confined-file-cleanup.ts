import fs from "fs";
import path from "path";

/** Return a stored path only when it is a regular file within uploadsDir. */
export function confinedRegularFilePath(filePath: string, uploadsDir: string): string | null {
  const root = path.resolve(uploadsDir);
  const absolute = path.resolve(filePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    return fs.statSync(absolute).isFile() ? absolute : null;
  } catch {
    return null;
  }
}
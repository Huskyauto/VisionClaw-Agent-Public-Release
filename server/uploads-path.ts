import path from "node:path";

function resolveUploadsDir(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error("[uploads] UPLOADS_DIR must be an absolute path");
    }
    const resolved = path.resolve(configured);
    if (path.basename(resolved) !== "uploads") {
      throw new Error("[uploads] UPLOADS_DIR must resolve to a directory named 'uploads'");
    }
    return resolved;
  }
  return process.env.NODE_ENV === "production"
    ? path.resolve("/tmp", "uploads")
    : path.resolve(process.cwd(), "uploads");
}

export const UPLOADS_DIR = resolveUploadsDir();

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveUploadsChild(childPath: string): string {
  const resolved = path.resolve(UPLOADS_DIR, childPath);
  if (!isPathWithin(UPLOADS_DIR, resolved)) {
    throw new Error("[uploads] path escapes the configured uploads directory");
  }
  return resolved;
}
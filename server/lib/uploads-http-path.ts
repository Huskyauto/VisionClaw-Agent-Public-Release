/**
 * The HTTP auth gate and express.static must see the same path topology.
 * Tool-private Drive downloads are never public HTTP assets.
 */
export function isSafeUploadsHttpPath(rawPath: unknown): boolean {
  if (typeof rawPath !== "string" || !rawPath.startsWith("/")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return false;
  if (decoded.split("/").length !== rawPath.split("/").length) return false;
  const parts = decoded.split("/");
  return !parts.some(part => part === "tenant-drive" || part === "." || part === "..");
}
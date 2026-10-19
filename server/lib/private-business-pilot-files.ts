import { and, eq, notLike } from "drizzle-orm";
import { fileStorage } from "@shared/schema";
import path from "node:path";
import type { RequestHandler } from "express";

export const BUSINESS_PILOT_FILE_PREFIX = "local-state-business-pilot-";
export const COMPANY_REPORT_PACKAGE_FILE_PREFIX = "__admin-company-package-";
/** Reserved owner application state is not a generic tenant file capability. */
export function isPrivateOwnerApplicationFile(filename: string): boolean {
  const name = path.basename(filename).toLowerCase();
  return name.startsWith(BUSINESS_PILOT_FILE_PREFIX) ||
    name.startsWith(COMPANY_REPORT_PACKAGE_FILE_PREFIX);
}
/** Includes owner-only PDF packages as well as pilot archives. */
export function tenantFileAccessFilter(tenantId: number) {
  return and(eq(fileStorage.tenantId, tenantId),
    notLike(fileStorage.filename, `${BUSINESS_PILOT_FILE_PREFIX}%`),
    notLike(fileStorage.filename, "\\_\\_admin-company-package-%"));
}
/** Runs before both DB hydration and static filesystem upload delivery. */
export const denyPrivatePilotUpload: RequestHandler = (req, res, next) => {
  let name: string;
  try { name = path.basename(decodeURIComponent(req.path)); }
  catch { res.status(400).json({ error: "Invalid file path" }); return; }
  if (isPrivateOwnerApplicationFile(name)) {
    res.status(404).json({ error: "File not found" }); return;
  }
  next();
};

import type { Express, Request, Response } from "express";
import {
  getRecoveryCheckpoint,
  listRecoveryCheckpoints,
  listRecoveryTimeline,
} from "../recovery-manifests";

type RecoveryManifestRouteHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

function parseOptionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!text || text.length > 128) throw new Error(`${field} must be a short non-empty string`);
  return text;
}

/**
 * Read-only inspection endpoints for restart evidence. Every lookup starts
 * from the authenticated request tenant and uses platform-admin access; there
 * is intentionally no resume/replay/mutation endpoint in this router.
 */
export function registerRecoveryManifestRoutes(app: Express, helpers: RecoveryManifestRouteHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  app.get("/api/recovery-manifests", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const query = {
        tenantId,
        runId: parseOptionalPositiveInt(req.query.runId, "runId"),
        conversationId: parseOptionalPositiveInt(req.query.conversationId, "conversationId"),
        traceId: parseOptionalText(req.query.traceId, "traceId"),
        limit: req.query.limit === undefined ? undefined : parseOptionalPositiveInt(req.query.limit, "limit"),
      };
      const manifests = await listRecoveryCheckpoints(query);
      res.json({ manifests });
    } catch (error: any) {
      res.status(400).json({ error: error?.message ?? "Invalid recovery manifest lookup" });
    }
  });

  app.get("/api/recovery-manifests/:id", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const id = parseOptionalPositiveInt(req.params.id, "id");
      const manifest = await getRecoveryCheckpoint(tenantId, id!);
      if (!manifest) return res.status(404).json({ error: "Recovery manifest not found" });
      const timeline = await listRecoveryTimeline({
        tenantId,
        runId: manifest.runId ?? undefined,
        conversationId: manifest.conversationId ?? undefined,
        traceId: manifest.traceId ?? undefined,
        limit: 100,
      });
      res.json({ manifest, timeline });
    } catch (error: any) {
      res.status(400).json({ error: error?.message ?? "Invalid recovery manifest lookup" });
    }
  });
}
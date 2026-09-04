import type { Express, Request, Response } from "express";
import {
  ARTIFACT_STATUSES,
  getArtifactRecord,
  listArtifactEvents,
  listArtifactRecords,
  loadArtifactBytes,
  reconcileArtifactDurability,
  resolveArtifactResendUncertainty,
} from "../durable-artifacts";
import { resendExistingDelivery } from "../delivery-pipeline";

type ArtifactRoutesHelpers = {
  authMiddleware: any;
  mutateLimiter: any;
  getTenantFromRequest: (req: Request) => number | null;
};

function parseArtifactId(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeDownloadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/["\\\r\n]/g, "_").slice(0, 180) || "artifact";
}

export function registerArtifactRoutes(app: Express, helpers: ArtifactRoutesHelpers): void {
  const { authMiddleware, mutateLimiter, getTenantFromRequest } = helpers;

  app.get("/api/artifacts", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      if (status && !ARTIFACT_STATUSES.includes(status as typeof ARTIFACT_STATUSES[number])) {
        return res.status(400).json({ error: "Invalid artifact status" });
      }
      const projectId = typeof req.query.projectId === "string" ? Number(req.query.projectId) : undefined;
      const records = await listArtifactRecords({
        tenantId,
        query: typeof req.query.q === "string" ? req.query.q : undefined,
        status: status as typeof ARTIFACT_STATUSES[number] | undefined,
        projectId,
        limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      });
      res.json(records);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Artifact list failed" });
    }
  });

  app.get("/api/artifacts/:id", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    const artifactId = parseArtifactId(String(req.params.id));
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!artifactId) return res.status(400).json({ error: "Invalid artifact ID" });
    try {
      const artifact = await getArtifactRecord(tenantId, artifactId);
      if (!artifact) return res.status(404).json({ error: "Artifact not found" });
      res.json({ artifact, events: await listArtifactEvents(tenantId, artifactId) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Artifact lookup failed" });
    }
  });

  app.get("/api/artifacts/:id/download", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    const artifactId = parseArtifactId(String(req.params.id));
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!artifactId) return res.status(400).json({ error: "Invalid artifact ID" });
    try {
      const { record, bytes } = await loadArtifactBytes({ tenantId, artifactId });
      res.setHeader("Content-Type", record.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName(record.logicalName)}"`);
      res.setHeader("Content-Length", bytes.length.toString());
      res.send(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact download failed";
      const status = message === "Artifact not found" ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/artifacts/:id/reconcile", mutateLimiter, authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    const artifactId = parseArtifactId(String(req.params.id));
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!artifactId) return res.status(400).json({ error: "Invalid artifact ID" });
    try {
      const artifact = await reconcileArtifactDurability(tenantId, artifactId);
      res.json({ artifact });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Artifact reconciliation failed" });
    }
  });

  app.post("/api/artifacts/:id/resend", mutateLimiter, authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    const artifactId = parseArtifactId(String(req.params.id));
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!artifactId) return res.status(400).json({ error: "Invalid artifact ID" });
    try {
      const artifact = await getArtifactRecord(tenantId, artifactId);
      if (!artifact) return res.status(404).json({ error: "Artifact not found" });
      if (!artifact.deliveryLogId) return res.status(409).json({ error: "This artifact has no customer delivery to resend" });
      const result = await resendExistingDelivery(artifact.deliveryLogId, tenantId);
      if (!result.success) return res.status(409).json({ error: result.error || "Resend failed" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Artifact resend failed" });
    }
  });

  app.post("/api/artifacts/:id/resolve-resend-uncertainty", mutateLimiter, authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    const artifactId = parseArtifactId(String(req.params.id));
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!artifactId) return res.status(400).json({ error: "Invalid artifact ID" });
    try {
      await resolveArtifactResendUncertainty(tenantId, artifactId);
      res.json({ success: true });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Resend uncertainty could not be resolved" });
    }
  });
}
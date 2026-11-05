import type { Express, Request, Response, NextFunction } from "express";
import { engineeringLibraryWriteSchema, type EngineeringLibrary } from "@shared/engineering-reference";
import { engineeringReferences, engineeringReviewScope } from "../lib/engineering-reference-catalog";

export interface EngineeringReferenceStore {
  read(tenantId: number): Promise<EngineeringLibrary>;
  write(tenantId: number, library: EngineeringLibrary): Promise<
    { kind: "saved"; library: EngineeringLibrary } | { kind: "conflict" }
  >;
}

export function registerEngineeringReferenceRoutes(app: Express, deps: {
  authMiddleware: (req: Request, res: Response, next: NextFunction) => unknown;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
  store: EngineeringReferenceStore;
}) {
  const owner = (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "private, no-store");
    if (deps.requirePlatformAdmin(req, res)) next();
  };
  const tenant = (req: Request, res: Response) => {
    const id = deps.getTenantFromRequest(req);
    if (!Number.isSafeInteger(id) || id! <= 0) {
      res.status(401).json({ error: "Authenticated tenant required." });
      return null;
    }
    return id!;
  };
  app.get("/api/admin/engineering-reference", deps.authMiddleware, owner, async (req, res) => {
    const tenantId = tenant(req, res); if (!tenantId) return;
    try {
      const library = await deps.store.read(tenantId);
      res.json({ ...library, references: engineeringReferences, scope: engineeringReviewScope });
    } catch {
      console.error("[engineering-reference] Library read failed.");
      res.status(503).json({ error: "Could not load the reference. Please retry." });
    }
  });
  app.put("/api/admin/engineering-reference", deps.authMiddleware, owner, async (req, res) => {
    const tenantId = tenant(req, res); if (!tenantId) return;
    const parsed = engineeringLibraryWriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Check the question fields and limits.", issues: parsed.error.issues });
    const validIds = new Set(engineeringReferences.map(entry => entry.id));
    if (parsed.data.notes.some(note => note.relatedReferenceId && !validIds.has(note.relatedReferenceId))) {
      return res.status(400).json({ error: "Related reference does not exist." });
    }
    try {
      const result = await deps.store.write(tenantId, parsed.data);
      if (result.kind === "conflict") return res.status(409).json({ error: "This library changed in another tab. Reload before saving; keep your draft." });
      res.json(result.library);
    } catch {
      console.error("[engineering-reference] Library write failed.");
      res.status(503).json({ error: "Save could not be confirmed. Keep your draft and retry." });
    }
  });
}

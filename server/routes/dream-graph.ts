import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";

interface Helpers {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isPlatformAdmin: (req: Request) => boolean;
}

export async function registerDreamGraphRoutes(app: Express, helpers: Helpers): Promise<void> {
  // Tenant-scoped on every read/write. Refuses to default to owner tenant —
  // would leak cross-tenant context. Validation via Zod insert schemas.
  const { insertTensionSchema, insertArchitectureDecisionSchema } = await import("@shared/schema");

  app.post("/api/tensions", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const parsed = insertTensionSchema.safeParse({ ...req.body, tenantId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid tension payload", issues: parsed.error.issues });
      const row = await storage.createTension(parsed.data);
      res.status(201).json(row);
    } catch (err: unknown) {
      console.error("[tensions] create failed:", err);
      res.status(500).json({ error: "Failed to create tension" });
    }
  });
  app.get("/api/tensions", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const sourceKind = typeof req.query.sourceKind === "string" ? req.query.sourceKind : undefined;
      const ownerPersonaId = req.query.ownerPersonaId ? parseInt(String(req.query.ownerPersonaId), 10) : undefined;
      const limit = req.query.limit ? Math.min(500, parseInt(String(req.query.limit), 10) || 100) : 100;
      res.json(await storage.listTensions(tenantId, { status, sourceKind, ownerPersonaId, limit }));
    } catch (err: unknown) {
      console.error("[tensions] list failed:", err);
      res.status(500).json({ error: "Failed to list tensions" });
    }
  });
  app.get("/api/tensions/:id", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const row = await storage.getTension(id, tenantId);
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: unknown) {
      console.error("[tensions] get failed:", err);
      res.status(500).json({ error: "Failed to fetch tension" });
    }
  });
  app.patch("/api/tensions/:id", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const allowed = new Set(["open", "investigating", "resolved", "superseded", "wontfix"]);
      const status = String(req.body?.status ?? "");
      if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status (allowed: open|investigating|resolved|superseded|wontfix)" });
      const row = await storage.updateTensionStatus(id, tenantId, status);
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: unknown) {
      console.error("[tensions] update failed:", err);
      res.status(500).json({ error: "Failed to update tension" });
    }
  });
  app.post("/api/tensions/:id/resolve", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const parsed = z.object({ resolution: z.string().trim().min(1, "resolution text required"), resolutionEvidence: z.any().optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      const row = await storage.resolveTension(id, tenantId, parsed.data.resolution, parsed.data.resolutionEvidence ?? {});
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: unknown) {
      console.error("[tensions] resolve failed:", err);
      res.status(500).json({ error: "Failed to resolve tension" });
    }
  });

  app.post("/api/adrs", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const parsed = insertArchitectureDecisionSchema.safeParse({ ...req.body, tenantId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid ADR payload", issues: parsed.error.issues });
      const row = await storage.createAdr(parsed.data);
      res.status(201).json(row);
    } catch (err: unknown) {
      console.error("[adrs] create failed:", err);
      res.status(500).json({ error: "Failed to create ADR" });
    }
  });
  app.get("/api/adrs", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
      const limit = req.query.limit ? Math.min(500, parseInt(String(req.query.limit), 10) || 100) : 100;
      res.json(await storage.listAdrs(tenantId, { status, tag, limit }));
    } catch (err: unknown) {
      console.error("[adrs] list failed:", err);
      res.status(500).json({ error: "Failed to list ADRs" });
    }
  });
  app.get("/api/adrs/:id", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ADR id" });
      const row = await storage.getAdr(id, tenantId);
      if (!row) return res.status(404).json({ error: "ADR not found" });
      res.json(row);
    } catch (err: unknown) {
      console.error("[adrs] get failed:", err);
      res.status(500).json({ error: "Failed to fetch ADR" });
    }
  });
  app.patch("/api/adrs/:id", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ADR id" });
      const allowed = new Set(["proposed", "accepted", "deprecated", "superseded"]);
      const status = String(req.body?.status ?? "");
      if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status (allowed: proposed|accepted|deprecated|superseded)" });
      const row = await storage.updateAdrStatus(id, tenantId, status);
      if (!row) return res.status(404).json({ error: "ADR not found" });
      res.json(row);
    } catch (err: unknown) {
      console.error("[adrs] update failed:", err);
      res.status(500).json({ error: "Failed to update ADR" });
    }
  });
  app.post("/api/adrs/:id/supersede", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const oldId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(oldId)) return res.status(400).json({ error: "Invalid ADR id" });
      const parsed = z.object({ newAdrId: z.coerce.number().int().positive(), reason: z.string().trim().min(1, "reason required") }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      const result = await storage.supersedeAdr(oldId, parsed.data.newAdrId, tenantId, parsed.data.reason);
      if (!result) return res.status(404).json({ error: "One or both ADRs not found in tenant" });
      res.json(result);
    } catch (err: unknown) {
      console.error("[adrs] supersede failed:", err);
      res.status(500).json({ error: "Failed to supersede ADR" });
    }
  });

  app.get("/api/graph-explorer", helpers.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = helpers.getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!helpers.isPlatformAdmin(req)) return res.status(403).json({ error: "Admin only" });
      const includeKinds = String(req.query.kinds ?? "personas,tensions,adrs,proposals").split(",").map((s) => s.trim());
      const proposalLimit = Math.min(50, parseInt(String(req.query.proposalLimit ?? "20"), 10) || 20);
      const nodes: Array<any> = [];
      const edges: Array<any> = [];
      if (includeKinds.includes("personas")) {
        for (const p of await storage.getPersonas()) nodes.push({ id: `persona:${p.id}`, kind: "persona", label: p.name, role: p.role, emoji: p.emoji, isActive: p.isActive });
      }
      if (includeKinds.includes("tensions")) {
        for (const t of await storage.listTensions(tenantId, { limit: 200 })) {
          nodes.push({ id: `tension:${t.id}`, kind: "tension", label: t.title, status: t.status, sourceKind: t.sourceKind, createdAt: t.createdAt });
          if (t.ownerPersonaId) edges.push({ from: `persona:${t.ownerPersonaId}`, to: `tension:${t.id}`, kind: "owns" });
          if (t.sourceKind === "surprise" && t.sourceId) edges.push({ from: `tension:${t.id}`, to: `proposal:${t.sourceId}`, kind: "sourced_from" });
        }
      }
      if (includeKinds.includes("adrs")) {
        for (const a of await storage.listAdrs(tenantId, { limit: 200 })) {
          nodes.push({ id: `adr:${a.id}`, kind: "adr", label: a.title, status: a.status, tags: a.tags, createdAt: a.createdAt });
          if (a.authorPersonaId) edges.push({ from: `persona:${a.authorPersonaId}`, to: `adr:${a.id}`, kind: "authored" });
          if (a.supersedes) edges.push({ from: `adr:${a.id}`, to: `adr:${a.supersedes}`, kind: "supersedes" });
        }
      }
      if (includeKinds.includes("proposals")) {
        const propRows: any = await db.execute(sql`SELECT id, kind, status, surprise_band FROM felix_proposals WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT ${proposalLimit}`);
        for (const p of (propRows.rows || [])) nodes.push({ id: `proposal:${p.id}`, kind: "proposal", label: `${p.kind} #${p.id}`, status: p.status, surpriseBand: p.surprise_band });
      }
      res.json({ tenantId, nodes, edges, generatedAt: new Date().toISOString() });
    } catch (err: unknown) {
      console.error("[graph-explorer] failed:", err);
      res.status(500).json({ error: "Failed to build graph" });
    }
  });
}
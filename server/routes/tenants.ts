// Routes-split Tier 1 — inline tenant endpoints extracted from server/routes.ts.
// Three register functions preserve original registration ORDER relative to the
// /api middleware gates (global authMiddleware app.use at ~2672):
//   registerTenantsPublicRoutes — pre-gate (register/login/me/me-profile)
//   registerTenantFilesRoutes   — post-gate (/api/tenant/files, explicit authMiddleware)
//   registerTemplatesRoutes     — post-gate (/api/templates CRUD + start)
// Pure move — zero behavior change (no-fix-during-refactor rule).
import { type Express, type Request, type Response } from "express";
import path from "path";
import { handleTenantRegister, handleTenantLogin } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { fileStorage } from "@shared/schema";
import { validate, tenantProfilePatchSchema } from "../validation";

type TenantsPublicHelpers = {
  loginLimiter: any;
  mutateLimiter: any;
  getTenantFromRequestAsync: (req: Request) => Promise<number | null>;
  ADMIN_TENANT_ID: number;
};

export function registerTenantsPublicRoutes(app: Express, helpers: TenantsPublicHelpers) {
  const { loginLimiter, mutateLimiter, getTenantFromRequestAsync, ADMIN_TENANT_ID } = helpers;

  app.post("/api/tenants/register", loginLimiter, handleTenantRegister);
  app.post("/api/tenants/login", loginLimiter, handleTenantLogin);

  app.get("/api/tenants/me", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.set("Cache-Control", "no-cache, no-store");
      res.json({
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        plan: tenant.plan,
        trialConversationsUsed: tenant.trialConversationsUsed,
        trialMaxConversations: tenant.trialMaxConversations,
        isAdmin: tenantId === ADMIN_TENANT_ID || !!tenant.isAdmin,
        isActive: tenant.isActive,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Round 18: hand-edited user profile (OpenClaw USER.md equivalent)
  app.get("/api/tenants/me/profile", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.set("Cache-Control", "no-cache, no-store");
      res.json({
        userNotesMarkdown: (tenant as any).userNotesMarkdown || "",
        disabledSkillNames: (tenant as any).disabledSkillNames || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.patch("/api/tenants/me/profile", mutateLimiter, validate(tenantProfilePatchSchema), async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { userNotesMarkdown, disabledSkillNames } = req.body || {};
      const updates: any = {};
      if (typeof userNotesMarkdown === "string") updates.userNotesMarkdown = userNotesMarkdown;
      if (Array.isArray(disabledSkillNames)) updates.disabledSkillNames = disabledSkillNames;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const updated = await storage.updateTenant(tenantId, updates);
      res.json({
        userNotesMarkdown: (updated as any)?.userNotesMarkdown || "",
        disabledSkillNames: (updated as any)?.disabledSkillNames || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update profile" });
    }
  });
}

type TenantFilesHelpers = {
  authMiddleware: any;
  mutateLimiter: any;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerTenantFilesRoutes(app: Express, helpers: TenantFilesHelpers) {
  const { authMiddleware, mutateLimiter, getTenantFromRequest } = helpers;

  app.get("/api/tenant/files", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { eq, desc } = await import("drizzle-orm");
      const files = await db.select({
        id: fileStorage.id,
        filename: fileStorage.filename,
        originalName: fileStorage.originalName,
        mimeType: fileStorage.mimeType,
        size: fileStorage.size,
        storageKey: fileStorage.storageKey,
        driveUrl: fileStorage.driveUrl,
        createdAt: fileStorage.createdAt,
      }).from(fileStorage).where(eq(fileStorage.tenantId, tenantId)).orderBy(desc(fileStorage.createdAt));
      res.json(files);
    } catch (err) {
      console.error("[tenant-files] List failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  app.get("/api/tenant/files/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const fileId = parseInt(req.params.id as string);
      if (isNaN(fileId)) return res.status(400).json({ error: "Invalid file ID" });
      const { eq, and } = await import("drizzle-orm");
      const [file] = await db.select().from(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      ).limit(1);
      if (!file) return res.status(404).json({ error: "File not found" });

      const ext = path.extname(file.originalName || file.filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv",
        ".json": "application/json", ".md": "text/markdown",
      };
      const mime = mimeMap[ext] || file.mimeType || "application/octet-stream";

      let buffer: Buffer | null = null;
      if (file.storageKey) {
        try {
          const { downloadTenantFile } = await import("../object-storage");
          buffer = await downloadTenantFile(tenantId, file.storageKey);
        } catch (osErr) {
          console.error("[tenant-files] Object Storage download failed:", (osErr as Error).message);
        }
      }
      if (!buffer && file.data && file.data.length > 0) {
        buffer = Buffer.from(file.data, "base64");
      }
      if (!buffer) return res.status(404).json({ error: "File data not found" });

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${file.originalName || file.filename}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err) {
      console.error("[tenant-files] Download failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to download file" });
    }
  });

  app.delete("/api/tenant/files/:id", mutateLimiter, authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const fileId = parseInt(req.params.id as string);
      if (isNaN(fileId)) return res.status(400).json({ error: "Invalid file ID" });
      const { eq, and } = await import("drizzle-orm");
      const [file] = await db.select().from(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      ).limit(1);
      if (!file) return res.status(404).json({ error: "File not found" });

      if (file.storageKey) {
        try {
          const { deleteTenantFile } = await import("../object-storage");
          await deleteTenantFile(tenantId, file.storageKey);
        } catch (osErr) {
          console.warn("[tenant-files] Object Storage delete failed:", (osErr as Error).message);
        }
      }

      await db.delete(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[tenant-files] Delete failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });
}

type TemplatesHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
};

export function registerTemplatesRoutes(app: Express, helpers: TemplatesHelpers) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest } = helpers;

  app.get("/api/templates", authMiddleware, async (_req: Request, res: Response) => {
    res.json(await storage.getConversationTemplates());
  });

  app.post("/api/templates", authMiddleware, async (req: Request, res: Response) => {
    // R74.13h: conversation_templates is global (no tenant_id) and is mutated
    // by other admin paths via isAdminRequest gate. POST was missing it —
    // any authenticated user could create global templates visible to all
    // tenants. Match PATCH/DELETE gating.
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { insertConversationTemplateSchema } = await import("@shared/schema");
      const parsed = insertConversationTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const template = await storage.createConversationTemplate(parsed.data);
      res.status(201).json(template);
    } catch (err: any) {
      console.error("[templates] Error:", err.message);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.patch("/api/templates/:id", authMiddleware, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { insertConversationTemplateSchema } = await import("@shared/schema");
      const parsed = insertConversationTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const updated = await storage.updateConversationTemplate(parseInt(req.params.id as string), parsed.data);
      res.json(updated);
    } catch (err: any) {
      console.error("[templates] Update error:", err.message);
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/templates/:id", authMiddleware, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    await storage.deleteConversationTemplate(parseInt(req.params.id as string));
    res.status(204).send();
  });

  app.post("/api/templates/:id/start", async (req: Request, res: Response) => {
    try {
      // R74.13s SECURITY HARDENING — was unauthenticated. Architect-found CRITICAL:
      // anon could spawn conversations + system messages + starter messages using
      // the global active persona + global default model, burning AI tokens against
      // the platform's default provider key. Now requires a valid tenant session
      // and scopes the new conversation to that tenant.
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const templates = await storage.getConversationTemplates();
      const template = templates.find(t => t.id === parseInt(req.params.id as string));
      if (!template) return res.status(404).json({ error: "Template not found" });

      const activePersona = await storage.getActivePersona();
      const settings = await storage.getSettings();
      const conv = await storage.createConversation({
        title: template.name,
        model: template.model || settings?.defaultModel || "gemini-2.5-flash",
        thinking: true,
        thinkingLevel: "auto",
        personaId: template.personaId || activePersona?.id || null,
        tenantId,
      } as any);

      if (template.systemPromptPrefix) {
        await storage.createMessage({ conversationId: conv.id, role: "system", content: template.systemPromptPrefix } as any);
      }

      if (template.starterMessages && template.starterMessages.length > 0) {
        for (const msg of template.starterMessages) {
          await storage.createMessage({ conversationId: conv.id, role: "user", content: msg } as any);
        }
      }

      res.status(201).json(conv);
    } catch (err: any) {
      console.error("[templates] Start error:", err.message);
      res.status(500).json({ error: "Failed to start from template" });
    }
  });
}

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { insertPersonaSchema } from "@shared/schema";
import { scanContextContent } from "../prompt-injection-scanner";

// R94 SECURITY — scan persona system-prompt-bearing fields for prompt
// injection BEFORE persisting (defense-in-depth alongside claude-import scan).
// Fields listed here are loaded directly into the system prompt by
// chat-engine.buildSystemPrompt at runtime.
const PERSONA_SCANNED_FIELDS = ["soul", "agentsDoc", "heartbeatDoc", "brandVoiceDoc", "identity", "tools"] as const;
function scanPersonaPayload(data: any): { ok: true } | { ok: false; field: string; findings: any[] } {
  for (const field of PERSONA_SCANNED_FIELDS) {
    const value = data?.[field];
    if (typeof value === "string" && value.length > 0) {
      const scan = scanContextContent(value, `persona.${field}`);
      if (!scan.clean) return { ok: false, field, findings: scan.findings };
    }
  }
  return { ok: true };
}

type PersonasHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  authMiddleware: any;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

/**
 * Round 60.B: Personas + persona-sync routes extracted from server/routes.ts
 * (~186 LOC removed). Pure move — no behavior changes. 13 handlers covering
 * persona CRUD, activate, display-name overrides, and per-agent reasoning
 * config. Persona-sync admin endpoints kept here since they share the same
 * surface area.
 */
export function registerPersonasRoutes(app: Express, helpers: PersonasHelpers) {
  const { getTenantFromRequest, authMiddleware, requirePlatformAdmin } = helpers;

  app.post("/api/personas/sync", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { syncPersonaDocs } = await import("../persona-sync");
      const raw = req.body.personaId ? parseInt(req.body.personaId) : undefined;
      const personaId = raw && !isNaN(raw) && raw >= 1 ? raw : undefined;
      if (req.body.personaId && !personaId) return res.status(400).json({ error: "personaId must be a positive integer" });
      const result = await syncPersonaDocs(personaId);
      res.json(result);
    } catch (e: any) {
      console.error("[persona-sync] Route error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/personas/sync/status", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { getSyncStatus } = await import("../persona-sync");
      res.json(await getSyncStatus());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Personas ─────────────────────────────────────────────
  app.get("/api/personas", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personas = await storage.getPersonas();
    try {
      const { db } = await import("../db");
      const { eq } = await import("drizzle-orm");
      const { tenantPersonaNames } = await import("@shared/schema");
      const overrides = await db.select().from(tenantPersonaNames).where(eq(tenantPersonaNames.tenantId, tenantId));
      const overrideMap = new Map(overrides.map(o => [o.personaId, o.displayName]));
      const enriched = personas.map(p => ({
        ...p,
        displayName: overrideMap.get(p.id) || null,
      }));
      res.json(enriched);
    } catch {
      res.json(personas);
    }
  });

  // R54.A: gated — leaks the active persona's full system prompt / soul
  app.get("/api/personas/active", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const p = await storage.getActivePersona();
    res.json(p || null);
  });

  app.post("/api/personas", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const parsed = insertPersonaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const scan = scanPersonaPayload(parsed.data);
    if (!scan.ok) {
      return res.status(400).json({
        error: `Persona field "${scan.field}" contains prompt-injection patterns. Remove or sanitize the flagged content before saving.`,
        findings: scan.findings,
      });
    }
    const p = await storage.createPersona(parsed.data);
    res.status(201).json(p);
  });

  // R54.A: gated — persona records expose identity/soul/tools docs (full system-prompt content)
  app.get("/api/personas/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const p = await storage.getPersona(parseInt(req.params.id as string));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });

  app.patch("/api/personas/:id", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const parsed = insertPersonaSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const scan = scanPersonaPayload(parsed.data);
    if (!scan.ok) {
      return res.status(400).json({
        error: `Persona field "${scan.field}" contains prompt-injection patterns. Remove or sanitize the flagged content before saving.`,
        findings: scan.findings,
      });
    }
    const p = await storage.updatePersona(parseInt(req.params.id as string), parsed.data);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });

  app.delete("/api/personas/:id", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    await storage.deletePersona(parseInt(req.params.id as string));
    res.status(204).send();
  });

  app.post("/api/personas/:id/activate", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      await storage.setActivePersona(parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(404).json({ error: err.message || "Persona not found" });
    }
  });

  app.put("/api/personas/:id/display-name", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = parseInt(req.params.id as string);
    const { displayName } = req.body;

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const persona = await storage.getPersona(personaId);
    if (!persona) return res.status(404).json({ error: "Persona not found" });

    if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
      return res.status(400).json({ error: "Display name is required" });
    }

    const trimmed = displayName.trim().slice(0, 50);

    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`
        INSERT INTO tenant_persona_names (tenant_id, persona_id, display_name)
        VALUES (${tenantId}, ${personaId}, ${trimmed})
        ON CONFLICT (tenant_id, persona_id) DO UPDATE SET display_name = ${trimmed}
      `);

      res.json({ personaId, displayName: trimmed, originalName: persona.name });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update display name" });
    }
  });

  app.delete("/api/personas/:id/display-name", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = parseInt(req.params.id as string);

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    try {
      const { db } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      const { tenantPersonaNames } = await import("@shared/schema");
      await db.delete(tenantPersonaNames)
        .where(and(eq(tenantPersonaNames.tenantId, tenantId), eq(tenantPersonaNames.personaId, personaId)));
      res.json({ personaId, displayName: null });
    } catch {
      res.status(500).json({ error: "Failed to reset display name" });
    }
  });

  // ─── Per-Agent Reasoning Config ─────────────────────────────
  app.get("/api/personas/:id/reasoning", authMiddleware, async (req, res) => {
    const personaId = parseInt(req.params.id as string);
    const persona = await storage.getPersona(personaId);
    if (!persona) return res.status(404).json({ error: "Persona not found" });
    try {
      const result = await db.execute(sql`SELECT reasoning_config FROM personas WHERE id = ${personaId}`);
      const rows = (result as any).rows || result;
      const config = (rows?.[0]?.reasoning_config) || {};
      res.json({ personaId, name: persona.name, reasoningConfig: config });
    } catch {
      res.json({ personaId, name: persona.name, reasoningConfig: {} });
    }
  });

  app.put("/api/personas/:id/reasoning", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const personaId = parseInt(req.params.id as string);
    const persona = await storage.getPersona(personaId);
    if (!persona) return res.status(404).json({ error: "Persona not found" });
    const { preferredModel, thinkingLevel, reasoningTier, maxTokens } = req.body;
    const config: any = {};
    if (preferredModel) config.preferredModel = String(preferredModel);
    if (thinkingLevel && ["off", "low", "medium", "high", "auto"].includes(thinkingLevel)) config.thinkingLevel = thinkingLevel;
    if (reasoningTier && ["fast", "balanced", "powerful", "reasoning"].includes(reasoningTier)) config.reasoningTier = reasoningTier;
    if (maxTokens && typeof maxTokens === "number" && maxTokens > 0) config.maxTokens = Math.min(maxTokens, 128000);
    try {
      await db.execute(sql`UPDATE personas SET reasoning_config = ${JSON.stringify(config)}::jsonb WHERE id = ${personaId}`);
      res.json({ personaId, name: persona.name, reasoningConfig: config });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update reasoning config" });
    }
  });
}

// R74.13v — Stage 31 of routes.ts decomposition.
// 8 routes for tenant-scoped team management (4) and per-tenant API keys (4).
//
// Team Management — /api/team {GET, POST, :id PATCH, :id DELETE}
//   • GET requires only tenant context (any authenticated tenant member)
//   • POST/PATCH/DELETE require requirePlatformAdmin
//
// API Keys — /api/api-keys {GET list, POST create, :id/revoke PATCH, :id DELETE}
//   • All four require requirePlatformAdmin (raw key only returned at creation;
//     subsequent reads return masked prefix only — verbatim from monolith)
//
// All writes also append to activityLog and (for team invites) notifications.
// Behavior preserved verbatim from monolith — no logic changes.

import type { Express, Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { teamMembers, apiKeys, activityLog, notifications } from "@shared/schema";

type TeamAdminHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerTeamAdminRoutes(app: Express, helpers: TeamAdminHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ═══════════════════════════════════════════════════════════════
  // TEAM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  app.get("/api/team", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const rows = await db.select().from(teamMembers)
        .where(eq(teamMembers.tenantId, tenantId))
        .orderBy(desc(teamMembers.invitedAt));
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/team", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const { email, displayName, role } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });
      const validRoles = ["admin", "editor", "viewer"];
      const memberRole = validRoles.includes(role) ? role : "viewer";
      const existing = await db.select().from(teamMembers)
        .where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.email, email)));
      if (existing.length > 0) return res.status(409).json({ error: "Team member already exists" });
      const [member] = await db.insert(teamMembers).values({
        tenantId, email, displayName: displayName || null, role: memberRole, status: "invited", invitedBy: tenantId,
      }).returning();
      await db.insert(activityLog).values({
        tenantId, actorType: "user", actorName: "Admin", action: "team_invite",
        resourceType: "team_member", resourceId: String(member.id),
        description: `Invited ${email} as ${memberRole}`,
      });
      await db.insert(notifications).values({
        tenantId, type: "info", title: "Team Member Invited",
        message: `${email} has been invited as ${memberRole}`, category: "team",
      });
      res.json(member);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/team/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const { role, status } = req.body;
      const updates: any = {};
      if (role && ["admin", "editor", "viewer"].includes(role)) updates.role = role;
      if (status && ["invited", "active", "suspended"].includes(status)) {
        updates.status = status;
        if (status === "active") updates.joinedAt = new Date();
      }
      const [updated] = await db.update(teamMembers).set(updates)
        .where(and(eq(teamMembers.id, parseInt(req.params.id as string)), eq(teamMembers.tenantId, tenantId)))
        .returning();
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/team/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.delete(teamMembers)
        .where(and(eq(teamMembers.id, parseInt(req.params.id as string)), eq(teamMembers.tenantId, tenantId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════════════
  // API KEYS
  // ═══════════════════════════════════════════════════════════════
  app.get("/api/api-keys", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const rows = await db.select({
        id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt, isRevoked: apiKeys.isRevoked,
        createdAt: apiKeys.createdAt,
      }).from(apiKeys)
        .where(eq(apiKeys.tenantId, tenantId))
        .orderBy(desc(apiKeys.createdAt));
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/api-keys", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const { name, scopes, expiresInDays } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const crypto = await import("crypto");
      const rawKey = `vc_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 10);
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;
      const [created] = await db.insert(apiKeys).values({
        tenantId, name, keyHash, keyPrefix, scopes: scopes || [], expiresAt, isRevoked: false,
      }).returning();
      await db.insert(activityLog).values({
        tenantId, actorType: "user", actorName: "Admin", action: "api_key_created",
        resourceType: "api_key", resourceId: String(created.id),
        description: `Created API key "${name}"`,
      });
      const { keyHash: _h, ...safeCreated } = created;
      res.json({ ...safeCreated, key: rawKey });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/api-keys/:id/revoke", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.update(apiKeys).set({ isRevoked: true })
        .where(and(eq(apiKeys.id, parseInt(req.params.id as string)), eq(apiKeys.tenantId, tenantId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/api-keys/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.delete(apiKeys)
        .where(and(eq(apiKeys.id, parseInt(req.params.id as string)), eq(apiKeys.tenantId, tenantId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}

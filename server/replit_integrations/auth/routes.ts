import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { getOrCreateTenantForReplitUser, ADMIN_TENANT_ID } from "../../auth";
import { storage } from "../../storage";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user) return res.json(null);

      const tenantId = await getOrCreateTenantForReplitUser(
        userId,
        user.email,
        [user.firstName, user.lastName].filter(Boolean).join(" ") || null
      );
      const tenant = await storage.getTenant(tenantId);

      res.json({
        ...user,
        tenant: tenant ? {
          id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          plan: tenant.plan,
          trialConversationsUsed: tenant.trialConversationsUsed,
          trialMaxConversations: tenant.trialMaxConversations,
          isAdmin: tenantId === ADMIN_TENANT_ID,
          isActive: tenant.isActive,
        } : null,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}

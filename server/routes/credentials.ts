// R74.13u — Stage 29 of routes.ts decomposition.
// 4 routes for the per-tenant Credential Vault:
// /api/credentials (GET, POST, /:id PATCH, /:id DELETE).
// All routes scoped via the local `requireTenant` helper which reads
// `(req as any).tenantId` (populated by upstream authMiddleware) — kept
// verbatim from monolith. No platform-admin gate (each tenant manages
// their own credentials). The credential-vault module is statically
// imported here (it was a top-level await dynamic import in routes.ts;
// both work, static is slightly cheaper at request time).
// Extracted verbatim from server/routes.ts L5136-L5199.
import type { Express, Request, Response } from "express";
import {
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
} from "../credential-vault";
import { getTenantFromRequest } from "../auth";

export function registerCredentialsRoutes(app: Express) {
  const validAuthTypes = ["password", "oauth", "api_key"] as const;
  // R74.13u — Use the canonical getTenantFromRequest resolver (was: raw
  // (req as any).tenantId). The previous form depended on whatever
  // upstream middleware ran on the route happening to populate req.tenantId.
  // getTenantFromRequest already prefers req.tenantId when set and falls
  // back to Bearer-token + Replit-OIDC resolution, so the swap is strictly
  // a superset of the old behavior — every code path that worked before
  // still works, plus paths that previously returned 401 spuriously now
  // resolve correctly.
  const requireTenant = (req: Request, res: Response): number | null => {
    const tid = getTenantFromRequest(req);
    if (!tid) { res.status(401).json({ error: "Authentication required" }); return null; }
    return tid;
  };

  app.get("/api/credentials", async (req, res) => {
    const tid = requireTenant(req, res); if (tid === null) return;
    try {
      const creds = await listCredentials(tid);
      res.json(creds);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/credentials", async (req, res) => {
    const tid = requireTenant(req, res); if (tid === null) return;
    try {
      const { siteName, siteUrl, authType, username, password, oauthProvider, oauthConfig, notes } = req.body;
      if (!siteName || typeof siteName !== "string") return res.status(400).json({ error: "siteName is required" });
      if (!siteUrl || typeof siteUrl !== "string") return res.status(400).json({ error: "siteUrl is required" });
      try { new URL(siteUrl); } catch { return res.status(400).json({ error: "siteUrl must be a valid URL" }); }
      const at = authType || "password";
      if (!validAuthTypes.includes(at)) return res.status(400).json({ error: `authType must be one of: ${validAuthTypes.join(", ")}` });
      const cred = await createCredential(tid, {
        siteName, siteUrl, authType: at, username, password, oauthProvider, oauthConfig, notes,
      });
      res.json(cred);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/credentials/:id", async (req, res) => {
    const tid = requireTenant(req, res); if (tid === null) return;
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid credential ID" });
      if (req.body.siteUrl) { try { new URL(req.body.siteUrl); } catch { return res.status(400).json({ error: "siteUrl must be a valid URL" }); } }
      if (req.body.authType && !validAuthTypes.includes(req.body.authType)) return res.status(400).json({ error: `authType must be one of: ${validAuthTypes.join(", ")}` });
      const cred = await updateCredential(id, tid, req.body);
      if (!cred) return res.status(404).json({ error: "Credential not found" });
      res.json(cred);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/credentials/:id", async (req, res) => {
    const tid = requireTenant(req, res); if (tid === null) return;
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid credential ID" });
      const ok = await deleteCredential(id, tid);
      if (!ok) return res.status(404).json({ error: "Credential not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

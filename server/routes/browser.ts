/**
 * Browser tool API — extracted from server/routes.ts (R59 monolith decomposition).
 *
 * Covers /api/browser/* endpoints: config, status, health, profiles, tabs,
 * screenshot, snapshot, sessions, and the static screenshot file fetch.
 *
 * Init helpers (autoConfigureFromEnv, startSessionCleanup, startScreenshotPruning)
 * remain in routes.ts startup wiring; only HTTP endpoints moved here.
 */
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import {
  loadBrowserConfig, saveBrowserConfig, getBrowserStatus, disconnectBrowser,
  createProfile, updateProfile, deleteProfile, checkConnectionHealth,
  listTabs, openTab, focusTab, closeTab, takeScreenshot, getPageSnapshot,
  getActiveSessions, checkTenantRateLimitExport, getRayobrowseStatus,
} from "../browser-tool";

type BrowserHelpers = {
  authMiddleware: any;
  getTenantFromRequestAsync: (req: Request) => Promise<number | null>;
  isPlatformAdmin: (req: Request) => boolean;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerBrowserRoutes(app: Express, helpers: BrowserHelpers) {
  // R74.13s SECURITY — browser config/profiles/disconnect are process-global
  // control plane (affect the shared headless-browser process used by every
  // tenant). Upgraded those hard-gate routes from `isAdminRequest` to
  // `requirePlatformAdmin` (header + ADMIN_TENANT_ID session). For the three
  // ENRICHMENT-style routes (/status, /sessions, /screenshots/:tenantId) the
  // architect identified that the original weak header-only check could leak
  // cross-tenant session metadata + screenshot data — those now use the
  // non-failing `isPlatformAdmin` predicate (same strong check, no res write).
  const { authMiddleware, getTenantFromRequestAsync, isPlatformAdmin, requirePlatformAdmin } = helpers;

  // ─── Browser Tool Config ────────────────────────────────
  app.get("/api/browser/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const config = loadBrowserConfig();
    const sanitized = { ...config };
    for (const [name, profile] of Object.entries(sanitized.profiles)) {
      sanitized.profiles[name] = {
        ...profile,
        cdpUrl: profile.cdpUrl?.replace(/token=[^&]+/, "token=***").replace(/apiKey=[^&]+/, "apiKey=***") || "",
        apiKey: profile.apiKey ? profile.apiKey.slice(0, 8) + "..." : "",
      };
    }
    res.json(sanitized);
  });

  app.put("/api/browser/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { enabled, defaultProfile, headless, ssrfPolicy, profiles, screenshotQuality, navigationTimeout, maxContentLength } = req.body;
      const update: any = {};
      if (typeof enabled === "boolean") update.enabled = enabled;
      if (typeof defaultProfile === "string") update.defaultProfile = defaultProfile;
      if (typeof headless === "boolean") update.headless = headless;
      if (ssrfPolicy && typeof ssrfPolicy === "object") update.ssrfPolicy = ssrfPolicy;
      if (profiles && typeof profiles === "object") update.profiles = profiles;
      if (typeof screenshotQuality === "number") update.screenshotQuality = screenshotQuality;
      if (typeof navigationTimeout === "number") update.navigationTimeout = navigationTimeout;
      if (typeof maxContentLength === "number") update.maxContentLength = maxContentLength;
      const updated = saveBrowserConfig(update);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/browser/status", authMiddleware, async (req, res) => {
    const status = getBrowserStatus();
    const rayobrowse = getRayobrowseStatus();
    const enriched = { ...status, rayobrowse };
    if (!isPlatformAdmin(req)) {
      const { sessionsByTenant, ...safe } = enriched as any;
      if (safe.rayobrowse) {
        safe.rayobrowse = { configured: safe.rayobrowse.configured, label: safe.rayobrowse.label };
      }
      return res.json(safe);
    }
    res.json(enriched);
  });

  app.post("/api/browser/disconnect", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    await disconnectBrowser();
    res.json({ ok: true });
  });

  app.get("/api/browser/health", authMiddleware, async (req, res) => {
    try {
      const profile = req.query.profile as string | undefined;
      const health = await checkConnectionHealth(profile);
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/profiles", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { name, cdpUrl, driver, color, label, apiKey } = req.body;
      if (!name) return res.status(400).json({ error: "Profile name required" });
      const config = createProfile(name, { cdpUrl, driver, color, label, apiKey });
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/browser/profiles/:name", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const config = updateProfile(req.params.name, req.body);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/browser/profiles/:name", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const config = deleteProfile(req.params.name);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/browser/tabs", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const profile = req.query.profile as string | undefined;
      const result = await listTabs(profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/open", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const { url, profile } = req.body;
      if (!url) return res.status(400).json({ error: "URL required" });
      const result = await openTab(url, profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/focus", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const { index, profile } = req.body;
      if (index === undefined) return res.status(400).json({ error: "Tab index required" });
      const result = await focusTab(index, profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/browser/tabs/:index", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const profile = req.query.profile as string | undefined;
      const result = await closeTab(parseInt(req.params.index), profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/screenshot", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const { tabIndex, fullPage, selector, profile } = req.body;
      const result = await takeScreenshot(tabIndex, fullPage, selector, profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/snapshot", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Browser rate limit exceeded" });
      const tabIndex = req.query.tabIndex ? parseInt(req.query.tabIndex as string) : undefined;
      const profile = req.query.profile as string | undefined;
      const result = await getPageSnapshot(tabIndex, profile, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/sessions", authMiddleware, async (req, res) => {
    const sessions = getActiveSessions();
    if (isPlatformAdmin(req)) return res.json(sessions);
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const filtered = sessions.filter((s: any) => s.tenantId === tenantId);
    res.json(filtered);
  });

  app.get("/api/browser/screenshots/:tenantId/:filename", authMiddleware, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const isAdmin = isPlatformAdmin(req);
      const requestedTenantDir = req.params.tenantId;
      const isGlobal = requestedTenantDir === "global";
      const requestedTenantId = isGlobal ? null : parseInt(requestedTenantDir);

      if (!isGlobal && !isAdmin && tenantId !== requestedTenantId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const filename = path.basename(req.params.filename);
      if (!/^[\w.-]+$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }
      const tenantDir = isGlobal ? "global" : String(requestedTenantId);
      if (!isGlobal && !/^\d+$/.test(tenantDir)) {
        return res.status(400).json({ error: "Invalid tenant ID" });
      }

      const searchBases = [
        path.join(process.cwd(), "data", "browser-screenshots"),
        "/tmp/browser-screenshots",
      ];
      let filepath: string | null = null;
      for (const base of searchBases) {
        const candidate = path.resolve(base, tenantDir, filename);
        if (candidate.startsWith(base) && fs.existsSync(candidate)) {
          filepath = candidate;
          break;
        }
      }

      if (!filepath) {
        return res.status(404).json({ error: "Screenshot not found" });
      }

      const ext = path.extname(filepath).toLowerCase();
      const contentType = ext === ".pdf" ? "application/pdf" : "image/png";
      res.setHeader("Content-Type", contentType);
      res.sendFile(filepath);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

import type { Express, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { db } from "../db";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { authMiddleware, getTenantFromRequest, requirePlatformAdmin } from "../auth";
import { withTenantContext } from "../lib/tenant-context";
import { connectorEnabled, FELIX_SCOPES } from "./policy";
import { postgresOAuthStore } from "./records";
import { FelixOAuthProvider } from "./oauth";
import { ensureFelixConnectorSchema } from "./schema";
import { clientBinding, setClientWorkPermission } from "./service";
import { buildFelixMcpServer } from "./mcp";

// Verified published origin, not derived from a request Host header.
const origin = new URL("https://agenticcorporation.net");
export async function registerFelixConnectorRoutes(app: Express) {
  await ensureFelixConnectorSchema();
  const provider = new FelixOAuthProvider(postgresOAuthStore, origin, ownerTenantId, process.env.NODE_ENV !== "production");
  const enabled = (_req: Request, res: Response, next: NextFunction) =>
    connectorEnabled() ? next() : res.status(503).json({error: "felix_connector_disabled"});
  const oauthPaths = ["/authorize", "/token", "/register", "/revoke",
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"];
  app.use(oauthPaths, enabled);
  app.use(mcpAuthRouter({provider, issuerUrl: origin, resourceServerUrl: new URL("/mcp", origin),
    scopesSupported: FELIX_SCOPES, resourceName: "Claude — Felix line",
    clientRegistrationOptions: {rateLimit: {windowMs: 3600000, max: 10}},
  }));
  app.get("/.well-known/oauth-protected-resource", enabled, (_req, res) => res.json({
    resource: new URL("/mcp", origin).href, authorization_servers: [origin.href],
    scopes_supported: FELIX_SCOPES, resource_name: "Claude — Felix line",
  }));
  const ownerSession = (req: Request, res: Response, next: NextFunction) => {
    // A broad vc_* admin key must not grant new OAuth delegation.
    if (Array.isArray((req as any).apiKeyScopes) || /^Bearer\s+(?:vc_|mcp_|flx_)/i.test(String(req.headers.authorization || "")))
      return res.status(403).json({error: "Owner browser sign-in required"});
    if (!requirePlatformAdmin(req, res)) return;
    if (getTenantFromRequest(req) !== ownerTenantId()) return res.status(403).json({error:"Owner browser sign-in required"});
    next();
  };
  const admin = "/api/admin/felix-connector";
  app.get(admin, authMiddleware, ownerSession, async (_req, res) => {
    const tenantId = ownerTenantId();
    const result: any = await db.execute(sql`SELECT l.client_id AS "clientId",l.conversation_id AS "conversationId",l.created_at AS "createdAt",l.allow_work AS "allowWork",
      (SELECT count(*)::int FROM felix_connector_records r WHERE r.tenant_id=${tenantId} AND r.client_id=l.client_id
        AND r.kind IN ('access','refresh') AND r.expires_at > NOW()) AS "activeTokens"
      FROM felix_line_clients l WHERE l.tenant_id=${tenantId}
        AND EXISTS (SELECT 1 FROM felix_connector_records r WHERE r.tenant_id=${tenantId}
          AND r.client_id=l.client_id AND r.kind IN ('access','refresh') AND r.expires_at > NOW())
      ORDER BY l.created_at DESC LIMIT 100`);
    res.setHeader("Cache-Control", "no-store");
    res.json({enabled: connectorEnabled(), clients: result.rows, connectorUrl: new URL("/mcp", origin).href});
  });
  app.get(`${admin}/consent`, authMiddleware, ownerSession, enabled, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (typeof req.query.request !== "string") return res.status(400).json({error: "Invalid consent request"});
    try { res.json(await provider.pending(req.query.request, getTenantFromRequest(req)!)); }
    catch { res.status(400).json({error: "Consent request expired or invalid. Start again from Claude."}); }
  });
  app.post(`${admin}/consent`, authMiddleware, ownerSession, enabled, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = z.object({request: z.string().min(20).max(128), allow: z.boolean(),allowWork:z.boolean().default(false)}).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error: "Invalid consent"});
    try {
      const tenantId = getTenantFromRequest(req)!;
      const pending = await provider.pending(parsed.data.request, tenantId);
      if (parsed.data.allowWork && !pending.scopes.includes("felix:write")) return res.status(400).json({error:"Sending permission is required for delegated work"});
      const redirectUrl = await provider.consent(parsed.data.request, tenantId, !parsed.data.allow,parsed.data.allowWork);
      res.json({redirectUrl});
    } catch { res.status(400).json({error: "Consent could not be completed. Start again from Claude."}); }
  });
  app.patch(`${admin}/clients/:clientId/permissions`,authMiddleware,ownerSession,enabled,async(req,res)=>{
    const parsed=z.object({allowWork:z.boolean()}).strict().safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:"Choose whether Felix may perform work"});
    try {
      const binding=await clientBinding(String(req.params.clientId),getTenantFromRequest(req)!);
      res.json(await setClientWorkPermission(binding,parsed.data.allowWork));
    } catch { res.status(400).json({error:"Connection permissions could not be updated"}); }
  });
  app.delete(`${admin}/clients/:clientId`, authMiddleware, ownerSession, async (req, res) => {
    await provider.revokeClient(String(req.params.clientId));
    res.json({ok: true});
  });
  const mcpLimit = rateLimit({windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false});
  function challenge(res: Response) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", origin).href}", scope="felix:read felix:write"`);
    return res.status(401).json({error: "OAuth sign-in required"});
  }
  app.all("/mcp", async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    // Preserve the existing API-key MCP surface exactly, including its scopes.
    if (/^Bearer\s+mcp_/i.test(header)) return next();
    return mcpLimit(req, res, () => { void handle(req, res); });
  });
  async function handle(req: Request, res: Response) {
    if (!connectorEnabled()) { res.status(503).json({error: "felix_connector_disabled"}); return; }
    if (req.headers.origin && ![origin.origin, "https://claude.ai", "https://claude.com"].includes(req.headers.origin)) {
      res.status(403).json({error: "Origin not allowed"}); return;
    }
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(flx_a_[A-Za-z0-9_-]+)$/i);
    if (!match) { challenge(res); return; }
    let auth;
    try { auth = await provider.verifyAccessToken(match[1]); }
    catch { challenge(res); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).end(); return; }
    const server = buildFelixMcpServer(auth);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    res.on("close", () => {
      void server.close().catch(() => console.warn("[felix-mcp] server close failed"));
      void transport.close().catch(() => console.warn("[felix-mcp] transport close failed"));
    });
    try {
      await withTenantContext({tenantId: Number(auth.extra?.tenantId), source: "explicit"}, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    } catch {
      console.error("[felix-mcp] request failed");
      if (!res.headersSent) res.status(500).json({error: "MCP request failed"});
    }
  }
  console.log("[felix-mcp] OAuth/PKCE and six-tool Claude connector registered");
}

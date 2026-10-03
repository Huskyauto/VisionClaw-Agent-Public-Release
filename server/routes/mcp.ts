/**
 * MCP (Model Context Protocol) Servers/Tools API — extracted from server/routes.ts
 * (R59 monolith decomposition).
 *
 * All endpoints are admin-gated. The legacy block placed validate() before the
 * admin check; we preserve that ordering exactly to keep request semantics identical.
 */
import type { Express, Request, Response } from "express";
import {
  listMcpServers, addMcpServer, removeMcpServer, toggleMcpServer,
  discoverMcpTools, getAllMcpTools, callMcpTool, refreshAllMcpTools,
} from "../mcp-client";
import { validate, mcpServerSchema, toggleSchema, mcpToolCallSchema } from "../validation";

type McpHelpers = {
  isAdminRequest: (req: Request) => boolean;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerMcpRoutes(app: Express, helpers: McpHelpers) {
  // R74.13s SECURITY — MCP server admin is process-global control plane (affects
  // every tenant's available tools). Upgraded from `isAdminRequest` (header-only,
  // weak) to `requirePlatformAdmin` (header + ADMIN_TENANT_ID session, strong).
  const { requirePlatformAdmin } = helpers;

  app.get("/api/mcp/servers", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { res.json(await listMcpServers()); } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/mcp/servers", validate(mcpServerSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { name, description, serverUrl, authType, authToken } = req.body;
      const server = await addMcpServer({ name, description, serverUrl, authType, authToken });
      res.json(server);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/mcp/servers/:id", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { await removeMcpServer(parseInt(req.params.id as string)); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/mcp/servers/:id/toggle", validate(toggleSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { await toggleMcpServer(parseInt(req.params.id as string), req.body.enabled); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/mcp/servers/:id/discover", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tools = await discoverMcpTools(parseInt(req.params.id as string));
      res.json({ tools, count: tools.length });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/mcp/tools", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(getAllMcpTools());
  });

  app.post("/api/mcp/tools/call", validate(mcpToolCallSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { serverId, toolName, args } = req.body;
      const result = await callMcpTool(serverId, toolName, args || {});
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/mcp/refresh", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const count = await refreshAllMcpTools();
      res.json({ success: true, totalTools: count });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}

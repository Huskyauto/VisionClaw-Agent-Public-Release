import { db } from "./db";
import { sql } from "drizzle-orm";
import { encryptApiKey, decryptApiKey, isEncrypted } from "./crypto";
import { validateMcpServerUrl, fetchMcpEndpoint } from "./lib/mcp-network-boundary";

// PLATFORM-GLOBAL administration. All HTTP callers require platform-admin
// authority; never expose these functions as tenant tools without ownership.
async function mcpAuthHeaders(server: any): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!server.auth_token) return headers;
  const token = decryptApiKey(server.auth_token);
  if (!isEncrypted(server.auth_token)) {
    const encrypted = encryptApiKey(token);
    if (!isEncrypted(encrypted)) throw new Error("MCP credential encryption unavailable; configure SESSION_SECRET before using authenticated MCP servers");
    await db.execute(sql`UPDATE mcp_servers SET auth_token = ${encrypted}
      WHERE id = ${server.id} AND auth_token = ${server.auth_token}`);
  }
  if (server.auth_type === "bearer") headers.Authorization = `Bearer ${token}`;
  else if (server.auth_type === "api_key") headers["X-API-Key"] = token;
  return headers;
}

import { logSilentCatch } from "./lib/silent-catch";
export interface McpServerConfig {
  id: number;
  name: string;
  description: string;
  serverUrl: string;
  authType: "none" | "bearer" | "api_key";
  authToken: string | null;
  enabled: boolean;
  toolCount: number;
  lastConnected: string | null;
  createdAt: string;
}

export interface McpTool {
  serverId: number;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

const discoveredTools = new Map<number, McpTool[]>();

export async function ensureMcpTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      server_url TEXT NOT NULL,
      auth_type TEXT DEFAULT 'none',
      auth_token TEXT,
      enabled BOOLEAN DEFAULT true,
      tool_count INTEGER DEFAULT 0,
      last_connected TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function listMcpServers(): Promise<McpServerConfig[]> {
  await ensureMcpTables();
  const result = await db.execute(sql`SELECT * FROM mcp_servers ORDER BY created_at DESC`);
  const rows = (result as any).rows || result;
  return (rows || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    serverUrl: r.server_url,
    authType: r.auth_type || "none",
    authToken: r.auth_token ? "***configured***" : null,
    enabled: r.enabled,
    toolCount: r.tool_count || 0,
    lastConnected: r.last_connected,
    createdAt: r.created_at,
  }));
}

export async function addMcpServer(config: {
  name: string;
  description?: string;
  serverUrl: string;
  authType?: string;
  authToken?: string;
}): Promise<McpServerConfig> {
  const target = await validateMcpServerUrl(config.serverUrl);
  if (!["none", "bearer", "api_key"].includes(config.authType || "none")) throw new Error("Invalid MCP authentication type");
  const storedToken = config.authToken ? encryptApiKey(config.authToken) : null;
  if (storedToken && !isEncrypted(storedToken)) throw new Error("MCP credential encryption unavailable; configure SESSION_SECRET before using authenticated MCP servers");
  await ensureMcpTables();
  const result = await db.execute(sql`
    INSERT INTO mcp_servers (name, description, server_url, auth_type, auth_token)
    VALUES (${config.name}, ${config.description || ""}, ${target.url}, ${config.authType || "none"}, ${storedToken})
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    serverUrl: r.server_url,
    authType: r.auth_type,
    authToken: r.auth_token ? "***configured***" : null,
    enabled: r.enabled,
    toolCount: r.tool_count || 0,
    lastConnected: r.last_connected,
    createdAt: r.created_at,
  };
}

export async function removeMcpServer(id: number): Promise<void> {
  await db.execute(sql`DELETE FROM mcp_servers WHERE id = ${id}`);
  discoveredTools.delete(id);
}

export async function toggleMcpServer(id: number, enabled: boolean): Promise<void> {
  await db.execute(sql`UPDATE mcp_servers SET enabled = ${enabled} WHERE id = ${id}`);
  if (!enabled) {
    discoveredTools.delete(id);
  }
}

export async function discoverMcpTools(serverId: number): Promise<McpTool[]> {
  const result = await db.execute(sql`SELECT * FROM mcp_servers WHERE id = ${serverId}`);
  const rows = (result as any).rows || result;
  const server = rows?.[0];
  if (!server) throw new Error("MCP server not found");

  try {
    const headers = await mcpAuthHeaders(server);
    const response = await fetchMcpEndpoint(server.server_url, "tools/list", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MCP server returned ${response.status}`);
    }

    const data = await response.json();
    const toolList = data.result?.tools || data.tools || [];

    const tools: McpTool[] = toolList.map((t: any) => ({
      serverId,
      serverName: server.name,
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || {},
    }));

    discoveredTools.set(serverId, tools);

    await db.execute(sql`
      UPDATE mcp_servers SET tool_count = ${tools.length}, last_connected = NOW()
      WHERE id = ${serverId}
    `);

    console.log(`[mcp] Discovered ${tools.length} tools from ${server.name}`);
    return tools;
  } catch (err: any) {
    console.error(`[mcp] Failed to discover tools from ${server.name}:`, err.message);
    throw err;
  }
}

export async function callMcpTool(serverId: number, toolName: string, args: Record<string, any>): Promise<any> {
  const result = await db.execute(sql`SELECT * FROM mcp_servers WHERE id = ${serverId} AND enabled = true`);
  const rows = (result as any).rows || result;
  const server = rows?.[0];
  if (!server) throw new Error("MCP server not found or disabled");

  const headers = await mcpAuthHeaders(server);
  const response = await fetchMcpEndpoint(server.server_url, "tools/call", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now(),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`MCP tool call failed: ${response.status}`);
  }

  const data = await response.json();
  return data.result || data;
}

export function getAllMcpTools(): McpTool[] {
  const allTools: McpTool[] = [];
  for (const tools of discoveredTools.values()) {
    allTools.push(...tools);
  }
  return allTools;
}

export async function refreshAllMcpTools(): Promise<number> {
  await ensureMcpTables();
  const result = await db.execute(sql`SELECT id FROM mcp_servers WHERE enabled = true`);
  const rows = (result as any).rows || result;
  let totalTools = 0;
  for (const row of rows || []) {
    try {
      const tools = await discoverMcpTools(row.id);
      totalTools += tools.length;
    } catch (_silentErr) { logSilentCatch("server/mcp-client.ts", _silentErr); }
  }
  return totalTools;
}

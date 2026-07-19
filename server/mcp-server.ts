import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Express, Request, Response, NextFunction } from "express";
import { TOOL_DEFINITIONS, executeTool, getAllToolDefinitions } from "./tools";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const ADMIN_TENANT_ID = 1;

// Auto-generated MCP key path. Restrictive 0600 perms so only the process
// owner can read it. Operators retrieve via `cat .local/mcp-key.txt`.
const MCP_KEY_FILE = path.join(process.cwd(), ".local", "mcp-key.txt");

function loadOrCreateMcpKey(): { key: string; source: "env" | "file" | "generated" } {
  if (process.env.MCP_API_KEY && process.env.MCP_API_KEY.length >= 32) {
    return { key: process.env.MCP_API_KEY, source: "env" };
  }
  // Reuse a previously-written key so it doesn't rotate on every restart
  // (which would silently break already-connected MCP clients).
  try {
    const existing = fs.readFileSync(MCP_KEY_FILE, "utf8").trim();
    if (existing.length >= 32) return { key: existing, source: "file" };
  } catch (_silentErr) { logSilentCatch("server/mcp-server.ts", _silentErr); }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(MCP_KEY_FILE), { recursive: true });
    fs.writeFileSync(MCP_KEY_FILE, generated, { mode: 0o600 });
    fs.chmodSync(MCP_KEY_FILE, 0o600);
  } catch (err: any) {
    console.warn(`[mcp-server] Could not persist generated key (${err?.message}). Key will rotate on next restart — set MCP_API_KEY env var to make it stable.`);
  }
  return { key: generated, source: "generated" };
}

const _mcpKeyInfo = loadOrCreateMcpKey();
const MCP_API_KEY = _mcpKeyInfo.key;
let mcpKeyLogged = false;

const SENSITIVE_TOOLS = new Set([
  "test_api_keys", "manage_api_keys", "admin_dashboard",
  "manage_tenants", "system_config", "exec", "execute_code",
  "send_email", "gmail_send", "whatsapp", "manage_billing",
  "stripe_manage", "delegate_task", "orchestrate",
  "run_background_task",
  // R74.13v post-review: filesystem tools removed from remote MCP surface.
  // They operate on /home/runner/workspace which is shared across tenants;
  // a leaked tenant MCP key must not yield read/write access to global
  // workspace state or other tenants' data files. Still available via
  // in-app chat where Felix/Forge personas need them.
  "read_file", "write_file",
]);

// R64.C — Per-tenant MCP key derivation. The single global MCP_API_KEY meant
// any operator who held the key could act as ANY tenant via MCP. We now
// derive a tenant-bound key as HMAC(MCP_API_KEY, "mcp:v1:" + tenantId).
//
// Acceptance order:
//   1) The exact global key (legacy / admin tenant 1 only — back-compat).
//   2) A tenant-derived key matching some tenant id; that tenant is bound
//      to (req as any)._mcpTenantId for downstream use.
export function deriveMcpTenantKey(tenantId: number): string {
  return crypto.createHmac("sha256", MCP_API_KEY).update(`mcp:v1:${tenantId}`).digest("hex");
}

// R74.13z-quint+5 — Cap the known-key LRU so a sustained brute-force on
// /api/mcp/sse can't exhaust memory by filling this map with miss entries.
// We only ever store HIT entries (key→tenantId), so 256 is plenty: that's
// 256 distinct valid tenant keys cached. If we ever exceed, evict oldest.
const _knownTenantKeys = new Map<string, number>();
const KNOWN_TENANT_KEYS_MAX = 256;

// Lookup result: tenant id, true miss, or infra failure. The caller treats
// infra failure differently from a true miss so that a transient DB outage
// doesn't poison the negative cache and lock out a valid key for 5s.
type LookupResult = { kind: "hit"; tenantId: number } | { kind: "miss" } | { kind: "infra_error"; message: string };

async function lookupTenantForKey(key: string): Promise<LookupResult> {
  if (_knownTenantKeys.has(key)) return { kind: "hit", tenantId: _knownTenantKeys.get(key)! };
  try {
    const { db } = await import("./db");
    const { tenants } = await import("@shared/schema");
    const rows = await db.select({ id: tenants.id }).from(tenants);
    for (const r of rows) {
      const candidate = deriveMcpTenantKey(r.id);
      if (timingSafeEqual(candidate, key)) {
        if (_knownTenantKeys.size >= KNOWN_TENANT_KEYS_MAX) {
          const firstKey = _knownTenantKeys.keys().next().value;
          if (firstKey !== undefined) _knownTenantKeys.delete(firstKey);
        }
        _knownTenantKeys.set(key, r.id);
        return { kind: "hit", tenantId: r.id };
      }
    }
    return { kind: "miss" };
  } catch (err: any) {
    console.warn(`[mcp-auth] Tenant key lookup failed: ${err?.message}`);
    return { kind: "infra_error", message: err?.message ?? String(err) };
  }
}

// R74.13z-quint+5 — Visibility for the two back-compat auth paths Bob still
// wants to keep working. We don't disable them (would break in-flight clients);
// we just emit a one-shot warning per process so the operator can decide when
// to migrate clients off them.
let _warnedQueryStringAuth = false;
let _warnedGlobalKeyAuth = false;

// R74.13z-quint+5 — Negative cache for invalid keys. Without this, repeated
// requests with the same bad key each cost a full tenant-table scan + HMAC per
// row. Cache the "this key is invalid" verdict for 5s and reject in O(1).
// Cache is bounded so a brute-force attacker can't fill it up to evict the
// known-good _knownTenantKeys entries.
const _invalidKeyCache = new Map<string, number>(); // key → expiresAt epoch ms
const INVALID_KEY_TTL_MS = 5000;
const INVALID_KEY_CACHE_MAX = 1024;
function rememberInvalidKey(key: string): void {
  if (_invalidKeyCache.size >= INVALID_KEY_CACHE_MAX) {
    const firstKey = _invalidKeyCache.keys().next().value;
    if (firstKey !== undefined) _invalidKeyCache.delete(firstKey);
  }
  _invalidKeyCache.set(key, Date.now() + INVALID_KEY_TTL_MS);
}
function isCachedInvalid(key: string): boolean {
  const exp = _invalidKeyCache.get(key);
  if (exp === undefined) return false;
  if (Date.now() > exp) { _invalidKeyCache.delete(key); return false; }
  return true;
}

// Centralized URL redaction. Sanitizes BOTH req.url (used by Express routing
// and some loggers) AND req.originalUrl (used by morgan, pino-http, and most
// access-log middleware). Runs whenever api_key is present in the query string,
// regardless of whether the client also sent an Authorization header — a
// client that sends BOTH would otherwise leak the query key in logs.
function redactApiKeyFromRequest(req: Request): void {
  const sanitize = (u: string | undefined): string | undefined => {
    if (!u || !u.includes("api_key=")) return u;
    return u.replace(/([?&])api_key=[^&]*/g, "$1api_key=REDACTED").replace(/[?&]$/, "");
  };
  const newUrl = sanitize(req.url);
  if (newUrl !== undefined && newUrl !== req.url) req.url = newUrl;
  const newOriginal = sanitize(req.originalUrl);
  if (newOriginal !== undefined && newOriginal !== req.originalUrl) {
    try { (req as any).originalUrl = newOriginal; } catch (_silentErr) { logSilentCatch("server/mcp-server.ts", _silentErr); }
  }
  // Defense-in-depth: overwrite req.query.api_key in the parsed query object so
  // any middleware that logs req.query (rather than req.url/originalUrl) also
  // sees REDACTED. Wrapped in try/catch in case Express has frozen the object.
  if (req.query && (req.query as any).api_key) {
    try { (req.query as any).api_key = "REDACTED"; } catch (_silentErr) { logSilentCatch("server/mcp-server.ts", _silentErr); }
  }
}

function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const queryKey = req.query.api_key as string | undefined;
  const headerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const providedKey = headerKey || queryKey;
  // "Used" query string = query was the source of the actually-applied key.
  // We only emit the deprecation warning in that case (a request with both
  // header AND query, where header wins, isn't using query-auth — but we
  // still redact below so the leaked-into-logs concern is covered).
  const usedQueryString = !headerKey && !!queryKey;
  const queryHasApiKey = !!queryKey;

  if (queryHasApiKey) redactApiKeyFromRequest(req);

  if (!providedKey || providedKey.length < 32) {
    res.status(401).json({ error: "MCP API key required. Provide via Authorization: Bearer <key> (preferred) or ?api_key=<key> (back-compat for clients that cannot send headers)." });
    return;
  }

  if (usedQueryString && !_warnedQueryStringAuth) {
    _warnedQueryStringAuth = true;
    console.warn("[mcp-auth] DEPRECATION: a client authenticated via ?api_key= query string. This works but the key can leak into access logs, browser history, and Referer headers. Migrate to Authorization: Bearer <key> when possible. (This warning fires once per process.)");
  }

  if (timingSafeEqual(providedKey, MCP_API_KEY)) {
    if (!_warnedGlobalKeyAuth) {
      _warnedGlobalKeyAuth = true;
      console.warn(`[mcp-auth] NOTICE: a client authenticated with the global MCP key, which grants admin tenant (${ADMIN_TENANT_ID}) access. This is the documented back-compat path. For SaaS / multi-tenant deployments, prefer per-tenant derived keys via deriveMcpTenantKey(tenantId). (This notice fires once per process.)`);
    }
    (req as any)._mcpTenantId = ADMIN_TENANT_ID;
    // R94 SECURITY — wrap in AsyncLocalStorage tenant context so downstream
    // tool LLM calls bill the right tenant (here: ADMIN for the global key).
    import("./lib/tenant-context").then(({ runWithTenant }) =>
      runWithTenant(ADMIN_TENANT_ID, "api-key", () => next())
    );
    return;
  }

  if (isCachedInvalid(providedKey)) {
    res.status(401).json({ error: "Invalid MCP API key" });
    return;
  }

  lookupTenantForKey(providedKey).then(result => {
    if (result.kind === "hit") {
      (req as any)._mcpTenantId = result.tenantId;
      // R94 SECURITY — see comment above. Per-tenant derived MCP key path.
      import("./lib/tenant-context").then(({ runWithTenant }) =>
        runWithTenant(result.tenantId, "api-key", () => next())
      );
    } else if (result.kind === "miss") {
      rememberInvalidKey(providedKey);
      res.status(401).json({ error: "Invalid MCP API key" });
    } else {
      // Infra error: do NOT cache — caching would lock out a valid key during
      // a transient DB outage. Return 503 so the client retries instead of
      // treating it as a permanent auth failure.
      res.status(503).json({ error: "MCP auth temporarily unavailable, please retry" });
    }
  }).catch((err: any) => {
    // Defensive: lookupTenantForKey shouldn't reject (it returns infra_error),
    // but if it does, treat it the same as infra_error — don't poison the cache.
    console.warn(`[mcp-auth] Unexpected lookup rejection: ${err?.message ?? err}`);
    res.status(503).json({ error: "MCP auth temporarily unavailable, please retry" });
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function convertToolDefToMcp(toolDef: any) {
  const fn = toolDef.function;
  return {
    name: `visionclaw_${fn.name}`,
    description: fn.description || "",
    inputSchema: {
      type: "object" as const,
      properties: fn.parameters?.properties || {},
      required: fn.parameters?.required || [],
    },
  };
}

export function createMcpServer(tenantId: number = ADMIN_TENANT_ID): Server {
  const server = new Server(
    {
      name: "visionclaw-agent",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = await getAllToolDefinitions();
    const filtered = allTools.filter(t => !SENSITIVE_TOOLS.has(t.function.name));
    return {
      tools: filtered.map(convertToolDefToMcp),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const rawName = request.params.name;
    const toolName = rawName.startsWith("visionclaw_") ? rawName.slice(11) : rawName;

    if (SENSITIVE_TOOLS.has(toolName)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Tool not available via MCP" }) }],
        isError: true,
      };
    }

    const params = { ...(request.params.arguments || {}), _tenantId: tenantId };
    const startTime = Date.now();

    try {
      console.log(`[mcp-server] Executing tool: ${toolName} for tenant ${tenantId}`);
      // R100/R101/R102 +arch2 — MCP is an external surface (Claude Desktop,
      // Cursor, custom bots). It MUST honor the destructive-tool-policy gate
      // that the agent loop normally applies via executeGuardedTool. Without
      // this, trusted-only tools (undo_last_action, query_trace,
      // system_load_status, exec_sql, shell_exec) AND any unregistered
      // suspicious-named tool (inferRiskFromName fallback) would be reachable
      // by any MCP client. Delegate to the canonical enforceToolPolicy with
      // the MCP caller forced to "untrusted external" + no fresh approval —
      // this gives us the inferred-risk fallback for free and avoids drift
      // with the agent-loop gate.
      const { enforceToolPolicy } = await import("./safety/destructive-tool-policy");
      try {
        const decision = await enforceToolPolicy(toolName, params, {
          tenantId,
          personaName: "mcp-external",
          invokedVia: "mcp-server",
          hasApproval: false,
        });
        if (decision.action === "block") {
          const elapsed = Date.now() - startTime;
          console.warn(`[mcp-server] BLOCKED tool=${toolName} tenant=${tenantId} reason=${decision.reason || "policy"} elapsed=${elapsed}ms`);
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Tool '${toolName}' blocked by destructive-tool-policy: ${decision.reason || "unspecified"}` }) }],
            isError: true,
          };
        }
      } catch (e: any) {
        // Fail CLOSED on enforcement errors — destructive policy is the floor.
        const elapsed = Date.now() - startTime;
        console.error(`[mcp-server] policy enforcement crashed tool=${toolName} tenant=${tenantId} elapsed=${elapsed}ms err=${e?.message || e}`);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Tool '${toolName}' blocked: policy enforcement unavailable (fail-closed).` }) }],
          isError: true,
        };
      }
      const result = await executeTool(toolName, params);
      const elapsed = Date.now() - startTime;
      console.log(`[mcp-server] Tool ${toolName} completed in ${elapsed}ms`);

      const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      // R95.c — Strict outbound gate on MCP responses. External MCP clients
      // are world-visible third-party surfaces (Claude Desktop, Cursor, custom
      // bots). Tool output containing secrets must never leave the tenant
      // boundary via this channel.
      const { enforceOutbound } = await import("./lib/outbound-redaction");
      const gate = enforceOutbound(resultText, { surface: `mcp_sse:${toolName}`, strict: true });
      if (!gate.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: gate.error }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: gate.payload }],
      };
    } catch (err: any) {
      console.error(`[mcp-server] Tool ${toolName} failed:`, err.message);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "visionclaw://system/status",
          name: "System Status",
          description: "Current system health, uptime, and active services",
          mimeType: "application/json",
        },
        {
          uri: "visionclaw://system/personas",
          name: "Available Personas",
          description: "List of all 16 AI personas and their capabilities",
          mimeType: "application/json",
        },
        {
          uri: "visionclaw://system/tools",
          name: "Tool Catalog",
          description: "Complete catalog of all available tools with descriptions",
          mimeType: "application/json",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    switch (uri) {
      case "visionclaw://system/status": {
        const result = await executeTool("check_system_status", { _tenantId: tenantId });
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }
      case "visionclaw://system/personas": {
        const result = await executeTool("list_personas", { _tenantId: tenantId });
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }
      case "visionclaw://system/tools": {
        const allTools = await getAllToolDefinitions();
        const catalog = allTools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameterCount: Object.keys(t.function.parameters?.properties || {}).length,
        }));
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ totalTools: catalog.length, tools: catalog }, null, 2),
          }],
        };
      }
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

const sseTransports = new Map<string, SSEServerTransport>();

export function registerMcpRoutes(app: Express): void {
  app.get("/api/mcp/info", (_req: Request, res: Response) => {
    const toolCount = TOOL_DEFINITIONS.length;
    res.json({
      name: "VisionClaw Agent MCP Server",
      version: "1.0.0",
      protocol: "MCP (Model Context Protocol)",
      transport: ["SSE (Server-Sent Events)"],
      endpoints: {
        sse: "/api/mcp/sse",
        messages: "/api/mcp/messages",
      },
      authentication: "Bearer token required (MCP_API_KEY)",
      capabilities: {
        tools: toolCount,
        resources: 3,
        personas: 16,
        models: "36+",
      },
      description: "Multi-tenant agentic AI platform exposing 250+ tools via the Model Context Protocol. Connect any MCP-compatible client to access VisionClaw's full tool suite.",
    });
  });

  // R64.C — Bind every SSE sessionId to the authenticated tenant so that
  // a leaked sessionId cannot be POST-ed to by another valid MCP key.
  const sseTenantBindings = new Map<string, number>();

  app.get("/api/mcp/sse", mcpAuthMiddleware, async (req: Request, res: Response) => {
    const boundTenant = (req as any)._mcpTenantId || ADMIN_TENANT_ID;
    console.log(`[mcp-server] Authenticated SSE connection established (tenant=${boundTenant})`);
    const transport = new SSEServerTransport("/api/mcp/messages", res);
    const sessionId = transport.sessionId;
    sseTransports.set(sessionId, transport);
    sseTenantBindings.set(sessionId, boundTenant);

    const server = createMcpServer(boundTenant);

    res.on("close", () => {
      console.log(`[mcp-server] SSE connection closed: ${sessionId}`);
      sseTransports.delete(sessionId);
      sseTenantBindings.delete(sessionId);
    });

    await server.connect(transport);
  });

  app.post("/api/mcp/messages", mcpAuthMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: "No active SSE connection for this session" });
      return;
    }
    // R64.C — verify the POSTing key resolves to the same tenant that owns
    // the SSE session. Without this, any holder of any valid MCP key could
    // hijack any active sessionId once the id leaks (logs, referrer, etc).
    const requesterTenant = (req as any)._mcpTenantId;
    const sessionOwner = sseTenantBindings.get(sessionId);
    if (sessionOwner !== undefined && requesterTenant !== sessionOwner) {
      res.status(403).json({ error: "Session belongs to a different tenant" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  if (!mcpKeyLogged) {
    mcpKeyLogged = true;
    if (_mcpKeyInfo.source === "env") {
      console.log("[mcp-server] MCP Server routes registered (SSE transport on /api/mcp/sse, auth via MCP_API_KEY env var)");
    } else if (_mcpKeyInfo.source === "file") {
      console.log(`[mcp-server] MCP Server routes registered (SSE transport on /api/mcp/sse, auth key loaded from ${MCP_KEY_FILE})`);
    } else {
      // SECURITY: Never log the key (or any prefix of it) to stdout — logs may
      // be aggregated to third parties. Operator retrieves via the 0600 file.
      console.log(`[mcp-server] MCP Server routes registered (SSE transport on /api/mcp/sse, auto-generated key written to ${MCP_KEY_FILE} — cat that file to connect a client, or set MCP_API_KEY env var)`);
    }
  }
}

export async function startStdioMcpServer(): Promise<void> {
  const server = createMcpServer(ADMIN_TENANT_ID);
  const transport = new StdioServerTransport();
  console.log("[mcp-server] Starting MCP server on stdio transport...");
  await server.connect(transport);
}

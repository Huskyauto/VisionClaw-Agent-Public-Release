/**
 * VCA MCP Server — R113.7 Round C.
 *
 * Exposes a curated 8-tool surface to external MCP clients (Claude Desktop,
 * Cursor, custom agents) over the Streamable HTTP transport. This is the
 * complement to server/routes/mcp.ts (which is the MCP CLIENT — VCA calling
 * out to other MCP servers as tools).
 *
 * Architecture:
 *   - Auth: per-tenant API keys (see server/lib/mcp-api-keys.ts).
 *     `Authorization: Bearer mcp_<prefix>_<secret>`. TenantId is RESOLVED
 *     from the key — never trusted from a client header. A stolen key
 *     only sees that tenant's data.
 *   - Tool surface: 3 scheduler tools + 5 read-only tools. Each tool is
 *     implemented as a direct call into the underlying lib (NOT through
 *     the chat-tool dispatcher) so the persona/intent-gate layer is
 *     bypassed cleanly — the MCP gate IS the auth boundary.
 *   - Transport: per-request stateless instance. No long-lived sessions;
 *     each POST /mcp creates a fresh transport+server, handles the JSON-RPC
 *     batch, and tears down. Matches MCP SDK 1.29 streamable-HTTP guidance.
 *
 * Surface (8 tools):
 *   schedule_cross_platform_post     destructive (gated by key existence + scope)
 *   cancel_scheduled_post            sensitive
 *   list_scheduled_posts             safe
 *   get_scheduled_post               safe
 *   list_personas                    safe (global; no tenant filter)
 *   lookup_output_skill              safe
 *   list_output_skills               safe
 *   get_platform_info                safe (static)
 */
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  scheduleCrossPlatformPost,
  cancelScheduledPost,
  listScheduledPosts,
  getSupportedPlatforms,
} from "../lib/scheduled-post-runner";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
  type VerifiedKey,
} from "../lib/mcp-api-keys";
import { lookupOutputSkill, listOutputSkills } from "../lib/output-skills";
import { validate, mcpKeyCreateSchema, emptyBodySchema } from "../validation";

// ──────────────────────────────────────────────────────────────────────────
// Tool registration (one place; mirrored by the tests as the source of truth).
// ──────────────────────────────────────────────────────────────────────────
export const MCP_TOOL_NAMES = [
  "schedule_cross_platform_post",
  "cancel_scheduled_post",
  "list_scheduled_posts",
  "get_scheduled_post",
  "list_personas",
  "lookup_output_skill",
  "list_output_skills",
  "get_platform_info",
  // R116 — agentmemory N9. Memory MCP surface (4 tools, 2 scopes).
  "memory_smart_search",
  "memory_save",
  "memory_supersede",
  "memory_list_recent",
] as const;
export type McpToolName = typeof MCP_TOOL_NAMES[number];

/**
 * Scope contract for the MCP surface.
 *
 *   scheduler:write   → schedule + cancel posts (DESTRUCTIVE / SENSITIVE)
 *   scheduler:read    → list + get scheduled posts (READ-ONLY)
 *   catalog:read      → personas, output-skills, platform info (READ-ONLY)
 *   *                 → superscope, grants all of the above
 *
 * Fail-CLOSED: a key with NO scopes (or scopes that don't cover the
 * tool) is rejected at the tool-call boundary. Architect R113.7 HIGH-1.
 */
export const MCP_SCOPES = {
  "scheduler:write": "Schedule and cancel cross-platform social posts",
  "scheduler:read": "List and inspect scheduled posts",
  "catalog:read": "Browse VCA personas, output skills, and platform info",
  // R116 — agentmemory N9. Separate read/write so a 3rd-party tool can
  // recall memories without being able to mutate or supersede them.
  "memory:read": "Search and read memory entries for the calling tenant",
  "memory:write": "Save new memory facts and supersede existing ones",
} as const;
export type McpScope = keyof typeof MCP_SCOPES;

export const TOOL_SCOPE_REQUIREMENTS: Record<McpToolName, McpScope> = {
  schedule_cross_platform_post: "scheduler:write",
  cancel_scheduled_post: "scheduler:write",
  list_scheduled_posts: "scheduler:read",
  get_scheduled_post: "scheduler:read",
  list_personas: "catalog:read",
  lookup_output_skill: "catalog:read",
  list_output_skills: "catalog:read",
  get_platform_info: "catalog:read",
  // R116 — agentmemory N9
  memory_smart_search: "memory:read",
  memory_list_recent: "memory:read",
  memory_save: "memory:write",
  memory_supersede: "memory:write",
};

export function hasScope(grantedScopes: string[], required: McpScope): boolean {
  if (!Array.isArray(grantedScopes) || grantedScopes.length === 0) return false;
  if (grantedScopes.includes("*")) return true;
  return grantedScopes.includes(required);
}

function denyForScope(tool: McpToolName, required: McpScope, granted: string[]) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            error: `scope_denied: tool '${tool}' requires scope '${required}', but this key has only [${granted.join(", ") || "none"}]. Mint a new key with the required scope from /mcp-keys.`,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

function buildMcpServer(auth: VerifiedKey): McpServer {
  const server = new McpServer(
    { name: "visionclaw", version: "R113.7" },
    { capabilities: { tools: {} } },
  );

  // ── schedule_cross_platform_post ────────────────────────────────────────
  server.registerTool(
    "schedule_cross_platform_post",
    {
      title: "Schedule cross-platform social post",
      description:
        "Schedule the SAME content to fan out to one or more social platforms at a future time. Supported: x, linkedin, instagram, facebook, threads, pinterest, youtube. YouTube requires a videoUrl (https). Pinterest + Instagram require an imageUrl. Destructive — publishes public content from the tenant's connected accounts.",
      inputSchema: {
        platforms: z.array(z.enum(["x", "linkedin", "instagram", "facebook", "threads", "pinterest", "youtube"])).min(1),
        content: z.string().min(1).max(10_000),
        scheduledFor: z.string().describe("ISO-8601 timestamp"),
        imageUrl: z.string().optional(),
        videoUrl: z.string().optional().describe("REQUIRED when platforms includes 'youtube'"),
        campaign: z.string().optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.schedule_cross_platform_post)) {
        return denyForScope("schedule_cross_platform_post", "scheduler:write", auth.scopes);
      }
      const r = await scheduleCrossPlatformPost({
        tenantId: auth.tenantId,
        platforms: args.platforms as string[],
        content: args.content,
        scheduledFor: args.scheduledFor,
        imageUrl: args.imageUrl,
        videoUrl: args.videoUrl,
        campaign: args.campaign,
        createdBy: `mcp:key=${auth.keyId}`,
      });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── cancel_scheduled_post ───────────────────────────────────────────────
  server.registerTool(
    "cancel_scheduled_post",
    {
      title: "Cancel a pending scheduled post",
      description: "Cancel a pending scheduled cross-platform post by id. Only works while status='pending'.",
      inputSchema: { id: z.number().int().positive() },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.cancel_scheduled_post)) {
        return denyForScope("cancel_scheduled_post", "scheduler:write", auth.scopes);
      }
      const r = await cancelScheduledPost(args.id, auth.tenantId);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── list_scheduled_posts ────────────────────────────────────────────────
  server.registerTool(
    "list_scheduled_posts",
    {
      title: "List scheduled posts",
      description: "List this tenant's scheduled cross-platform posts (most recent 50 by default). Read-only.",
      inputSchema: {
        status: z.enum(["pending", "publishing", "sent", "partial", "failed", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.list_scheduled_posts)) {
        return denyForScope("list_scheduled_posts", "scheduler:read", auth.scopes);
      }
      const r = await listScheduledPosts({ tenantId: auth.tenantId, status: args.status, limit: args.limit });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── get_scheduled_post ──────────────────────────────────────────────────
  server.registerTool(
    "get_scheduled_post",
    {
      title: "Get a scheduled post by id",
      description: "Fetch one scheduled post by id (tenant-scoped). Read-only.",
      inputSchema: { id: z.number().int().positive() },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.get_scheduled_post)) {
        return denyForScope("get_scheduled_post", "scheduler:read", auth.scopes);
      }
      const r = await db.execute(sql`
        SELECT id, tenant_id, platforms, content, image_url, video_url, scheduled_for,
               status, attempts, max_attempts, last_error, per_platform_results,
               campaign, created_by, next_attempt_at, created_at, updated_at
          FROM scheduled_posts
         WHERE id = ${args.id} AND tenant_id = ${auth.tenantId}
         LIMIT 1
      `);
      const row = ((r as any).rows || r)[0];
      if (!row) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "not found" }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, post: row }, null, 2) }] };
    },
  );

  // ── list_personas ───────────────────────────────────────────────────────
  server.registerTool(
    "list_personas",
    {
      title: "List VCA personas",
      description: "List the 16 platform personas (name, role, department). Read-only, platform-global.",
      inputSchema: {},
    },
    async () => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.list_personas)) {
        return denyForScope("list_personas", "catalog:read", auth.scopes);
      }
      const r = await db.execute(sql`
        SELECT id, name, role, department
          FROM personas
         WHERE active = TRUE
         ORDER BY id ASC
      `);
      const rows = (r as any).rows || r;
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, personas: rows }, null, 2) }] };
    },
  );

  // ── lookup_output_skill ─────────────────────────────────────────────────
  server.registerTool(
    "lookup_output_skill",
    {
      title: "Lookup an output-skill scaffolding template",
      description:
        "Two modes: pass `topic` to get the markdown scaffolding for a deliverable (PRD, OKR, contract review, etc.), OR pass `department` or `persona` to list available topics in that scope. Read-only.",
      inputSchema: {
        topic: z.string().optional(),
        department: z.string().optional(),
        persona: z.string().optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.lookup_output_skill)) {
        return denyForScope("lookup_output_skill", "catalog:read", auth.scopes);
      }
      const topicCount = args.topic ? 1 : 0;
      const filterCount = (args.department ? 1 : 0) + (args.persona ? 1 : 0);
      if (topicCount === 0 && filterCount === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "pass either topic OR department/persona (XOR)" }, null, 2) }] };
      }
      if (topicCount > 0 && filterCount > 0) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "topic and department/persona are mutually exclusive" }, null, 2) }] };
      }
      if (args.topic) {
        const r = await lookupOutputSkill(args.topic);
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }
      const r = listOutputSkills({ department: args.department, persona: args.persona });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── list_output_skills ──────────────────────────────────────────────────
  server.registerTool(
    "list_output_skills",
    {
      title: "List all output-skill topics",
      description: "Return the full output-skill catalog (25 templates across 8 departments). Read-only.",
      inputSchema: {},
    },
    async () => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.list_output_skills)) {
        return denyForScope("list_output_skills", "catalog:read", auth.scopes);
      }
      const r = listOutputSkills({});
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── get_platform_info ───────────────────────────────────────────────────
  server.registerTool(
    "get_platform_info",
    {
      title: "Get VCA platform info",
      description: "Return VCA platform metadata: version, MCP tool surface, supported social platforms. Read-only, static.",
      inputSchema: {},
    },
    async () => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.get_platform_info)) {
        return denyForScope("get_platform_info", "catalog:read", auth.scopes);
      }
      const info = {
        ok: true,
        platform: "VisionClaw",
        version: "R113.7",
        mcpProtocolRound: "C",
        mcpTools: MCP_TOOL_NAMES,
        supportedSocialPlatforms: getSupportedPlatforms(),
        videoRequiredPlatforms: ["youtube"],
        availableScopes: Object.keys(MCP_SCOPES),
      };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    },
  );

  // ── memory_smart_search ─────────────────────────────────────────────────
  // R116 — agentmemory N9. Hybrid BM25+Vector+RRF retrieval over memory_entries,
  // tenant-scoped (always). Routes through the existing vectorSearchMemory
  // helper which already implements the R98.27 hybrid ranker.
  server.registerTool(
    "memory_smart_search",
    {
      title: "Smart-search memory entries (BM25 + vector + RRF)",
      description:
        "Hybrid retrieval over memory_entries for the calling tenant. Returns up to topK matches ranked by similarity + importance + recency + frequency, scaled by confidence × quality_score. Read-only.",
      inputSchema: {
        query: z.string().min(1).max(2000),
        topK: z.number().int().min(1).max(50).optional(),
        wing: z.string().optional(),
        room: z.string().optional(),
        personaId: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.memory_smart_search)) {
        return denyForScope("memory_smart_search", "memory:read", auth.scopes);
      }
      try {
        const { vectorSearchMemory } = await import("../embeddings");
        const results = await vectorSearchMemory(args.query, {
          tenantId: auth.tenantId,
          personaId: args.personaId,
          topK: args.topK ?? 10,
          wing: args.wing,
          room: args.room,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: results.length, results }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2) }] };
      }
    },
  );

  // ── memory_save ─────────────────────────────────────────────────────────
  // R116 — agentmemory N9. Route through the debounced memory-queue so
  // dedup + quality-score gating + auto-link-creation all run.
  server.registerTool(
    "memory_save",
    {
      title: "Save a memory fact (debounced + quality-graded)",
      description:
        "Enqueue a new memory fact for the calling tenant. Goes through the same dedup + heuristic quality_score pipeline as internal captures; rows with quality_score < threshold are flagged for review but still stored.",
      inputSchema: {
        fact: z.string().min(3).max(4000),
        category: z.string().min(1).max(80).optional(),
        source: z.string().min(1).max(80).optional(),
        confidence: z.number().min(0).max(1).optional(),
        confidenceSource: z.string().max(120).optional(),
        personaId: z.number().int().positive().optional(),
        wing: z.string().optional(),
        room: z.string().optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.memory_save)) {
        return denyForScope("memory_save", "memory:write", auth.scopes);
      }
      try {
        const { enqueueMemoryFact } = await import("../lib/memory-queue");
        const r = enqueueMemoryFact({
          tenantId: auth.tenantId,
          personaId: args.personaId ?? null,
          fact: args.fact,
          category: args.category || "preference",
          source: args.source || "mcp",
          confidence: typeof args.confidence === "number" ? args.confidence : 0.85,
          confidenceSource: args.confidenceSource || `mcp:key=${auth.keyId}`,
          wing: args.wing ?? null,
          room: args.room ?? null,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ok: r.ok !== false, result: r }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2) }] };
      }
    },
  );

  // ── memory_supersede ────────────────────────────────────────────────────
  // R116 — agentmemory N9. Mark an existing memory entry as superseded by a
  // new fact. Tenant-scoped: cannot supersede another tenant's row.
  server.registerTool(
    "memory_supersede",
    {
      title: "Supersede an existing memory entry with a new fact",
      description:
        "Phantom-stage supersession: mark memory entry `oldId` as superseded by a new fact (which is enqueued via the same quality-gated pipeline as memory_save). Both rows must belong to the calling tenant.",
      inputSchema: {
        oldId: z.number().int().positive(),
        newFact: z.string().min(3).max(4000),
        reason: z.string().max(400).optional(),
        category: z.string().min(1).max(80).optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.memory_supersede)) {
        return denyForScope("memory_supersede", "memory:write", auth.scopes);
      }
      try {
        // 1) verify the old row belongs to this tenant — fail-CLOSED on miss
        const ownerRows = await db.execute(sql`
          SELECT id, category, persona_id FROM memory_entries
           WHERE id = ${args.oldId} AND tenant_id = ${auth.tenantId} AND status = 'active'
           LIMIT 1
        `);
        const owner = ((ownerRows as any).rows || ownerRows)[0];
        if (!owner) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "old memory not found, not active, or not owned by tenant" }, null, 2) }] };
        }

        // 2) enqueue the replacement (gets quality-graded + dedup). MUST succeed
        //    BEFORE we flip the old row — else we orphan the old fact without a
        //    replacement (R116 architect finding: data-integrity bug).
        const { enqueueMemoryFact } = await import("../lib/memory-queue");
        const enq = enqueueMemoryFact({
          tenantId: auth.tenantId,
          personaId: owner.persona_id ?? null,
          fact: args.newFact,
          category: args.category || owner.category || "preference",
          source: "mcp_supersede",
          confidence: typeof args.confidence === "number" ? args.confidence : 0.9,
          confidenceSource: `mcp:key=${auth.keyId} supersedes=${args.oldId}` + (args.reason ? ` reason=${args.reason.slice(0, 120)}` : ""),
        });
        if (!enq || enq.ok === false) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "replacement enqueue rejected; old row left active", enqueue: enq }, null, 2) }] };
        }

        // 3) mark the old row superseded (status='superseded') — we set succeeded_by_id
        //    later once the queue flushes; for now the status flip is the contract.
        await db.execute(sql`
          UPDATE memory_entries
             SET status = 'superseded'
           WHERE id = ${args.oldId} AND tenant_id = ${auth.tenantId}
        `);

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, supersededId: args.oldId, newFactEnqueued: true, enqueue: enq }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2) }] };
      }
    },
  );

  // ── memory_list_recent ──────────────────────────────────────────────────
  // R116 — agentmemory N9. Read-only listing of the calling tenant's most
  // recently reinforced memory rows, for dashboard / inspection use.
  server.registerTool(
    "memory_list_recent",
    {
      title: "List recently reinforced memory entries",
      description:
        "List the calling tenant's most-recently-reinforced active memory entries (default 25, max 100). Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        category: z.string().min(1).max(80).optional(),
        personaId: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      if (!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.memory_list_recent)) {
        return denyForScope("memory_list_recent", "memory:read", auth.scopes);
      }
      try {
        const lim = args.limit ?? 25;
        const categoryFilter = args.category ? sql`AND category = ${args.category}` : sql``;
        const personaFilter = typeof args.personaId === "number" ? sql`AND persona_id = ${args.personaId}` : sql``;
        const rows = await db.execute(sql`
          SELECT id, fact, category, persona_id, last_reinforced_at, last_accessed,
                 access_count, confidence, quality_score, status, source
            FROM memory_entries
           WHERE tenant_id = ${auth.tenantId}
             AND status = 'active'
             AND deleted_at IS NULL
             ${categoryFilter}
             ${personaFilter}
           ORDER BY last_reinforced_at DESC
           LIMIT ${lim}
        `);
        const out = (rows as any).rows || rows;
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: out.length, rows: out }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2) }] };
      }
    },
  );

  return server;
}

// ──────────────────────────────────────────────────────────────────────────
// Express mount.
// ──────────────────────────────────────────────────────────────────────────
type AdminHelpers = {
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerMcpServerRoutes(app: Express, helpers: AdminHelpers) {
  const { requirePlatformAdmin, getTenantFromRequest } = helpers;

  // ── Health (unauthenticated) ────────────────────────────────────────────
  app.get("/mcp/health", (_req, res) => {
    res.json({
      ok: true,
      protocol: "mcp",
      transport: "streamable-http",
      version: "R113.7",
      tools: MCP_TOOL_NAMES.length,
    });
  });

  // ── MCP JSON-RPC endpoint (bearer auth) ─────────────────────────────────
  app.post("/mcp", async (req, res) => {
    // Auth.
    const authHeader = String(req.headers.authorization || "");
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Missing Bearer token. Provide Authorization: Bearer mcp_<prefix>_<secret>." } });
      return;
    }
    const verified = await verifyApiKey(m[1]);
    if (!verified) {
      res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Invalid or revoked MCP API key." } });
      return;
    }

    // Per-request transport + server. Stateless mode (sessionIdGenerator
    // undefined) — fits MCP SDK 1.29 streamable-HTTP guidance.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildMcpServer(verified);

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error("[mcp-server] handleRequest error:", err?.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `Internal MCP error: ${err?.message || "unknown"}` } });
      }
    }
  });

  /**
   * Architect R113.7 MED-2 — reject `vc_*` API-key bearer auth on the
   * meta-API for managing MCP keys. The MCP-key CRUD must require a
   * genuine browser session (or Replit OIDC). Otherwise a leaked vc_
   * key could spawn unlimited MCP keys for the same tenant.
   */
  function requireSessionAuth(req: Request, res: Response): { tenantId: number } | null {
    const authHeader = String(req.headers.authorization || "");
    if (/^Bearer\s+vc_/i.test(authHeader)) {
      res.status(403).json({
        ok: false,
        error: "MCP key management requires session auth (browser cookie or Replit OIDC). vc_* API keys are not accepted on this endpoint.",
      });
      return null;
    }
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) {
      res.status(401).json({ ok: false, error: "Authentication required" });
      return null;
    }
    return { tenantId };
  }

  // ── API key management (session-authenticated, tenant-scoped) ───────────
  // R115 +sec — Zod input validation on mutating MCP routes. Scope semantics
  // (vs MCP_SCOPES registry) are still enforced AFTER the shape check below.
  app.post("/api/mcp-keys", validate(mcpKeyCreateSchema), async (req, res) => {
    const ctx = requireSessionAuth(req, res);
    if (!ctx) return;
    const name = String(req.body.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "name required" });
      return;
    }
    const rawScopes: string[] = Array.isArray(req.body.scopes) ? req.body.scopes.map(String) : [];
    // Validate scopes against the registry — reject unknown scopes early.
    const validScopes = new Set(Object.keys(MCP_SCOPES));
    const unknown = rawScopes.filter((s: string) => s !== "*" && !validScopes.has(s));
    if (unknown.length > 0) {
      res.status(400).json({
        ok: false,
        error: `Unknown scope(s): ${unknown.join(", ")}. Valid scopes: ${Array.from(validScopes).join(", ")} (or '*').`,
      });
      return;
    }
    // Fail-CLOSED default: if no scopes are specified, the key gets `catalog:read`
    // only — never the destructive `scheduler:write` by accident.
    const scopes = rawScopes.length > 0 ? rawScopes : ["catalog:read"];
    const result = await createApiKey({
      tenantId: ctx.tenantId,
      name,
      scopes,
      createdBy: String((req as any).session?.userEmail || (req as any).session?.tenantEmail || "ui"),
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    // Plaintext is shown EXACTLY ONCE — caller must copy it now.
    res.json({
      ok: true,
      key: result.key,
      warning: "Save this plaintext key now — it will NOT be shown again. Pass it as `Authorization: Bearer <plaintext>` from your MCP client.",
    });
  });

  app.get("/api/mcp-keys", async (req, res) => {
    const ctx = requireSessionAuth(req, res);
    if (!ctx) return;
    const keys = await listApiKeys(ctx.tenantId);
    res.json({ ok: true, keys, availableScopes: MCP_SCOPES });
  });

  app.delete("/api/mcp-keys/:id", validate(emptyBodySchema), async (req, res) => {
    const ctx = requireSessionAuth(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "valid id required" });
      return;
    }
    const result = await revokeApiKey(id, ctx.tenantId);
    res.json(result);
  });

  // Quiet linter — accept the unused helper.
  void requirePlatformAdmin;
}

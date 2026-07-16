/**
 * Public API v1 — the external-developer surface for VisionClaw.
 *
 * Designed for AI coding agents (Claude Code, Cursor, Gemini CLI, Codex)
 * to delegate work to the hosted 16-agent corporation via a stable contract.
 *
 * Auth: Bearer `vc_*` API key issued at /settings/api-keys (admin-only issuance).
 * Scopes: `chat` for dispatch, `read` for listing/polling. `chat` keys may also
 * read their own conversations (so a chat-only key can poll its own dispatches).
 *
 * Discovery (`GET /api/v1`) is intentionally public — agents need to crawl the
 * contract before they have a key (same model as Stripe/OpenAI public docs).
 *
 * Contract documented in `claude-skill/visionclaw/SKILL.md` — keep them in sync.
 *
 * R63.4 (Apr 21, 2026) — Hyperframes Nugget 1 ship: distribution surface
 * for the Claude Code skill ecosystem.
 * R63.4.1 — hardening pass: vc_-only enforcement, zod validation, sanitized
 * errors, clean timer cleanup. (Per architect review.)
 */
import type { Express, Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { processMessage } from "../chat-engine";
import wellnessTemplates from "../templates/wellness-video-templates.json";

// Rate limiter for the public Agent Card discovery endpoint. The route
// is unauthenticated and hits the DB (active personas SELECT), so we cap
// at 60/min/IP to prevent unauth DB hammering. Architect-recommended
// hardening (R78). Aligned with the public-chat config-fetch limiter.
const agentCardLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded for /.well-known/agent.json — try again in a minute." },
});

// RFC 9116 security.txt limiter — same posture as the agent card (public,
// metadata-only, cheap to crawl). Keeps the disclosure surface bounded.
const securityTxtLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
  standardHeaders: true,
  legacyHeaders: false,
  message: "Rate limit exceeded for /.well-known/security.txt — try again in a minute.",
});

// Trusted-host allowlist for baseUrl construction in the Agent Card.
// X-Forwarded-Host is honored only if it matches one of these. Defense
// against cache-poisoning the Agent Card with attacker-controlled URLs.
function isAllowedHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().trim();
  // Always allow localhost for dev.
  if (h === "localhost:5000" || h === "localhost" || h.startsWith("127.0.0.1") || h.startsWith("0.0.0.0")) return true;
  const envDomains = (process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (envDomains.includes(h)) return true;
  // Replit hosts: strict single-label subdomain of the Replit zones.
  // Tightened (post code-review): the prior `/\.(replit\.app|...)$/` form
  // also accepted `evil.middle.replit.app` and any multi-level subdomain
  // (theoretical cache-poisoning fan-out). Now requires exactly one
  // single-label subdomain like `visionclaw.replit.app`.
  if (/^[a-z0-9][a-z0-9-]{0,62}\.(replit\.app|replit\.dev|repl\.co)$/.test(h)) return true;
  return false;
}

type ApiV1Helpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

const ROUTING_HINTS: Record<string, string> = {
  felix: "Multi-step decomposition, plan-of-record, executive synthesis",
  minerva: "Decision-theory analysis, plan drafting for Felix approval",
  forge: "Engineering — code review, infra, security analysis",
  neptune: "Deep research — overnight autonomous research, multimedia deep dives",
  radar: "Intelligence — market/competitor analysis, OSINT, trend tracking",
  cassandra: "CFO — budgets, forecasting, P&L modeling, financial analysis",
  luna: "Legal — contract review, compliance, regulatory risk",
  atlas: "Metrics — analytics, dashboards, KPI tracking",
  apollo: "Sales — outreach, lead qualification, pipeline ops",
  scribe: "Long-form writing — SEO content, documentation, blog posts",
  proof: "QA — proofreading, fact-checking, accuracy scoring",
  teagan: "Marketing — social calendars, brand voice, ad copy",
  "agent blueprint": "Capability expansion — new skill creation, tool learning",
  "chief of staff": "Operations director — system health, daily routing",
  robert: "[Your Product] wellness-coaching coach (CBT/DBT/ACT/IPT framing)",
  visionclaw: "Default conversational agent for general tasks",
};

// Hard caps — protect cost & DB row size
const MAX_TASK_LEN = 16_000;        // ~4k tokens — plenty for one prompt
const MAX_TITLE_LEN = 200;
const MAX_MODEL_LEN = 100;
const MAX_AGENT_LEN = 100;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 180_000;
const DEFAULT_TIMEOUT_MS = 60_000;

// Video caps — video generation has real $ cost (TTS + image gen + render).
// External callers must stay inside these to keep the bill predictable.
const MAX_VIDEO_SCENES = 8;
const MAX_NARRATION_CHARS = 600; // ~30s at 150wpm per scene
const MAX_IMAGE_PROMPT_CHARS = 500;
const ALLOWED_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const; // 4k blocked on public API
const ALLOWED_VOICE_PROVIDERS = ["openai", "elevenlabs"] as const;

// Cost model (rough — for pre-flight estimate, not billing). Update if pricing shifts.
// Per-scene cost = TTS narration + image gen + render compute (negligible).
function estimateVideoCostUsd(scenes: { narration?: string; imagePrompt?: string; imagePath?: string }[], voiceProvider: string): number {
  let total = 0;
  for (const s of scenes) {
    // TTS: ElevenLabs ~$0.18/1k chars, OpenAI ~$0.015/1k chars
    const chars = (s.narration || "").length;
    const ttsRate = voiceProvider === "elevenlabs" ? 0.00018 : 0.000015;
    total += chars * ttsRate;
    // Image: Gemini free tier preferred; if it falls back to DALL-E count $0.04
    if (s.imagePrompt && !s.imagePath) total += 0.04;
  }
  // Render compute (FFmpeg in-process) — call it $0.005/scene flat
  total += scenes.length * 0.005;
  return Math.round(total * 1000) / 1000; // round to 3dp
}

const aguiRunSchema = z.object({
  threadId: z.string().trim().max(64).optional(),
  runId: z.string().trim().max(64).regex(/^[a-zA-Z0-9_.:-]*$/, "invalid runId").optional(),
  messages: z
    .array(z.object({ role: z.string().trim().max(32), content: z.string().max(MAX_TASK_LEN) }).passthrough())
    .max(50)
    .optional(),
  task: z.string().trim().max(MAX_TASK_LEN).optional(),
  agent: z.string().trim().max(MAX_AGENT_LEN).optional(),
  personaId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  model: z.string().trim().max(MAX_MODEL_LEN).regex(/^[a-zA-Z0-9_./-]+$/, "invalid model identifier").optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
});

const dispatchSchema = z.object({
  task: z.string().trim().min(1, "task must be non-empty").max(MAX_TASK_LEN, `task exceeds ${MAX_TASK_LEN} chars`),
  agent: z.string().trim().max(MAX_AGENT_LEN).optional(),
  personaId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  async: z.boolean().optional(),
  title: z.string().trim().max(MAX_TITLE_LEN).optional(),
  model: z.string().trim().max(MAX_MODEL_LEN).regex(/^[a-zA-Z0-9_./-]+$/, "invalid model identifier").optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
});

/**
 * Hard requirement: /api/v1/* must be authenticated by `vc_*` API key only,
 * never by session cookie or Replit-Auth header. This stops a logged-in
 * dashboard user from accidentally being interpreted as an external API call
 * (and vice versa) and ensures every public-API request has explicit scopes.
 */
function requireApiKeyOnly(req: Request, res: Response, next: NextFunction) {
  const scopes: string[] | undefined = (req as any).apiKeyScopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(401).json({
      error: "Public API requires a `vc_*` Bearer token. Obtain one at /settings/api-keys.",
    });
  }
  return next();
}

/** Generic public-error helper — never leaks internal messages. */
function publicError(res: Response, status: number, code: string, requestId: string) {
  return res.status(status).json({ error: code, requestId });
}

function newRequestId() {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function registerApiV1Routes(app: Express, helpers: ApiV1Helpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  // ─────────────────────────────────────────────────────────────────────
  // Discovery — PUBLIC by design. Agents need to crawl this before having
  // a key (same model as Stripe/OpenAI public docs). No tenant data here.
  // ─────────────────────────────────────────────────────────────────────
  app.get("/api/v1", async (_req: Request, res: Response) => {
    res.json({
      name: "VisionClaw Public API v1",
      version: "1.0.0",
      docs: "https://github.com/Huskyauto/VisionClaw-Agent-Public-Release/blob/main/claude-skill/visionclaw/SKILL.md",
      auth: {
        scheme: "Bearer",
        keyPrefix: "vc_",
        obtainAt: "/settings/api-keys",
        note: "Discovery is public; all other endpoints require a vc_* key.",
      },
      endpoints: {
        "GET /api/v1": "This discovery document (public)",
        "GET /api/v1/agents": "List available agents/personas (scope: read or chat)",
        "POST /api/v1/agents/dispatch": "Dispatch a task to an agent (scope: chat)",
        "POST /api/v1/agui/run": "Run an agent turn as an AG-UI protocol SSE stream for third-party frontends (scope: chat)",
        "GET /api/v1/conversations/:id": "Poll a conversation for the latest reply (scope: read or chat)",
        "GET /api/v1/video/templates": "List wellness / [Your Product] video templates (scope: read or chat)",
        "POST /api/v1/agents/produce-video": "Render a video from a template or custom scenes (scope: chat)",
      },
      limits: {
        maxTaskLength: MAX_TASK_LEN,
        maxTimeoutMs: MAX_TIMEOUT_MS,
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        video: {
          maxScenes: MAX_VIDEO_SCENES,
          maxResolution: "1080p",
          maxNarrationCharsPerScene: MAX_NARRATION_CHARS,
          defaultVoice: "openai/onyx (cheap); set voiceProvider:'elevenlabs' for premium",
        },
      },
      scopes: {
        chat: "Send messages and dispatch tasks; may also read own conversations",
        read: "List agents and poll conversations",
        tools: "Invoke tools directly (browser, research, etc.)",
        admin: "Full access including key management",
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /.well-known/agent.json — A2A v0.3 Agent Card (Linux Foundation
  // Agent2Agent protocol). PUBLIC by design. Standard discovery surface
  // any A2A-compliant peer crawls before initiating contact. Translates
  // our /api/v1 contract into the Agent Card shape so we are auto-
  // discoverable without a bespoke integration. No tenant data here.
  // R78 — shipped after analysis of "Agentic RAG vs CUA vs A2A"
  // (Paolo Perrone, May 2026). Existing vc_* bearer auth is preserved
  // on every dispatch route — this endpoint is metadata only.
  //
  // Personas-as-skills note (R79.3b architect review): the persona roster
  // emitted here is the canonical platform-global set (personas table has
  // NO tenant_id column — see shared/schema.ts:51). Same 16 personas for
  // every tenant by schema. Per-tenant display-name overrides live in
  // tenant_persona_names and are intentionally NOT applied here — public
  // discovery shows canonical names so external A2A peers reference one
  // stable identifier set. Authenticated tenant-scoped views (/api/v1/agents,
  // GET /api/personas) DO apply the tenant displayName override.
  // ─────────────────────────────────────────────────────────────────────
  // GET /.well-known/security.txt — RFC 9116 vulnerability-disclosure surface.
  // PUBLIC by design. Expires is computed dynamically (~1y out) so it never
  // goes stale and trip security.txt validators. Points at the public SECURITY.md.
  app.get("/.well-known/security.txt", securityTxtLimiter, (_req: Request, res: Response) => {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const body = [
      "Contact: mailto:huskyauto@gmail.com",
      `Expires: ${expires}`,
      "Preferred-Languages: en",
      "Policy: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release/blob/main/SECURITY.md",
      "Canonical: https://agenticcorporation.net/.well-known/security.txt",
      "",
    ].join("\n");
    res.type("text/plain").send(body);
  });

  app.get("/.well-known/agent.json", agentCardLimiter, async (req: Request, res: Response) => {
    const requestId = newRequestId();
    try {
      const xfProto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim();
      const xfHost = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim();
      const rawHost = (xfHost || req.get("host") || "").toLowerCase();
      // Defense-in-depth: only trust the host if it's in our allowlist.
      // Otherwise fall back to relative URLs so an attacker can't poison the
      // Agent Card response (which is cached for 5min) with a hostile URL.
      const host = isAllowedHost(rawHost) ? rawHost : "";
      const proto = xfProto || req.protocol || "https";
      const baseUrl = host ? `${proto}://${host}` : "";

      // Pull active personas → A2A skills. Fail-soft: empty array if DB hiccups.
      let skills: any[] = [];
      try {
        const result: any = await db.execute(sql`
          SELECT id, name, role, catchphrase
          FROM personas
          WHERE is_active = true
          ORDER BY id ASC
        `);
        const rows = (result.rows || result) as any[];
        skills = rows.map((p) => {
          const slug = String(p.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `persona-${p.id}`;
          return {
            id: slug,
            name: p.name,
            description: p.role || p.catchphrase || `${p.name} persona`,
            tags: ["persona", slug],
            inputModes: ["text/plain", "application/json"],
            outputModes: ["text/plain", "application/json"],
          };
        });
      } catch (err: any) {
        console.warn(`[api-v1] [${requestId}] agent.json: failed to enumerate personas:`, err?.message || err);
      }

      // Top-level capability skills (transport-of-work entry points)
      const platformSkills = [
        {
          id: "agent-dispatch",
          name: "Agent Dispatch",
          description: "Route a task to a named persona (or auto-route by content) and receive the synthesized result. Supports sync (default) and async polling modes.",
          tags: ["dispatch", "orchestration", "multi-agent"],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"],
        },
        {
          id: "video-production",
          name: "Video Production",
          description: "Render branded videos from JSON scene templates (TTS narration via OpenAI/ElevenLabs + image gen + FFmpeg compositing). Cost pre-flight returned before render.",
          tags: ["video", "render", "tts"],
          inputModes: ["application/json"],
          outputModes: ["video/mp4", "application/json"],
        },
      ];

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        // A2A v0.3 Agent Card spec — https://a2aproject.github.io/A2A/v0.3.0/specification/
        protocolVersion: "0.3.0",
        name: "VisionClaw Agent",
        description: "Multi-tenant agentic AI platform — 16 specialist personas (Felix/Minerva/Forge/Cassandra/Atlas/Luna/Apollo/Scribe/Proof/Teagan/Neptune/Radar/Robert/Agent Blueprint/Chief of Staff/VisionClaw), 266 tools, 62 skills, full GraphRAG memory, supervisor verification rail with deliverable contracts, and HITL trust-tier policy engine.",
        url: baseUrl ? `${baseUrl}/api/v1` : "/api/v1",
        provider: {
          organization: "[Your Company]",
          url: "https://github.com/Huskyauto/VisionClaw-Agent-Public-Release",
        },
        version: "1.0.0",
        documentationUrl: "https://github.com/Huskyauto/VisionClaw-Agent-Public-Release/blob/main/claude-skill/visionclaw/SKILL.md",
        defaultInputModes: ["text/plain", "application/json"],
        defaultOutputModes: ["text/plain", "application/json"],
        capabilities: {
          streaming: true,             // SSE supported on conversation poll
          pushNotifications: false,    // No async webhook callbacks yet
          stateTransitionHistory: true,
        },
        securitySchemes: {
          bearer: {
            type: "http",
            scheme: "bearer",
            description: "VisionClaw API key (vc_*) issued at /settings/api-keys. Required scopes: `chat` for dispatch, `read` for listing/polling.",
          },
        },
        security: [{ bearer: ["chat", "read"] }],
        skills: [...platformSkills, ...skills],
        // VisionClaw-specific extension — non-spec but useful for callers that
        // already speak our /api/v1 dialect. Honors A2A's opacity principle:
        // we expose what we do, not how we do it (no internal tool list, no
        // memory shape, no model routing).
        "x-visionclaw": {
          discoveryDoc: baseUrl ? `${baseUrl}/api/v1` : "/api/v1",
          agentsList: baseUrl ? `${baseUrl}/api/v1/agents` : "/api/v1/agents",
          dispatchEndpoint: baseUrl ? `${baseUrl}/api/v1/agents/dispatch` : "/api/v1/agents/dispatch",
          skillManifest: "https://github.com/Huskyauto/VisionClaw-Agent-Public-Release/blob/main/claude-skill/visionclaw/SKILL.md",
          mcpServer: baseUrl ? `${baseUrl}/api/mcp/sse` : "/api/mcp/sse",
        },
      });
    } catch (err: any) {
      console.error(`[api-v1] [${requestId}] agent.json error:`, err?.message || err);
      publicError(res, 500, "Failed to build Agent Card", requestId);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/v1/agents — agent discovery for external routing
  // ─────────────────────────────────────────────────────────────────────
  app.get("/api/v1/agents", authMiddleware, requireApiKeyOnly, async (req: Request, res: Response) => {
    const requestId = newRequestId();
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return publicError(res, 401, "Authentication required", requestId);
    try {
      // Personas are platform-global by schema (no tenant_id column on
      // personas), but each tenant can rebrand any persona via
      // tenant_persona_names.displayName (e.g., one tenant calls Felix "CEO Bot",
      // another keeps "Felix"). Honor that override here so external API
      // consumers see the same name they see in the UI. Architect-prompted
      // R79.3b fix — previously returned canonical names regardless of tenant.
      const result: any = await db.execute(sql`
        SELECT p.id, p.name, p.role, p.catchphrase, p.emoji,
               tpn.display_name AS tenant_display_name
        FROM personas p
        LEFT JOIN tenant_persona_names tpn
          ON tpn.persona_id = p.id AND tpn.tenant_id = ${tenantId}
        WHERE p.is_active = true
        ORDER BY p.id ASC
      `);
      const rows = (result.rows || result) as any[];
      const agents = rows.map((p) => {
        const displayName = p.tenant_display_name || p.name;
        return {
          id: p.id,
          name: displayName,
          canonicalName: p.name,
          role: p.role,
          emoji: p.emoji || null,
          catchphrase: p.catchphrase || null,
          // Routing hint keyed off canonical name so dispatch still resolves
          // even when a tenant has rebranded the persona.
          routingHint: ROUTING_HINTS[String(p.name).toLowerCase()] || null,
        };
      });
      res.json({ agents, count: agents.length });
    } catch (err: any) {
      console.error(`[api-v1] [${requestId}] agents list error:`, err?.message || err);
      publicError(res, 500, "Failed to list agents", requestId);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/v1/agents/dispatch — one-shot task submission
  //
  // Body: { task: string (≤16k), agent?: string, personaId?: number,
  //         async?: boolean, title?: string, model?: string, timeoutMs?: number }
  //
  // - `agent` is a fuzzy name match (e.g. "Felix", "felix", "Neptune")
  // - `personaId` overrides `agent` if provided
  // - `async=true` (default) returns 202 immediately with statusUrl for polling
  // - `async=false` blocks up to `timeoutMs` (default 60000, max 180000)
  //   and returns the assistant reply inline if it completes in time
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/agents/dispatch",
    authMiddleware,
    requireApiKeyOnly,
    async (req: Request, res: Response) => {
      const requestId = newRequestId();
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return publicError(res, 401, "Authentication required", requestId);

      const parsed = dispatchSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request body",
          requestId,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const { task, agent, personaId, async: isAsync = true, title, model, timeoutMs } = parsed.data;

      try {
        // Resolve persona: explicit personaId > agent name lookup > active persona
        let resolvedPersonaId: number | null = null;
        let resolvedPersonaName: string | null = null;

        if (personaId !== undefined && personaId !== null) {
          const idNum = Number(personaId);
          const p = await storage.getPersona(idNum);
          if (!p) return publicError(res, 404, `Persona ${idNum} not found`, requestId);
          resolvedPersonaId = p.id;
          resolvedPersonaName = p.name;
        } else if (agent) {
          const result: any = await db.execute(sql`
            SELECT id, name FROM personas
            WHERE is_active = true AND LOWER(name) = LOWER(${agent})
            LIMIT 1
          `);
          const rows = (result.rows || result) as any[];
          if (rows.length === 0) {
            return res.status(404).json({
              error: `No agent named "${agent}" found. GET /api/v1/agents to list available agents.`,
              requestId,
            });
          }
          resolvedPersonaId = rows[0].id;
          resolvedPersonaName = rows[0].name;
        } else {
          const active = await storage.getActivePersona();
          resolvedPersonaId = active?.id ?? null;
          resolvedPersonaName = active?.name ?? null;
        }

        // Pick model: explicit > settings default > deepseek fallback
        const settings = await storage.getSettings();
        const finalModel = model || settings?.defaultModel || "deepseek/deepseek-v3.2";

        // Create conversation. Keep parity with /api/conversations defaults.
        const conv = await storage.createConversation({
          title: title || `API: ${task.slice(0, 60)}${task.length > 60 ? "…" : ""}`,
          model: finalModel,
          thinking: true,
          thinkingLevel: "auto",
          personaId: resolvedPersonaId,
          tenantId,
        });

        const statusUrl = `/api/v1/conversations/${conv.id}`;
        const baseResponse = {
          conversationId: conv.id,
          agentName: resolvedPersonaName,
          personaId: resolvedPersonaId,
          statusUrl,
          createdAt: new Date().toISOString(),
          requestId,
        };

        if (isAsync) {
          // Fire-and-forget. Errors will surface on the polling endpoint via
          // the saved assistant message OR an absent reply — caller polls.
          processMessage(conv.id, task, { source: "api-v1" }).catch((err) => {
            console.error(`[api-v1] [${requestId}] dispatch async error conv ${conv.id}:`, err?.message || err);
          });
          return res.status(202).json({ ...baseResponse, status: "queued" });
        }

        // Synchronous: race processMessage against caller-specified timeout.
        // Critical: clear the timer on early completion to prevent leak under load.
        const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs || DEFAULT_TIMEOUT_MS));
        let timeoutHandle: NodeJS.Timeout | null = null;
        const result = await Promise.race([
          processMessage(conv.id, task, { source: "api-v1" })
            .then((r) => ({ ok: true as const, r }))
            .catch((err) => {
              console.error(`[api-v1] [${requestId}] dispatch sync error conv ${conv.id}:`, err?.message || err);
              return { ok: true as const, r: null as any, error: true as const };
            }),
          new Promise<{ ok: false }>((resolve) => {
            timeoutHandle = setTimeout(() => resolve({ ok: false }), timeout);
          }),
        ]).finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        });

        if ((result as any).ok && !(result as any).error) {
          const r = (result as any).r;
          return res.json({
            ...baseResponse,
            status: "complete",
            reply: r?.response || null,
            model: r?.model || finalModel,
            toolsUsed: r?.toolsUsed?.map((t: any) => t.name) || [],
            citations: r?.citations || [],
          });
        }

        if ((result as any).error) {
          return res.status(202).json({
            ...baseResponse,
            status: "failed",
            message: `Task failed during execution. Poll ${statusUrl} for any partial state.`,
          });
        }

        return res.status(202).json({
          ...baseResponse,
          status: "still_running",
          message: `Task did not complete within ${timeout}ms. Poll ${statusUrl} for the result.`,
        });
      } catch (err: any) {
        console.error(`[api-v1] [${requestId}] dispatch error:`, err?.message || err, err?.stack);
        publicError(res, 500, "Dispatch failed", requestId);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/v1/agui/run — AG-UI protocol adapter (agent-to-UI wire format
  // adopted by LangChain / Mastra / PydanticAI / AWS / Microsoft).
  //
  // Lets a third-party frontend embed a VisionClaw persona speaking the
  // standard AG-UI event stream instead of our internal SSE shape.
  // Coarse-grained by design: the turn runs to completion via processMessage
  // (same execution path + guards as /agents/dispatch), then the events are
  // replayed in protocol order. Streaming granularity is optional in AG-UI.
  //
  // Body (RunAgentInput subset):
  //   { threadId?: "vc-conv-<id>", runId?: string,
  //     messages?: [{role, content}]  (last user message = the task)
  //     task?: string                 (shortcut, wins over messages)
  //     agent?, personaId?, model?, timeoutMs? — same semantics as dispatch }
  //
  // Emits SSE: RUN_STARTED → TOOL_CALL_* / TOOL_CALL_RESULT per tool →
  // TEXT_MESSAGE_START/CONTENT/END → RUN_FINISHED (or RUN_ERROR).
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    "/api/v1/agui/run",
    authMiddleware,
    requireApiKeyOnly,
    async (req: Request, res: Response) => {
      const requestId = newRequestId();
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return publicError(res, 401, "Authentication required", requestId);

      const parsed = aguiRunSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request body",
          requestId,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const body = parsed.data;

      // Resolve task text: explicit `task` wins, else last user message.
      let task = body.task?.trim() || "";
      if (!task && Array.isArray(body.messages)) {
        for (let i = body.messages.length - 1; i >= 0; i--) {
          const m = body.messages[i];
          if (m.role === "user" && m.content?.trim()) {
            task = m.content.trim();
            break;
          }
        }
      }
      if (!task) return publicError(res, 400, "No user message or task provided", requestId);
      if (task.length > MAX_TASK_LEN) return publicError(res, 400, `Task exceeds ${MAX_TASK_LEN} chars`, requestId);

      // Per-tenant rate limit — same fail-closed posture as the chat ingress.
      try {
        const { checkTenantRate } = await import("../lib/tenant-rate-limit");
        const decision = checkTenantRate(tenantId);
        if (!decision.allowed) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
          return res.status(429).json({ error: "Rate limit exceeded", requestId, retryAfterSeconds: decision.retryAfterSeconds });
        }
      } catch (rateErr: any) {
        console.error(`[agui] [${requestId}] rate-limit gate error → fail-closed 503:`, rateErr?.message || String(rateErr));
        res.setHeader("Retry-After", "30");
        return res.status(503).json({ error: "Rate-limit gate temporarily unavailable", requestId });
      }

      const { buildTurnEvents, encodeAguiSse, parseAguiThreadId, makeAguiThreadId } = await import("../lib/agui-events");

      try {
        // Resolve conversation: continue an owned thread, else create one.
        let convId: number | null = null;
        const requestedConvId = parseAguiThreadId(body.threadId);
        if (requestedConvId !== null) {
          const existing = await storage.getConversation(requestedConvId, tenantId);
          // Tenant-scoped fetch — a threadId pointing at another tenant's
          // conversation resolves to null and falls through to create-new.
          if (existing && existing.tenantId === tenantId) convId = existing.id;
        }
        if (convId === null) {
          let resolvedPersonaId: number | null = null;
          if (body.personaId !== undefined && body.personaId !== null) {
            const p = await storage.getPersona(Number(body.personaId));
            if (!p) return publicError(res, 404, "Persona not found", requestId);
            resolvedPersonaId = p.id;
          } else if (body.agent) {
            const result: any = await db.execute(sql`
              SELECT id FROM personas WHERE is_active = true AND LOWER(name) = LOWER(${body.agent}) LIMIT 1
            `);
            const rows = (result.rows || result) as any[];
            if (rows.length === 0) return publicError(res, 404, "Agent not found", requestId);
            resolvedPersonaId = rows[0].id;
          } else {
            const active = await storage.getActivePersona();
            resolvedPersonaId = active?.id ?? null;
          }
          const settings = await storage.getSettings();
          const conv = await storage.createConversation({
            title: `AG-UI: ${task.slice(0, 60)}${task.length > 60 ? "…" : ""}`,
            model: body.model || settings?.defaultModel || "deepseek/deepseek-v3.2",
            thinking: true,
            thinkingLevel: "auto",
            personaId: resolvedPersonaId,
            tenantId,
          });
          convId = conv.id;
        }

        const threadId = makeAguiThreadId(convId);
        const runId = body.runId?.trim() || `run-${requestId}`;
        const messageId = `msg-${requestId}`;

        // Open the SSE stream. Keepalive comments while the turn runs so
        // proxies don't kill the idle connection.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        // Client-disconnect tracking: the turn is allowed to finish (result
        // persists to the conversation for the poll endpoint), but we stop
        // keepalives and skip the event replay once the socket is gone.
        let clientGone = false;
        req.on("close", () => { clientGone = true; });
        const keepalive = setInterval(() => {
          if (clientGone) { clearInterval(keepalive); return; }
          try { res.write(`: keepalive\n\n`); } catch (e) { console.warn("[silent-catch] api-v1 agui keepalive:", (e as any)?.message ?? e); }
        }, 15_000);

        const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, body.timeoutMs || DEFAULT_TIMEOUT_MS));
        let timeoutHandle: NodeJS.Timeout | null = null;
        const raced = await Promise.race([
          processMessage(convId, task, { source: "api-v1" })
            .then((r) => ({ ok: true as const, r }))
            .catch((err) => {
              console.error(`[agui] [${requestId}] run error conv ${convId}:`, err?.message || err);
              return { ok: true as const, r: null, error: true as const };
            }),
          new Promise<{ ok: false }>((resolve) => {
            timeoutHandle = setTimeout(() => resolve({ ok: false }), timeout);
          }),
        ]).finally(() => {
          clearInterval(keepalive);
          if (timeoutHandle) clearTimeout(timeoutHandle);
        });

        const writeEvent = (e: any) => {
          if (clientGone) return;
          try { res.write(encodeAguiSse(e)); } catch (e) { console.warn("[silent-catch] api-v1 agui write:", (e as any)?.message ?? e); }
        };

        if (!(raced as any).ok) {
          writeEvent({ type: "RUN_STARTED", threadId, runId });
          writeEvent({ type: "RUN_ERROR", message: `Run did not complete within ${timeout}ms. Poll /api/v1/conversations/${convId} for the result.`, code: "TIMEOUT" });
          return res.end();
        }
        if ((raced as any).error || !(raced as any).r) {
          writeEvent({ type: "RUN_STARTED", threadId, runId });
          writeEvent({ type: "RUN_ERROR", message: "Run failed during execution.", code: "RUN_FAILED" });
          return res.end();
        }

        const r = (raced as any).r;
        for (const e of buildTurnEvents({ threadId, runId, messageId, response: r.response || "", toolsUsed: r.toolsUsed })) {
          writeEvent(e);
        }
        return res.end();
      } catch (err: any) {
        console.error(`[agui] [${requestId}] error:`, err?.message || err);
        if (res.headersSent) {
          try { res.write(`data: ${JSON.stringify({ type: "RUN_ERROR", message: "Internal error", code: "INTERNAL" })}\n\n`); } catch (e) { console.warn("[silent-catch] api-v1 agui error-write:", (e as any)?.message ?? e); }
          return res.end();
        }
        return publicError(res, 500, "AG-UI run failed", requestId);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/v1/conversations/:id — poll for the latest assistant reply
  //
  // Returns:
  //   { conversationId, status, lastUserMessage, lastAssistantMessage,
  //     messageCount, updatedAt }
  // Status: "pending" | "running" | "complete"
  //   - "pending"  : user message saved, no assistant reply yet
  //   - "running"  : assistant message exists but is incomplete (streaming)
  //   - "complete" : assistant reply is finalized
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/conversations/:id",
    authMiddleware,
    requireApiKeyOnly,
    async (req: Request, res: Response) => {
      const requestId = newRequestId();
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return publicError(res, 401, "Authentication required", requestId);
      const conversationId = parseInt(req.params.id as string);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return publicError(res, 400, "Invalid conversation id", requestId);
      }

      try {
        const conv = await storage.getConversation(conversationId, tenantId);
        if (!conv) return publicError(res, 404, "Conversation not found", requestId);
        if (conv.tenantId !== tenantId) {
          // Identical message to 404 to avoid existence-leak via timing/error diff
          return publicError(res, 404, "Conversation not found", requestId);
        }

        const result: any = await db.execute(sql`
          SELECT id, role, content, created_at
          FROM messages
          WHERE conversation_id = ${conversationId}
          ORDER BY id DESC
          LIMIT 50
        `);
        const rows = ((result.rows || result) as any[]).reverse();

        const lastUser = [...rows].reverse().find((m) => m.role === "user") || null;
        const lastAssistant = [...rows].reverse().find((m) => m.role === "assistant") || null;

        let status: "pending" | "running" | "complete" = "pending";
        if (lastAssistant) {
          // Heuristic: assistant message > 1s old AND non-empty = complete.
          // Streaming partials get updated rapidly; if it hasn't changed in 1s it's done.
          const ageMs = Date.now() - new Date(lastAssistant.created_at).getTime();
          const hasContent = lastAssistant.content && lastAssistant.content.trim().length > 0;
          status = hasContent && ageMs > 1000 ? "complete" : "running";
        }

        res.json({
          conversationId,
          status,
          title: conv.title,
          personaId: conv.personaId,
          model: conv.model,
          lastUserMessage: lastUser
            ? { id: lastUser.id, content: lastUser.content, createdAt: lastUser.created_at }
            : null,
          lastAssistantMessage: lastAssistant
            ? { id: lastAssistant.id, content: lastAssistant.content, createdAt: lastAssistant.created_at }
            : null,
          messageCount: rows.length,
          requestId,
        });
      } catch (err: any) {
        console.error(`[api-v1] [${requestId}] conversation poll error:`, err?.message || err);
        publicError(res, 500, "Failed to fetch conversation", requestId);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/v1/video/templates — list wellness / [Your Product] video templates
  // Public to any authenticated key (read or chat scope).
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/v1/video/templates",
    authMiddleware,
    requireApiKeyOnly,
    async (_req: Request, res: Response) => {
      const requestId = newRequestId();
      try {
        const meta = (wellnessTemplates as any)._meta;
        const templates = Object.entries(wellnessTemplates as any)
          .filter(([k]) => !k.startsWith("_"))
          .map(([id, t]: [string, any]) => ({
            id,
            name: t.name,
            description: t.description,
            estimatedSeconds: t.estimatedSeconds,
            sceneCount: t.scenes?.length || 0,
            resolution: t.resolution,
            fillVariables: t.fillVariables || {},
          }));
        res.json({ meta, templates, requestId });
      } catch (err: any) {
        console.error(`[api-v1] [${requestId}] templates error:`, err?.message || err);
        publicError(res, 500, "Failed to load templates", requestId);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/v1/agents/produce-video — render a video from a template
  // OR fully-custom scenes. Hard-capped to keep per-call cost predictable.
  //
  // Body shapes (one of):
  //   { template: "coaching_tip_60s", variables: { topic, hook, why, ... },
  //     voiceProvider?, voice?, emailTo?, dryRun? }
  //   { customScenes: [{ title, narration, imagePrompt }, ...],
  //     title: "...", voiceProvider?, voice?, resolution?, emailTo?, dryRun? }
  //
  // dryRun=true returns the cost estimate WITHOUT rendering — recommended
  // for external agents to check before committing.
  // ─────────────────────────────────────────────────────────────────────
  const produceVideoSchema = z
    .object({
      template: z.string().trim().max(80).optional(),
      variables: z.record(z.string().max(MAX_NARRATION_CHARS)).optional(),
      customScenes: z
        .array(
          z.object({
            title: z.string().trim().max(MAX_TITLE_LEN).optional(),
            narration: z.string().trim().max(MAX_NARRATION_CHARS).optional(),
            imagePrompt: z.string().trim().max(MAX_IMAGE_PROMPT_CHARS).optional(),
            durationOverride: z.number().min(1).max(30).optional(),
          }),
        )
        .max(MAX_VIDEO_SCENES)
        .optional(),
      title: z.string().trim().max(MAX_TITLE_LEN).optional(),
      voiceProvider: z.enum(ALLOWED_VOICE_PROVIDERS).optional(),
      voice: z.string().trim().max(80).optional(),
      resolution: z.enum(ALLOWED_VIDEO_RESOLUTIONS).optional(),
      emailTo: z.string().trim().email().max(200).optional(),
      dryRun: z.boolean().optional(),
    })
    .refine((d) => d.template || (d.customScenes && d.customScenes.length > 0), {
      message: "Provide either 'template' or non-empty 'customScenes'",
    });

  app.post(
    "/api/v1/agents/produce-video",
    authMiddleware,
    requireApiKeyOnly,
    async (req: Request, res: Response) => {
      const requestId = newRequestId();
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) {
        publicError(res, 401, "Authentication required", requestId);
        return;
      }

      const parsed = produceVideoSchema.safeParse(req.body || {});
      if (!parsed.success) {
        publicError(res, 400, parsed.error.issues[0]?.message || "Invalid request", requestId);
        return;
      }
      const body = parsed.data;

      // Resolve scenes — either from template + variable substitution, or from customScenes
      let scenes: Array<{ title?: string; narration?: string; imagePrompt?: string; durationOverride?: number }> = [];
      let title = body.title || "Untitled Video";
      let resolution: "720p" | "1080p" = body.resolution || "1080p";
      let kenBurns = true;
      let kenBurnsIntensity = 1.12;
      let crossfadeMs = 400;
      let introText: string | undefined;
      let outroText: string | undefined;

      if (body.template) {
        const tpl: any = (wellnessTemplates as any)[body.template];
        if (!tpl || body.template.startsWith("_")) {
          publicError(res, 400, `Unknown template '${body.template}'. Call GET /api/v1/video/templates to list options.`, requestId);
          return;
        }
        const vars = body.variables || {};
        const fill = (s: string | undefined): string | undefined => {
          if (!s) return s;
          return s.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`));
        };
        scenes = (tpl.scenes || []).map((s: any) => ({
          title: fill(s.title),
          narration: fill(s.narration),
          imagePrompt: fill(s.imagePrompt),
          durationOverride: s.durationOverride,
        }));
        title = body.title || fill(tpl.introText) || tpl.name || "Untitled Video";
        resolution = (body.resolution || tpl.resolution || "1080p") as "720p" | "1080p";
        kenBurns = tpl.kenBurns ?? true;
        kenBurnsIntensity = tpl.kenBurnsIntensity ?? 1.12;
        crossfadeMs = tpl.crossfadeMs ?? 400;
        introText = fill(tpl.introText);
        outroText = fill(tpl.outroText);
      } else if (body.customScenes) {
        scenes = body.customScenes;
      }

      if (scenes.length === 0) {
        publicError(res, 400, "No scenes resolved from request", requestId);
        return;
      }
      if (scenes.length > MAX_VIDEO_SCENES) {
        publicError(res, 400, `Scene count ${scenes.length} exceeds cap ${MAX_VIDEO_SCENES}`, requestId);
        return;
      }

      // Validate any unfilled placeholders left in narration (catches caller bugs early)
      const unfilled = scenes
        .map((s, i) => ({ i, m: s.narration?.match(/\{\{\w+\}\}/g) }))
        .filter((x) => x.m && x.m.length > 0);
      if (unfilled.length > 0) {
        publicError(
          res,
          400,
          `Unfilled template variables in scene ${unfilled[0].i + 1}: ${unfilled[0].m!.join(", ")}. Provide them in 'variables'.`,
          requestId,
        );
        return;
      }

      const voiceProvider = body.voiceProvider || (wellnessTemplates as any)._meta?.voiceDefault?.voiceProvider || "openai";
      const voice = body.voice || (wellnessTemplates as any)._meta?.voiceDefault?.voice || "onyx";

      const estimatedCostUsd = estimateVideoCostUsd(scenes, voiceProvider);
      const estimatedSeconds = scenes.reduce((acc, s) => {
        if (s.durationOverride) return acc + s.durationOverride;
        const words = (s.narration || "").split(/\s+/).filter(Boolean).length;
        return acc + Math.max(3, words / 2.5);
      }, 0);

      // Dry-run: return estimate without rendering
      if (body.dryRun) {
        res.json({
          ok: true,
          dryRun: true,
          estimate: {
            scenes: scenes.length,
            estimatedSeconds: Math.round(estimatedSeconds),
            estimatedCostUsd,
            resolution,
            voiceProvider,
            voice,
          },
          requestId,
        });
        return;
      }

      console.log(`[api-v1] [${requestId}] produce-video tenant=${tenantId} template=${body.template || "custom"} scenes=${scenes.length} est=$${estimatedCostUsd}`);

      try {
        const { produceVideo } = await import("../mpeg-engine");
        const result = await produceVideo({
          title,
          scenes,
          voice,
          voiceProvider: voiceProvider as "openai" | "elevenlabs",
          resolution,
          kenBurns,
          kenBurnsIntensity,
          transition: "fade",
          crossfadeMs,
          introText,
          outroText,
          tenantId,
          emailTo: body.emailTo,
          uploadToDrive: true,
        });

        if (!result.success) {
          publicError(res, 500, `Video render failed: ${result.error || "unknown"}`, requestId);
          return;
        }

        res.json({
          ok: true,
          requestId,
          template: body.template || null,
          title,
          driveUrl: result.driveUrl || null,
          filePath: result.filePath || null,
          durationSeconds: result.durationSeconds,
          sizeBytes: result.sizeBytes,
          scenesProcessed: result.scenesProcessed,
          estimatedCostUsd,
          steps: result.steps,
        });
      } catch (err: any) {
        console.error(`[api-v1] [${requestId}] produce-video error:`, err?.message || err);
        publicError(res, 500, "Video render failed", requestId);
      }
    },
  );
}

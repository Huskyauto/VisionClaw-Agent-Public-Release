import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { apiKeys } from "@shared/schema";
import { TOOL_DEFINITIONS, executeToolWithTimeout } from "./tools";

// ─────────────────────────────────────────────────────────────────────────────
// VisionClaw Glasses Gateway (Round 20 + Round 20.1 hardening)
//
// Public, OpenAI/Gemini-friendly bridge that lets a Meta Ray-Ban Android client
// (forked from github.com/Intent-Lab/VisionClaw) talk to the platform's tool
// executor without going through the full multi-turn chat engine.
//
// Endpoints:
//   GET  /v1/glasses/health    -> service probe (no auth)
//   GET  /v1/glasses/tools     -> JSON tool catalog (OpenAI function-calling)
//   POST /v1/glasses/execute   -> { name, arguments } -> single tool execution
//
// Auth: Bearer <api key>. Requires the "chat" or "admin" scope.
//
// SECURITY GUARANTEES (Round 20.1, after architect review):
//  • Tenant-IDOR closed: client cannot inject _tenantId / _apiKeyId; server
//    overwrites every leading-underscore field with auth-context values.
//  • Allowlist correctness: every entry is asserted to exist in
//    TOOL_DEFINITIONS at startup (drops + warns on mismatches).
//  • Admin-data exposure closed: agent_status is admin-only.
//  • Cost/abuse rate limiter: per-API-key sliding window
//    (60 calls/minute total; 4/minute for VERY_SLOW tools like deep_research).
// ─────────────────────────────────────────────────────────────────────────────

// Conservative voice-safe defaults. The Android client streams audio + ~1fps
// JPEG to Gemini Live; Gemini decides what tools to call from this list.
// All names below are verified against TOOL_DEFINITIONS at startup.
const GLASSES_DEFAULT_ALLOW_RAW: string[] = [
  // Memory / context
  "search_memory",
  "create_memory",
  "recall_context",
  "query_triples",
  "store_triple",
  // Research / web
  "web_search",
  "web_fetch",
  "deep_research",
  "research_digest",
  // Communication (outbound)
  "send_email",
  "check_inbox",
  "whatsapp",
  // Productivity / calendaring
  "calendar_sync",
  "google_drive",
  "google_workspace",
  // Light document creation
  "create_pdf",
  "create_document",
  // Status (non-admin: just confirm system is up)
  "check_system_status",
  // Treasury / market intelligence (read-only, voice-safe)
  "forecast_ticker",
  // File security — restricted by jail (Round 19.2)
  "scan_file",
];

let GLASSES_DEFAULT_ALLOW: Set<string> = new Set();
let FULL_TOOL_NAMES: Set<string> = new Set();
let GLASSES_ADMIN_ALLOW: Set<string> = new Set();
let VERY_SLOW_GLASSES_TOOLS: Set<string> = new Set([
  "deep_research",
  "ensemble_query",
  "research_digest",
  "produce_video",
  "create_pdf",
  "create_document",
]);

// R74.13z-quint+7 SECURITY (Tier-1 #1): tools that admin scope MUST NOT be
// able to call from voice/glasses. Voice is the wrong control surface for
// arbitrary shell, custom-tool deletion, lobster pipelines, MCP key writes,
// or platform-config mutations. The owner can still run these from the
// browser UI / API directly. Anything matching one of these literal names or
// a prefix in DENY_PREFIXES is excluded from the admin allowlist at startup.
const GLASSES_ADMIN_DENY: Set<string> = new Set([
  "exec",
  "shell_exec",
  "lobster",
  "execute_code",
  "create_tool",
  "delete_custom_tool",
  "decide_approval",
  "request_approval",
  "manage_skills",
]);
const GLASSES_ADMIN_DENY_PREFIXES: string[] = ["delete_", "platform_admin_", "mcp_admin_"];

function isGlassesAdminDenied(name: string): boolean {
  if (GLASSES_ADMIN_DENY.has(name)) return true;
  return GLASSES_ADMIN_DENY_PREFIXES.some((p) => name.startsWith(p));
}

function getEffectiveAllowlist(scopes: string[]): Set<string> {
  if (scopes.includes("admin")) return GLASSES_ADMIN_ALLOW;
  return GLASSES_DEFAULT_ALLOW;
}

// ── Per-API-key sliding-window rate limiter (in-memory) ──────────────────────
// 60 calls/minute total, 4/minute for expensive tools. Keyed on apiKeyId so
// rotating phones doesn't reset the bucket. Per-instance only — replicas would
// need Redis for cross-replica enforcement, but this catches the common case
// (one phone, runaway loop, or a stolen key being abused).
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_TOTAL = 60;
const RATE_LIMIT_HEAVY = 4;
const callBuckets: Map<number, Array<{ at: number; heavy: boolean }>> = new Map();

function checkRateLimit(apiKeyId: number, isHeavy: boolean): { ok: true } | { ok: false; retryAfterSec: number; bucket: "heavy" | "total" } {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  let calls = callBuckets.get(apiKeyId) || [];
  calls = calls.filter((c) => c.at > cutoff);
  const heavyCount = calls.filter((c) => c.heavy).length;
  if (isHeavy && heavyCount >= RATE_LIMIT_HEAVY) {
    const oldest = calls.find((c) => c.heavy)!;
    return { ok: false, retryAfterSec: Math.ceil((oldest.at + RATE_WINDOW_MS - now) / 1000), bucket: "heavy" };
  }
  if (calls.length >= RATE_LIMIT_TOTAL) {
    const oldest = calls[0];
    return { ok: false, retryAfterSec: Math.ceil((oldest.at + RATE_WINDOW_MS - now) / 1000), bucket: "total" };
  }
  calls.push({ at: now, heavy: isHeavy });
  callBuckets.set(apiKeyId, calls);
  return { ok: true };
}

// Periodic GC so we don't leak memory across millions of revoked/old keys.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [keyId, calls] of callBuckets.entries()) {
    const fresh = calls.filter((c) => c.at > cutoff);
    if (fresh.length === 0) callBuckets.delete(keyId);
    else callBuckets.set(keyId, fresh);
  }
}, 5 * 60_000).unref();

// ── Bearer auth ──────────────────────────────────────────────────────────────
async function authGlasses(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: "Missing Bearer token. Send Authorization: Bearer <api-key>." });
  }
  const rawKey = m[1].trim();
  try {
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const rows = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isRevoked, false)));
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid or revoked API key." });
    }
    const key = rows[0];
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return res.status(401).json({ error: "API key has expired." });
    }
    const scopes: string[] = (key.scopes as string[]) || [];
    if (!scopes.includes("chat") && !scopes.includes("admin")) {
      return res.status(403).json({ error: "API key needs 'chat' or 'admin' scope for the glasses gateway." });
    }
    (req as any).tenantId = key.tenantId;
    (req as any).apiKeyId = key.id;
    (req as any).apiKeyScopes = scopes;
    db.update(apiKeys).set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, key.id)).execute().catch(() => {});
    // R94 SECURITY — wrap downstream handler in AsyncLocalStorage tenant
    // context so any LLM calls made by tools executed via the glasses
    // gateway bill the api-key's tenant (not ADMIN fallback).
    const { runWithTenant } = await import("./lib/tenant-context");
    return runWithTenant(key.tenantId, "api-key", () => next());
  } catch (err) {
    console.error("[glasses-gateway] auth error:", (err as Error).message);
    return res.status(500).json({ error: "Auth failure." });
  }
}

// Strip every client-supplied leading-underscore field, then inject the
// server-controlled execution context. This is the IDOR fix: tools that read
// params._tenantId now receive the auth-derived tenant, not whatever the
// caller put in the JSON body.
function buildExecutionParams(rawArgs: any, tenantId: number, apiKeyId: number): Record<string, any> {
  const out: Record<string, any> = {};
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    for (const [k, v] of Object.entries(rawArgs)) {
      if (k.startsWith("_")) continue; // drop ALL client-supplied private fields
      out[k] = v;
    }
  }
  out._tenantId = tenantId;
  out._apiKeyId = apiKeyId;
  out._invokedVia = "glasses-gateway";
  return out;
}

export function registerGlassesGateway(app: Express): void {
  // ── Startup: build & audit the tool catalog ─────────────────────────────
  FULL_TOOL_NAMES = new Set(
    (TOOL_DEFINITIONS as any[]).map((t) => t.function?.name).filter(Boolean)
  );
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of GLASSES_DEFAULT_ALLOW_RAW) {
    if (FULL_TOOL_NAMES.has(name)) present.push(name);
    else missing.push(name);
  }
  GLASSES_DEFAULT_ALLOW = new Set(present);
  if (missing.length > 0) {
    console.warn(`[glasses-gateway] WARN: dropped ${missing.length} allowlist entries not found in TOOL_DEFINITIONS: ${missing.join(", ")}`);
  }

  // R74.13z-quint+7 SECURITY (Tier-1 #1): build the admin allowlist by
  // subtracting the GLASSES_ADMIN_DENY set from the full registry. This is
  // recomputed at startup so any newly-registered dangerous tool is denied
  // by default (the prefix patterns catch dynamic delete_*/platform_admin_*
  // additions).
  const adminDenied: string[] = [];
  GLASSES_ADMIN_ALLOW = new Set();
  for (const name of FULL_TOOL_NAMES) {
    if (isGlassesAdminDenied(name)) adminDenied.push(name);
    else GLASSES_ADMIN_ALLOW.add(name);
  }
  if (adminDenied.length > 0) {
    console.log(`[glasses-gateway] admin scope denied (${adminDenied.length}): ${adminDenied.sort().join(", ")}`);
  }

  // ── Tool catalog ───────────────────────────────────────────────────────
  app.get("/v1/glasses/tools", authGlasses, (req: Request, res: Response) => {
    const scopes: string[] = (req as any).apiKeyScopes || [];
    const allow = getEffectiveAllowlist(scopes);
    const tools = (TOOL_DEFINITIONS as any[])
      .filter((t) => t.function?.name && allow.has(t.function.name))
      .map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    res.json({
      object: "list",
      data: tools,
      count: tools.length,
      mode: scopes.includes("admin") ? "admin (full catalog)" : "voice-safe allowlist",
    });
  });

  // ── Single-tool executor ───────────────────────────────────────────────
  app.post("/v1/glasses/execute", authGlasses, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    // R64.C — fail-closed: glasses voice gateway must have a tenant bound to
    // the API key by authGlasses(). Falling through to tenant 1 here would
    // execute another tenant's tools against Bob's tenant data.
    const tenantId: number | undefined = (req as any).tenantId;
    if (!tenantId || typeof tenantId !== "number") {
      return res.status(401).json({ error: "Unauthorized: glasses API key has no tenant binding" });
    }
    const apiKeyId: number = (req as any).apiKeyId;
    try {
      const body = req.body || {};
      const name: string = body.name || body.tool || body.function_name;
      let rawArgs: any = body.arguments ?? body.args ?? body.parameters ?? {};
      if (typeof rawArgs === "string") {
        try { rawArgs = JSON.parse(rawArgs); } catch { rawArgs = { _raw: rawArgs }; }
      }
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Body must include a tool 'name' (string)." });
      }
      const scopes: string[] = (req as any).apiKeyScopes || [];
      const allow = getEffectiveAllowlist(scopes);
      if (!allow.has(name)) {
        return res.status(403).json({
          error: `Tool '${name}' is not enabled for the glasses gateway on this key.`,
          hint: "Use the GET /v1/glasses/tools endpoint to see the allowed tool catalog. An admin-scoped key unlocks the full catalog.",
        });
      }

      // Per-key rate limit (cost/abuse guard)
      const heavy = VERY_SLOW_GLASSES_TOOLS.has(name);
      const rl = checkRateLimit(apiKeyId, heavy);
      if (!rl.ok) {
        res.setHeader("Retry-After", String(rl.retryAfterSec));
        return res.status(429).json({
          error: `Rate limit hit for ${rl.bucket} bucket. Retry in ${rl.retryAfterSec}s.`,
          bucket: rl.bucket,
          retryAfterSec: rl.retryAfterSec,
        });
      }

      // Build server-controlled execution context (closes _tenantId injection)
      const params = buildExecutionParams(rawArgs, tenantId, apiKeyId);
      const { executeGuardedTool } = await import("./guarded-tool-executor");
      const result = await executeGuardedTool(name, params, {
        tenantId,
        invokedVia: "glasses_gateway",
      });
      const durationMs = Date.now() - startedAt;
      console.log(`[glasses-gateway] tenant=${tenantId} key=${apiKeyId} tool=${name} ok=${!result?.error} dur=${durationMs}ms`);
      // R95.c — Strict outbound gate on glasses-gateway responses. The
      // glasses surface is voice-rendered (TTS) on a head-worn device; a
      // leaked credential becomes audible in physical space.
      const { enforceOutbound } = await import("./lib/outbound-redaction");
      const resultJson = JSON.stringify(result);
      const gate = enforceOutbound(resultJson, { surface: `glasses:${name}`, strict: true });
      if (!gate.ok) {
        return res.status(403).json({ ok: false, tool: name, durationMs, error: gate.error });
      }
      let safeResult: any;
      try { safeResult = JSON.parse(gate.payload); } catch { safeResult = { redacted: true, payload: gate.payload }; }
      res.json({
        ok: !result?.error,
        tool: name,
        durationMs,
        result: safeResult,
      });
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 300) || "unknown error";
      console.error(`[glasses-gateway] execute error tenant=${tenantId} key=${apiKeyId}:`, msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // ── Health probe (unauth) ──────────────────────────────────────────────
  app.get("/v1/glasses/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "VisionClaw Glasses Gateway",
      version: "1.1.0",
      catalog: GLASSES_DEFAULT_ALLOW.size,
      total_tools: FULL_TOOL_NAMES.size,
    });
  });

  console.log(`[glasses-gateway] mounted /v1/glasses/{tools,execute,health}; voice-safe allowlist = ${GLASSES_DEFAULT_ALLOW.size} of ${FULL_TOOL_NAMES.size} tools; rate limit ${RATE_LIMIT_TOTAL}/min (${RATE_LIMIT_HEAVY}/min heavy)`);
}

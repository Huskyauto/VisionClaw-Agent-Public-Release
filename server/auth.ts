import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { tenants, apiKeys } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[auth] FATAL: SESSION_SECRET is required in production. Without it, signed cookies/HMACs (password reset, magic links) cannot survive restarts and security guarantees are void. Refusing to boot.");
  }
  console.warn("[auth] WARNING: SESSION_SECRET not set. Using random secret (sessions will not survive restarts). HARD-FAILS in production.");
}
const EFFECTIVE_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PIN_SALT = "visionclaw-pin-v1";

export const ADMIN_TENANT_ID = 1;

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const sessionCache = new Map<string, { tenantId: number; isAdmin: boolean; expiresAt: number }>();

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_ENTRIES = 10000;

// R77.7: bounded set wrapper. Without a cap, an attacker spoofing IPs (or
// hammering from a botnet) can grow this Map unbounded and OOM the process.
// When full, aggressively prune stale entries; if still saturated, refuse to
// track the new attempt (login proceeds without lockout tracking — the global
// rate limiter and the rate limit on /api/login still apply).
function setLoginAttempt(ip: string, value: { count: number; lastAttempt: number }) {
  if (!loginAttempts.has(ip) && loginAttempts.size >= MAX_LOGIN_ATTEMPTS_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of loginAttempts) {
      if (now - v.lastAttempt > LOGIN_LOCKOUT_MS) loginAttempts.delete(k);
    }
    if (loginAttempts.size >= MAX_LOGIN_ATTEMPTS_ENTRIES) {
      console.warn(`[auth] loginAttempts cap reached (${MAX_LOGIN_ATTEMPTS_ENTRIES}); dropping new entry for ip=${ip.slice(0, 32)}`);
      return;
    }
  }
  loginAttempts.set(ip, value);
}

setInterval(() => {
  const now = Date.now();
  let sessionsPurged = 0;
  let attemptsPurged = 0;
  for (const [k, v] of sessionCache) {
    if (now > v.expiresAt) { sessionCache.delete(k); sessionsPurged++; }
  }
  for (const [k, v] of loginAttempts) {
    if (now - v.lastAttempt > LOGIN_LOCKOUT_MS * 2) { loginAttempts.delete(k); attemptsPurged++; }
  }
  if (sessionsPurged || attemptsPurged) {
    console.log(`[auth] Cache cleanup: ${sessionsPurged} expired sessions, ${attemptsPurged} stale login attempts removed (remaining: ${sessionCache.size} sessions, ${loginAttempts.size} attempts)`);
  }
}, 15 * 60 * 1000);

function hashPin(pin: string): string {
  return crypto.createHmac("sha256", PIN_SALT).update(pin).digest("hex");
}

function hashPinLegacy(pin: string): string {
  return crypto.createHmac("sha256", EFFECTIVE_SECRET).update(pin).digest("hex");
}

// R74.13d C2: HMAC-SHA256 wrapper for reset tokens and email-verification codes.
// Stored value in DB is the HMAC(secret, value), so a DB read does NOT yield a
// usable plaintext token/code. SESSION_SECRET as the HMAC key also prevents
// pre-computed rainbow tables for the 6-digit code. Backward-compatible: see
// timingSafeCompareAuthSecret below.
const AUTH_SECRET_SALT = "visionclaw-auth-secret-v1";
function hashAuthSecret(secret: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET_SALT).update(EFFECTIVE_SECRET).update(secret).digest("hex");
}
// Constant-time compare of (incoming plaintext, stored value).
// Accepts both hashed (new) and plaintext (legacy) stored values during the
// rollout window — once all in-flight tokens/codes have expired (≤1h for reset,
// ≤15min for verify) every stored value is the hash form.
function timingSafeCompareAuthSecret(incomingPlain: string, stored: string): boolean {
  const expected = hashAuthSecret(incomingPlain);
  if (stored.length === 64) {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"));
    } catch {
      return false;
    }
  }
  // Legacy plaintext fallback (transitional). Always pad to a fixed 256-byte
  // buffer before comparing so a length mismatch doesn't short-circuit and
  // leak the stored secret's length via response timing. The result is still
  // false on length mismatch — we just take the same time to say so.
  try {
    const PAD = 256;
    const a = Buffer.alloc(PAD, 0);
    const b = Buffer.alloc(PAD, 0);
    Buffer.from(stored, "utf8").copy(a, 0, 0, Math.min(stored.length, PAD));
    Buffer.from(incomingPlain, "utf8").copy(b, 0, 0, Math.min(incomingPlain.length, PAD));
    const equalContent = crypto.timingSafeEqual(a, b);
    // Length must also match — but the comparison above is constant time
    // regardless. Fold the length check into the boolean AND.
    return equalContent && (stored.length === incomingPlain.length);
  } catch {
    return false;
  }
}

function timingSafeHexCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function verifyPin(pin: string, storedHash: string): boolean {
  if (timingSafeHexCompare(hashPin(pin), storedHash)) return true;
  if (timingSafeHexCompare(hashPinLegacy(pin), storedHash)) return true;
  return false;
}

async function validateApiKey(rawKey: string, req: any): Promise<boolean> {
  try {
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const rows = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isRevoked, false)));
    if (rows.length === 0) return false;
    const key = rows[0];
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return false;
    (req as any).tenantId = key.tenantId;
    (req as any).apiKeyId = key.id;
    (req as any).apiKeyScopes = key.scopes;
    db.update(apiKeys).set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, key.id)).execute().catch(() => {});
    return true;
  } catch (err) {
    console.error("[auth] API key validation error:", err);
    return false;
  }
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must include at least one lowercase letter" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must include at least one uppercase letter" };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: "Password must include at least one number" };
  }
  return { valid: true };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  if (candidate.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(tenantId: number, isAdmin: boolean): Promise<string> {
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE;

  await db.execute(sql`
    INSERT INTO auth_sessions (token, tenant_id, is_admin, created_at, expires_at)
    VALUES (${token}, ${tenantId}, ${isAdmin}, ${now}, ${expiresAt})
  `);

  sessionCache.set(token, { tenantId, isAdmin, expiresAt });
  return token;
}

async function getSession(token: string): Promise<{ tenantId: number; isAdmin: boolean } | null> {
  const cached = sessionCache.get(token);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      sessionCache.delete(token);
      db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`).catch(() => {});
      return null;
    }
    return { tenantId: cached.tenantId, isAdmin: cached.isAdmin };
  }

  const result = await db.execute(sql`
    SELECT tenant_id, is_admin, expires_at FROM auth_sessions WHERE token = ${token}
  `);
  const rows = (result as any).rows || result;
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  const expiresAt = Number(row.expires_at);
  if (Date.now() > expiresAt) {
    db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`).catch(() => {});
    return null;
  }

  const data = { tenantId: Number(row.tenant_id), isAdmin: Boolean(row.is_admin), expiresAt };
  sessionCache.set(token, data);
  return { tenantId: data.tenantId, isAdmin: data.isAdmin };
}

export function getSessionSync(token: string): { tenantId: number; isAdmin: boolean } | null {
  const cached = sessionCache.get(token);
  if (!cached) {
    getSession(token).catch(() => {});
    return null;
  }
  if (Date.now() > cached.expiresAt) {
    sessionCache.delete(token);
    db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`).catch(() => {});
    return null;
  }
  return { tenantId: cached.tenantId, isAdmin: cached.isAdmin };
}

async function deleteSession(token: string): Promise<void> {
  sessionCache.delete(token);
  await db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`).catch(() => {});
}

export function isValidSession(token: string): boolean {
  if (!token) return false;
  const cached = getSessionSync(token);
  return cached !== null;
}

export function getSessionTenantId(token: string): number | null {
  const cached = getSessionSync(token);
  return cached?.tenantId ?? null;
}

export function isSessionAdmin(token: string): boolean {
  const cached = getSessionSync(token);
  return cached?.isAdmin ?? false;
}

const tenantCacheByReplitUser = new Map<string, number>();

export async function getOrCreateTenantForReplitUser(replitUserId: string, email?: string | null, name?: string | null): Promise<number> {
  const cached = tenantCacheByReplitUser.get(replitUserId);
  if (cached) return cached;

  const replitOwner = process.env.REPL_OWNER;
  const ownerEmailsStr = process.env.OWNER_EMAILS || "";
  const ownerEmails = ownerEmailsStr.split(",").map(e => e.trim()).filter(Boolean);
  const ownerLower = replitOwner?.toLowerCase() || "";
  const isOwner = (replitOwner && (
    replitUserId.toLowerCase() === ownerLower ||
    (email && email.toLowerCase().trim() === ownerLower)
  )) || (email && ownerEmails.includes(email.toLowerCase().trim()));

  if (isOwner) {
    const [adminTenant] = await db.select().from(tenants).where(eq(tenants.id, ADMIN_TENANT_ID));
    if (adminTenant) {
      if (!adminTenant.replitUserId || adminTenant.replitUserId !== replitUserId) {
        await db.update(tenants).set({ replitUserId }).where(eq(tenants.id, ADMIN_TENANT_ID));
      }
      tenantCacheByReplitUser.set(replitUserId, ADMIN_TENANT_ID);
      console.log(`[auth] Owner "${name || email || replitUserId}" → admin tenant #${ADMIN_TENANT_ID}`);
      return ADMIN_TENANT_ID;
    }
  }

  const [existing] = await db.select().from(tenants).where(eq(tenants.replitUserId, replitUserId));
  if (existing) {
    tenantCacheByReplitUser.set(replitUserId, existing.id);
    return existing.id;
  }

  if (email) {
    const [byEmail] = await db.select().from(tenants).where(eq(tenants.email, email.toLowerCase().trim()));
    if (byEmail && !byEmail.replitUserId) {
      await db.update(tenants).set({ replitUserId }).where(eq(tenants.id, byEmail.id));
      tenantCacheByReplitUser.set(replitUserId, byEmail.id);
      return byEmail.id;
    }
  }

  const [newTenant] = await db.insert(tenants).values({
    email: (email || `${replitUserId}@replit.user`).toLowerCase().trim(),
    name: name || "VisionClaw User",
    plan: "trial",
    trialMaxConversations: 5,
    replitUserId,
    isActive: true,
  }).returning();

  tenantCacheByReplitUser.set(replitUserId, newTenant.id);
  return newTenant.id;
}

function getReplitAuthUser(req: Request): { sub: string; email?: string; firstName?: string; lastName?: string } | null {
  const user = (req as any).user;
  if (!user?.claims?.sub) return null;
  return {
    sub: user.claims.sub,
    email: user.claims.email,
    firstName: user.claims.first_name,
    lastName: user.claims.last_name,
  };
}

export function getTenantFromRequest(req: Request): number | null {
  if ((req as any).tenantId) return (req as any).tenantId;

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    const session = getSessionSync(token);
    if (session) return session.tenantId;
  }

  const replitUser = getReplitAuthUser(req);
  if (replitUser) {
    const cached = tenantCacheByReplitUser.get(replitUser.sub);
    if (cached) return cached;
  }

  return null;
}

export async function getTenantFromRequestAsync(req: Request): Promise<number | null> {
  if ((req as any).tenantId) return (req as any).tenantId;

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    const session = await getSession(token);
    if (session) return session.tenantId;
  }

  const replitUser = getReplitAuthUser(req);
  if (replitUser) {
    return getOrCreateTenantForReplitUser(
      replitUser.sub,
      replitUser.email,
      [replitUser.firstName, replitUser.lastName].filter(Boolean).join(" ") || null
    );
  }

  return null;
}

export function requireTenantFromRequest(req: Request): number | null {
  return getTenantFromRequest(req);
}

export function isAdminRequest(req: Request): boolean {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    const session = getSessionSync(token);
    if (session) return session.isAdmin;
  }

  const replitUser = getReplitAuthUser(req);
  if (replitUser) {
    const cached = tenantCacheByReplitUser.get(replitUser.sub);
    if (cached === ADMIN_TENANT_ID) return true;
    return false;
  }

  // SECURITY: Never grant admin to anonymous callers. The previous "no PIN
  // configured + tenantId === null" branch could let unauthenticated requests
  // pass admin gates on fresh deployments. Admin must always be proven by a
  // valid session OR a Replit-Auth user that resolves to the admin tenant.
  const settings = (req as any)._settingsCache;
  if (settings && !settings.accessPin) {
    const tenantId = getTenantFromRequest(req);
    return tenantId === ADMIN_TENANT_ID;
  }
  return false;
}

// R64.A — single doubly-gated platform-admin check. Use on routes that mutate
// global / cross-tenant state (provider keys, personas, skills, backups,
// purges, system config). Requires the request to (1) carry an admin session
// AND (2) resolve to the admin tenant. Sets the response and returns false on
// failure so callers can `if (!requirePlatformAdmin(req, res)) return;`.
export function requirePlatformAdmin(req: Request, res: Response): boolean {
  const tenantId = getTenantFromRequest(req);
  if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
    res.status(403).json({ error: "Platform admin access required" });
    return false;
  }
  return true;
}

// R74.13s — Non-failing platform-admin predicate. Same check as
// `requirePlatformAdmin` but does NOT write a response. Use this when a route
// behaves DIFFERENTLY (not 403) for non-admins — e.g. enrichment-style routes
// that fall through to a tenant-scoped result, or that need to inspect admin
// status before deciding which body shape to return. Use `requirePlatformAdmin`
// for hard-gate routes that always 403 non-admins.
export function isPlatformAdmin(req: Request): boolean {
  return getTenantFromRequest(req) === ADMIN_TENANT_ID && isAdminRequest(req);
}

export type ApiScope = "chat" | "read" | "tools" | "admin";

const SCOPE_RULES: Array<{ method?: string; pattern: RegExp; scopes: ApiScope[] }> = [
  { method: "POST", pattern: /^\/api\/conversations\/\d+\/messages$/, scopes: ["chat"] },
  { method: "POST", pattern: /^\/api\/conversations$/, scopes: ["chat"] },
  { method: "POST", pattern: /^\/api\/voice\//, scopes: ["chat"] },

  // R63.4 — Public API v1 (Claude Code skill surface)
  { method: "GET", pattern: /^\/api\/v1$/, scopes: ["read", "chat"] },
  { method: "GET", pattern: /^\/api\/v1\/agents$/, scopes: ["read", "chat"] },
  { method: "POST", pattern: /^\/api\/v1\/agents\/dispatch$/, scopes: ["chat"] },
  { method: "GET", pattern: /^\/api\/v1\/conversations\/\d+$/, scopes: ["read", "chat"] },
  { method: "GET", pattern: /^\/api\/v1\/video\/templates$/, scopes: ["read", "chat"] },
  { method: "POST", pattern: /^\/api\/v1\/agents\/produce-video$/, scopes: ["chat"] },

  { method: "GET", pattern: /^\/api\/conversations/, scopes: ["read", "chat"] },
  { method: "GET", pattern: /^\/api\/personas/, scopes: ["read"] },
  { method: "GET", pattern: /^\/api\/skills/, scopes: ["read"] },
  { method: "GET", pattern: /^\/api\/analytics/, scopes: ["read"] },
  { method: "GET", pattern: /^\/api\/settings$/, scopes: ["read"] },
  { method: "GET", pattern: /^\/api\/knowledge/, scopes: ["read"] },
  { method: "GET", pattern: /^\/api\/projects/, scopes: ["read"] },

  { method: "POST", pattern: /^\/api\/tools\//, scopes: ["tools"] },
  { method: "POST", pattern: /^\/api\/browser\//, scopes: ["tools"] },
  { method: "POST", pattern: /^\/api\/research\//, scopes: ["tools"] },

  { method: "PUT", pattern: /^\/api\/settings$/, scopes: ["admin"] },
  { method: "DELETE", pattern: /^\/api\//, scopes: ["admin"] },
  { method: "POST", pattern: /^\/api\/tenants/, scopes: ["admin"] },
  { pattern: /^\/api\/admin\//, scopes: ["admin"] },
  { method: "POST", pattern: /^\/api\/api-keys/, scopes: ["admin"] },
  { method: "PUT", pattern: /^\/api\/personas/, scopes: ["admin"] },
  { method: "POST", pattern: /^\/api\/personas/, scopes: ["admin"] },
  { method: "PUT", pattern: /^\/api\/skills/, scopes: ["admin"] },
  { method: "POST", pattern: /^\/api\/skills/, scopes: ["admin"] },
];

function checkApiKeyScopes(req: Request): { error: string; requiredScopes?: string[]; yourScopes: string[] } | null {
  const scopes: string[] | undefined = (req as any).apiKeyScopes;
  if (!scopes) return null;
  if (scopes.includes("admin")) return null;

  const path = (req.originalUrl || req.path).split("?")[0];
  const method = req.method.toUpperCase();

  for (const rule of SCOPE_RULES) {
    if (rule.method && rule.method !== method) continue;
    if (!rule.pattern.test(path)) continue;
    const hasScope = rule.scopes.some(s => scopes.includes(s));
    if (!hasScope) {
      return {
        error: `API key lacks required scope for ${method} ${path}`,
        requiredScopes: rule.scopes,
        yourScopes: scopes,
      };
    }
    return null;
  }

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    const readScopes: ApiScope[] = ["read", "chat"];
    if (readScopes.some(s => scopes.includes(s))) return null;
    return { error: "API key lacks read access", yourScopes: scopes };
  }

  return {
    error: "API key does not have permission for this endpoint. Use an admin-scoped key for full access.",
    yourScopes: scopes,
  };
}

export function requireScope(...requiredScopes: ApiScope[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const scopes: string[] | undefined = (req as any).apiKeyScopes;
    if (!scopes) return next();
    if (scopes.includes("admin")) return next();
    const hasScope = requiredScopes.some(s => scopes.includes(s));
    if (!hasScope) {
      return res.status(403).json({
        error: `API key lacks required scope. Needs one of: ${requiredScopes.join(", ")}`,
      });
    }
    return next();
  };
}

// Public path skip-list. Normalize callers' paths the same way before checking
// (lowercase + strip trailing slash) so `/api/Health/` and `/.WELL-KNOWN/Agent.JSON/`
// don't fail-CLOSED into a 401 the way the original strict-equality form did.
const PUBLIC_EXACT_PATHS = new Set<string>([
  "/api/auth/login",
  "/api/auth/status",
  "/api/health",
  "/api/tenants/register",
  "/api/tenants/login",
  "/api/login",
  "/api/logout",
  "/api/callback",
  "/api/auth/user",
  "/api/oauth-subscriptions/callback",
  "/api/cron/refresh-oauth-tokens",
  "/api/youtube/connect",
  "/api/youtube/callback",
  "/api/v1",
  "/.well-known/agent.json",
]);
const PUBLIC_PATH_PREFIXES = ["/api/public/", "/api/hooks/twilio/", "/api/slack/", "/api/c/"];

// Owner-managed public-chat sub-paths under `/api/public-chat/` that DO require
// auth (everything else under that prefix is the anonymous visitor surface
// keyed by an opaque token in the path and must be reachable without a session).
const PUBLIC_CHAT_OWNER_SUBPATHS = new Set<string>([
  "config",
  "enable",
  "disable",
  "vanity-slug",
]);

function isPublicPath(rawPath: string): boolean {
  // Strip query, lowercase, strip a single trailing slash (but keep "/").
  let p = (rawPath || "").split("?")[0].toLowerCase();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (PUBLIC_EXACT_PATHS.has(p)) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  // Anonymous visitor surface: `/api/public-chat/<token>/...` is public, but
  // `/api/public-chat/{config,enable,disable,vanity-slug}` is owner-only.
  // Canonicalize the first segment (decode + lowercase) before checking the
  // owner set so percent-encoded variants like `%63onfig` cannot bypass the
  // auth gate by matching neither the owner set nor a known token shape.
  if (p.startsWith("/api/public-chat/")) {
    const rawSeg = p.slice("/api/public-chat/".length).split("/")[0];
    if (!rawSeg) return false;
    let canonSeg: string;
    try {
      canonSeg = decodeURIComponent(rawSeg).toLowerCase();
    } catch {
      // Malformed encoding — fail CLOSED (treat as non-public, force auth).
      return false;
    }
    if (!PUBLIC_CHAT_OWNER_SUBPATHS.has(canonSeg)) return true;
  }
  return false;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const fullPath = req.originalUrl?.split("?")[0] || req.path;
  if (isPublicPath(fullPath)) {
    // /api/cron/refresh-oauth-tokens is gated by CRON_SECRET inside the
    // handler — no session/cookie auth needed so external uptime services
    // (UptimeRobot, cron-job.org, Replit Scheduled Deployments) can ping it.
    // /api/v1 (discovery) is intentionally public so external agents can
    // crawl the contract before having a key. All other /api/v1/* routes
    // still require a vc_* key via requireApiKeyOnly.
    return next();
  }

  const settings = await storage.getSettings();
  (req as any)._settingsCache = settings;

  const token = req.headers.authorization?.replace("Bearer ", "");

  // R94 SECURITY — wrap next() in AsyncLocalStorage tenant context so that
  // downstream singleton clients (replitOpenai, createMeteredOpenAIClient)
  // can attribute cost to the authenticated tenant without every callsite
  // threading tenantId explicitly. See server/lib/tenant-context.ts.
  const { runWithTenant } = await import("./lib/tenant-context");

  if (token) {
    if (token.startsWith("vc_")) {
      const apiKeyResult = await validateApiKey(token, req);
      if (!apiKeyResult) return res.status(401).json({ error: "Invalid or revoked API key" });
      const scopeDenied = checkApiKeyScopes(req);
      if (scopeDenied) return res.status(403).json(scopeDenied);
      const apiTid = (req as any).tenantId;
      if (typeof apiTid === "number") return runWithTenant(apiTid, "api-key", () => next());
      return next();
    }

    const session = await getSession(token);
    if (session) {
      (req as any).tenantId = session.tenantId;
      return runWithTenant(session.tenantId, "session", () => next());
    }
  }

  const replitUser = getReplitAuthUser(req);
  if (replitUser) {
    const replitTid = await getOrCreateTenantForReplitUser(
      replitUser.sub,
      replitUser.email,
      [replitUser.firstName, replitUser.lastName].filter(Boolean).join(" ") || null
    );
    if (typeof replitTid === "number") {
      (req as any).tenantId = replitTid;
      return runWithTenant(replitTid, "replit-oidc", () => next());
    }
    return next();
  }

  return res.status(401).json({ error: "Authentication required", needsAuth: true });
}

export async function handleLogin(req: Request, res: Response) {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(clientIp);
  if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS) {
    const elapsed = Date.now() - attempt.lastAttempt;
    if (elapsed < LOGIN_LOCKOUT_MS) {
      const remainMin = Math.ceil((LOGIN_LOCKOUT_MS - elapsed) / 60000);
      return res.status(429).json({ error: `Too many attempts. Try again in ${remainMin} minutes.` });
    }
    loginAttempts.delete(clientIp);
  }

  const { pin } = req.body;
  if (!pin || typeof pin !== "string") {
    return res.status(400).json({ error: "PIN required" });
  }

  const settings = await storage.getSettings();
  if (!settings?.accessPin) {
    return res.status(400).json({ error: "No PIN configured" });
  }

  if (!verifyPin(pin, settings.accessPin)) {
    const current = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0 };
    setLoginAttempt(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
    return res.status(403).json({ error: "Invalid PIN" });
  }

  loginAttempts.delete(clientIp);
  const token = await createSession(ADMIN_TENANT_ID, true);

  res.json({ token, expiresIn: SESSION_MAX_AGE, tenantId: ADMIN_TENANT_ID, isAdmin: true });
}

export async function handleTenantRegister(req: Request, res: Response) {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  if (typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  const [existing] = await db.select().from(tenants).where(eq(tenants.email, email.toLowerCase().trim()));
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = hashPassword(password);
  const [tenant] = await db.insert(tenants).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    name: name.trim(),
    plan: "trial",
    trialMaxConversations: 5,
    isActive: true,
  }).returning();

  const token = await createSession(tenant.id, false);

  try {
    await getVerificationTableReady();
    const verificationCode = await storeVerificationCode(tenant.id, tenant.email!);
    const { sendVerificationEmail, sendWelcomeEmail } = await import("./email-notifications");
    await sendVerificationEmail(tenant.email!, verificationCode);
    sendWelcomeEmail(tenant.email!, tenant.name).catch(() => {});
  } catch (err) {
    console.warn("[auth] Failed to send verification email:", (err as Error).message);
  }

  try {
    const { getOrCreateTenantInbox } = await import("./email");
    const inbox = await getOrCreateTenantInbox(tenant.id);
    console.log(`[auth] Provisioned inbox for new tenant ${tenant.id}: ${inbox.email}`);
  } catch (err) {
    console.warn("[auth] Failed to provision inbox for tenant:", (err as Error).message);
  }

  res.json({
    token,
    expiresIn: SESSION_MAX_AGE,
    tenantId: tenant.id,
    plan: tenant.plan,
    trialConversationsUsed: 0,
    trialMaxConversations: 5,
    isAdmin: false,
    emailVerified: false,
    email: tenant.email,
  });
}

export async function handleTenantLogin(req: Request, res: Response) {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(clientIp);
  if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS) {
    const elapsed = Date.now() - attempt.lastAttempt;
    if (elapsed < LOGIN_LOCKOUT_MS) {
      const remainMin = Math.ceil((LOGIN_LOCKOUT_MS - elapsed) / 60000);
      return res.status(429).json({ error: `Too many attempts. Try again in ${remainMin} minutes.` });
    }
    loginAttempts.delete(clientIp);
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.email, email.toLowerCase().trim()));
  if (!tenant) {
    const current = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0 };
    setLoginAttempt(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
    return res.status(403).json({ error: "Invalid email or password" });
  }

  if (!tenant.isActive) {
    return res.status(403).json({ error: "Account is disabled" });
  }

  if (!tenant.passwordHash || !verifyPassword(password, tenant.passwordHash)) {
    const current = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0 };
    setLoginAttempt(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
    return res.status(403).json({ error: "Invalid email or password" });
  }

  loginAttempts.delete(clientIp);
  const isAdminUser = !!tenant.isAdmin;
  const token = await createSession(tenant.id, isAdminUser);

  res.json({
    token,
    expiresIn: SESSION_MAX_AGE,
    tenantId: tenant.id,
    plan: tenant.plan,
    trialConversationsUsed: tenant.trialConversationsUsed,
    trialMaxConversations: tenant.trialMaxConversations,
    name: tenant.name,
    isAdmin: isAdminUser,
    emailVerified: (tenant as any).emailVerified ?? (tenant as any).email_verified ?? true,
    email: tenant.email,
    onboardingSeen: (tenant as any).onboardingSeen ?? (tenant as any).onboarding_seen ?? false,
  });
}

async function ensureEmailVerificationTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
    )
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false
  `).catch(() => {});
}

let verificationTableReady = false;
async function getVerificationTableReady() {
  if (!verificationTableReady) {
    await ensureEmailVerificationTable();
    verificationTableReady = true;
  }
}

function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

async function storeVerificationCode(tenantId: number, email: string): Promise<string> {
  await getVerificationTableReady();
  const code = generateVerificationCode();
  const expiresAt = Date.now() + 15 * 60 * 1000;
  // R74.13d C2: store HMAC(code) — DB read no longer yields a usable code.
  const codeHash = hashAuthSecret(code);
  await db.execute(sql`DELETE FROM email_verification_codes WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`
    INSERT INTO email_verification_codes (tenant_id, email, code, expires_at)
    VALUES (${tenantId}, ${email}, ${codeHash}, ${expiresAt})
  `);
  return code;
}

export async function handleVerifyEmail(req: Request, res: Response) {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Verification code is required" });

  const tenantId = await getTenantFromRequestAsync(req);
  if (!tenantId) return res.status(401).json({ error: "Authentication required" });

  await getVerificationTableReady();
  const result = await db.execute(sql`
    SELECT code, expires_at, email FROM email_verification_codes WHERE tenant_id = ${tenantId}
  `);
  const rows = (result as any).rows || result;
  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: "No verification code found. Please request a new one." });
  }

  const row = rows[0];
  if (Date.now() > Number(row.expires_at)) {
    return res.status(400).json({ error: "Verification code has expired. Please request a new one." });
  }

  // R74.13d C2: timing-safe compare against the HMAC stored in DB (legacy
  // plaintext rows still work via the backward-compat branch).
  if (!timingSafeCompareAuthSecret(code.toString().trim(), String(row.code))) {
    return res.status(400).json({ error: "Incorrect verification code" });
  }

  await db.execute(sql`UPDATE tenants SET email_verified = true WHERE id = ${tenantId}`);
  await db.execute(sql`DELETE FROM email_verification_codes WHERE tenant_id = ${tenantId}`);

  res.json({ verified: true });
}

export async function handleResendVerification(req: Request, res: Response) {
  const tenantId = await getTenantFromRequestAsync(req);
  if (!tenantId) return res.status(401).json({ error: "Authentication required" });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || !tenant.email) return res.status(400).json({ error: "No email on file" });

  await getVerificationTableReady();
  const code = await storeVerificationCode(tenantId, tenant.email);

  try {
    const { sendVerificationEmail } = await import("./email-notifications");
    await sendVerificationEmail(tenant.email, code);
  } catch (_silentErr) { logSilentCatch("server/auth.ts", _silentErr); }

  res.json({ sent: true });
}

const RESET_TOKEN_EXPIRY = 60 * 60 * 1000;

async function ensureResetTokensTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
    )
  `).catch(() => {});
}

let resetTableReady = false;
async function getResetTableReady() {
  if (!resetTableReady) {
    await ensureResetTokensTable();
    resetTableReady = true;
  }
}

// R74.13d C2: store HMAC(token) as the row key. The plaintext token only
// exists in the user's email link; a DB read yields only the hash, which is
// not a usable reset token. Lookup/delete must hash the incoming token first.
async function storeResetToken(token: string, tenantId: number, email: string, expiresAt: number) {
  await getResetTableReady();
  const tokenHash = hashAuthSecret(token);
  await db.execute(sql`
    INSERT INTO password_reset_tokens (token, tenant_id, email, expires_at)
    VALUES (${tokenHash}, ${tenantId}, ${email}, ${expiresAt})
  `);
}

async function getResetToken(token: string): Promise<{ tenantId: number; email: string; expiresAt: number } | null> {
  await getResetTableReady();
  const tokenHash = hashAuthSecret(token);
  const result = await db.execute(sql`
    SELECT tenant_id, email, expires_at FROM password_reset_tokens WHERE token = ${tokenHash}
  `);
  const rows = (result as any).rows || result;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return { tenantId: Number(row.tenant_id), email: row.email, expiresAt: Number(row.expires_at) };
}

async function deleteResetToken(token: string) {
  await getResetTableReady();
  const tokenHash = hashAuthSecret(token);
  await db.execute(sql`DELETE FROM password_reset_tokens WHERE token = ${tokenHash}`).catch(() => {});
}

async function cleanExpiredResetTokens() {
  await getResetTableReady();
  await db.execute(sql`DELETE FROM password_reset_tokens WHERE expires_at < ${Date.now()}`).catch(() => {});
}

setInterval(() => {
  cleanExpiredResetTokens().catch(() => {});
}, 10 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts) {
    if (now - attempt.lastAttempt > LOGIN_LOCKOUT_MS * 2) {
      loginAttempts.delete(ip);
    }
  }
  for (const [token, session] of sessionCache) {
    if (now > session.expiresAt) {
      sessionCache.delete(token);
    }
  }
  if (tenantCacheByReplitUser.size > 1000) {
    tenantCacheByReplitUser.clear();
  }
}, 15 * 60 * 1000);

export async function handleForgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Email is required" });

  const normalized = email.toLowerCase().trim();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.email, normalized));

  res.json({ message: "If an account exists with that email, a password reset link has been sent." });

  if (!tenant) return;

  const token = crypto.randomBytes(32).toString("hex");
  await storeResetToken(token, tenant.id, normalized, Date.now() + RESET_TOKEN_EXPIRY);

  try {
    const allowedHostsEnv = process.env.ALLOWED_HOSTS || "";
    const productionDomain = process.env.PRODUCTION_DOMAIN || process.env.SITE_WEBSITE_URL?.replace(/^https?:\/\//, "") || "";
    const defaultHosts = productionDomain ? [productionDomain, "localhost:5000"] : ["localhost:5000"];
    const ALLOWED_HOSTS = allowedHostsEnv ? allowedHostsEnv.split(",").map(h => h.trim()) : defaultHosts;
    const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000");
    const host = ALLOWED_HOSTS.includes(rawHost) ? rawHost : (ALLOWED_HOSTS[0] || "localhost:5000");
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;
    const { sendPasswordResetEmail } = await import("./email-notifications");
    await sendPasswordResetEmail(normalized, tenant.name || "User", token, baseUrl);
  } catch (err) {
    console.warn("[auth] Failed to send password reset email:", (err as Error).message);
  }
}

export async function handleResetPassword(req: Request, res: Response) {
  const { token, password } = req.body;
  if (!token || typeof token !== "string" || !password || typeof password !== "string") return res.status(400).json({ error: "Token and new password are required" });

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  const resetData = await getResetToken(token);
  if (!resetData || Date.now() > resetData.expiresAt) {
    return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
  }

  const newHash = hashPassword(password);
  await db.update(tenants).set({ passwordHash: newHash }).where(eq(tenants.id, resetData.tenantId));
  await deleteResetToken(token);

  await db.execute(sql`DELETE FROM auth_sessions WHERE tenant_id = ${resetData.tenantId} AND is_admin = false`).catch(() => {});
  for (const [sessionToken, session] of sessionCache) {
    if (session.tenantId === resetData.tenantId && !session.isAdmin) {
      sessionCache.delete(sessionToken);
    }
  }

  res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
}

export async function handleAuthStatus(_req: Request, res: Response) {
  const settings = await storage.getSettings();
  res.json({
    authRequired: !!settings?.accessPin,
    configured: !!settings?.accessPin,
  });
}

export async function setAccessPin(pin: string): Promise<string> {
  return hashPin(pin);
}

export async function clearExpiredSessions(): Promise<void> {
  const now = Date.now();
  for (const [token, session] of sessionCache) {
    if (now > session.expiresAt) {
      sessionCache.delete(token);
    }
  }
  await db.execute(sql`DELETE FROM auth_sessions WHERE expires_at < ${now}`).catch(() => {});
}

export async function clearAllSessions(): Promise<void> {
  sessionCache.clear();
  await db.execute(sql`DELETE FROM auth_sessions`).catch(() => {});
}

export async function loadSessionsFromDb(): Promise<void> {
  try {
    const now = Date.now();
    await db.execute(sql`DELETE FROM auth_sessions WHERE expires_at < ${now}`).catch(() => {});

    const result = await db.execute(sql`SELECT token, tenant_id, is_admin, expires_at FROM auth_sessions`);
    const rows = (result as any).rows || result;
    if (!rows) return;

    let loaded = 0;
    for (const row of rows) {
      const expiresAt = Number(row.expires_at);
      if (now < expiresAt) {
        sessionCache.set(row.token, {
          tenantId: Number(row.tenant_id),
          isAdmin: Boolean(row.is_admin),
          expiresAt,
        });
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[auth] Loaded ${loaded} active sessions from database`);
    }

    setInterval(() => {
      clearExpiredSessions().catch(() => {});
    }, 60 * 60 * 1000);
  } catch (err) {
    console.warn("[auth] Could not load sessions from DB (table may not exist yet):", (err as Error).message);
  }
}

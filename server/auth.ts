import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { tenants, apiKeys } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn("[auth] WARNING: SESSION_SECRET not set. Using random secret (sessions will not survive restarts).");
}
const EFFECTIVE_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PIN_SALT = "visionclaw-pin-v1";

export const ADMIN_TENANT_ID = 1;

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const sessionCache = new Map<string, { tenantId: number; isAdmin: boolean; expiresAt: number }>();

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

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
  const isOwner = (replitOwner && (
    (name && name.toLowerCase().includes(replitOwner.toLowerCase())) ||
    (email && email.toLowerCase().includes(replitOwner.toLowerCase())) ||
    replitUserId.toLowerCase().includes(replitOwner.toLowerCase())
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

  const settings = (req as any)._settingsCache;
  if (settings && !settings.accessPin) {
    const tenantId = getTenantFromRequest(req);
    return tenantId === ADMIN_TENANT_ID || tenantId === null;
  }
  return false;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const fullPath = req.originalUrl?.split("?")[0] || req.path;
  if (fullPath === "/api/auth/login" || fullPath === "/api/auth/status" ||
      fullPath === "/api/health" || fullPath.startsWith("/api/public/") ||
      fullPath === "/api/tenants/register" || fullPath === "/api/tenants/login" ||
      fullPath === "/api/login" || fullPath === "/api/logout" ||
      fullPath === "/api/callback" || fullPath === "/api/auth/user" ||
      fullPath === "/api/oauth-subscriptions/callback" ||
      fullPath === "/api/youtube/connect" || fullPath === "/api/youtube/callback") {
    return next();
  }

  const settings = await storage.getSettings();
  (req as any)._settingsCache = settings;

  const token = req.headers.authorization?.replace("Bearer ", "");

  if (token) {
    if (token.startsWith("vc_")) {
      const apiKeyResult = await validateApiKey(token, req);
      if (apiKeyResult) return next();
      return res.status(401).json({ error: "Invalid or revoked API key" });
    }

    const session = await getSession(token);
    if (session) {
      return next();
    }
  }

  const replitUser = getReplitAuthUser(req);
  if (replitUser) {
    await getOrCreateTenantForReplitUser(
      replitUser.sub,
      replitUser.email,
      [replitUser.firstName, replitUser.lastName].filter(Boolean).join(" ") || null
    );
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
    loginAttempts.set(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
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
    loginAttempts.set(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
    return res.status(403).json({ error: "Invalid email or password" });
  }

  if (!tenant.isActive) {
    return res.status(403).json({ error: "Account is disabled" });
  }

  if (!tenant.passwordHash || !verifyPassword(password, tenant.passwordHash)) {
    const current = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0 };
    loginAttempts.set(clientIp, { count: current.count + 1, lastAttempt: Date.now() });
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
  await db.execute(sql`DELETE FROM email_verification_codes WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`
    INSERT INTO email_verification_codes (tenant_id, email, code, expires_at)
    VALUES (${tenantId}, ${email}, ${code}, ${expiresAt})
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

  if (row.code !== code.toString().trim()) {
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
  } catch {}

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

async function storeResetToken(token: string, tenantId: number, email: string, expiresAt: number) {
  await getResetTableReady();
  await db.execute(sql`
    INSERT INTO password_reset_tokens (token, tenant_id, email, expires_at)
    VALUES (${token}, ${tenantId}, ${email}, ${expiresAt})
  `);
}

async function getResetToken(token: string): Promise<{ tenantId: number; email: string; expiresAt: number } | null> {
  await getResetTableReady();
  const result = await db.execute(sql`
    SELECT tenant_id, email, expires_at FROM password_reset_tokens WHERE token = ${token}
  `);
  const rows = (result as any).rows || result;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return { tenantId: Number(row.tenant_id), email: row.email, expiresAt: Number(row.expires_at) };
}

async function deleteResetToken(token: string) {
  await getResetTableReady();
  await db.execute(sql`DELETE FROM password_reset_tokens WHERE token = ${token}`).catch(() => {});
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

import type { Express, Request, Response } from "express";
import * as oidc from "openid-client";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { getOrCreateTenantForReplitUser } from "./auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { AGENTID_ISSUER, agentIdEnabled, agentIdIdentity, agentIdRedirectUri } from "./lib/agentid-identity";

type PendingLogin = { state: string; nonce: string; verifier: string; expiresAt: number };
type AgentSession = Request["session"] & { agentidPending?: PendingLogin };
let discovery: Promise<oidc.Configuration> | undefined;
let discoveryExpires = 0;
let callbackConfigWarningEmitted = false;

export async function agentIdConfiguration(): Promise<oidc.Configuration> {
  if (!agentIdEnabled()) throw new Error("AgentID disabled");
  if (!discovery || Date.now() >= discoveryExpires) {
    discoveryExpires = Date.now() + 60 * 60 * 1000;
    discovery = oidc.discovery(
      new URL(AGENTID_ISSUER),
      process.env.AGENTID_CLIENT_ID!,
      { id_token_signed_response_alg: "ES256" },
      oidc.ClientSecretBasic(process.env.AGENTID_CLIENT_SECRET!),
      { timeout: 10, execute: [oidc.enableNonRepudiationChecks] },
    ).then(config => {
      const metadata = config.serverMetadata();
      for (const [key, expected] of Object.entries({
        issuer: AGENTID_ISSUER,
        authorization_endpoint: `${AGENTID_ISSUER}/v0/authorize`,
        token_endpoint: `${AGENTID_ISSUER}/v0/token`,
        jwks_uri: `${AGENTID_ISSUER}/v0/jwks.json`,
      })) {
        if (metadata[key] !== expected) throw new Error("AgentID discovery endpoint mismatch");
      }
      config.timeout = 10;
      return config;
    }).catch(error => {
      discovery = undefined;
      discoveryExpires = 0;
      throw error;
    });
  }
  return discovery;
}

function availability(req: Request): { available: boolean; reason: "disabled" | "preview" | "misconfigured" | "ready" } {
  if (!agentIdEnabled()) return { available: false, reason: "disabled" };
  try {
    const callback = agentIdRedirectUri();
    callbackConfigWarningEmitted = false;
    // Never rely on forwarded-host: Express trusts it when trust proxy is set.
    // Workspace dev requests cannot enable this production-registered callback.
    const available = process.env.NODE_ENV === "production" &&
      typeof req.headers.host === "string" &&
      req.headers.host.toLowerCase() === callback.host.toLowerCase();
    return { available, reason: available ? "ready" : "preview" };
  } catch {
    if (!callbackConfigWarningEmitted) {
      console.warn("[agentid-auth] callback configuration invalid; sign-in unavailable");
      callbackConfigWarningEmitted = true;
    }
    return { available: false, reason: "misconfigured" };
  }
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

function failure(res: Response, code: "failed" | "expired" | "unavailable") {
  res.set("Cache-Control", "no-store");
  return res.redirect(`/login?agentid_error=${code}`);
}

// A session-bound PostgreSQL CAS consumes the challenge across processes.
// This is anonymous pre-auth state: the signed session ID, not a tenant ID,
// is the authority boundary. No caller-supplied identity is used as a selector.
export async function consumeAgentIdPending(req: Request, state: unknown): Promise<PendingLogin | null> {
  const session = req.session as AgentSession;
  const pending = session?.agentidPending;
  if (!pending || typeof state !== "string" || state !== pending.state ||
      pending.expiresAt <= Date.now()) return null;
  const result = await db.execute(sql`
    UPDATE sessions SET sess = (sess::jsonb - 'agentidPending')::json
    WHERE sid = ${req.sessionID} AND expire > NOW()
      AND sess::jsonb #>> '{agentidPending,state}' = ${pending.state}
    RETURNING sid
  `);
  if (!(result as any).rows?.length) return null;
  delete session.agentidPending;
  return pending;
}

export function registerAgentIdRoutes(app: Express): void {
  const initiationLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const callbackLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

  app.get("/api/auth/agentid/config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ enabled: agentIdEnabled(), ...availability(req) });
  });

  app.get("/api/auth/agentid/login", initiationLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!availability(req).available || !req.session) return failure(res, "unavailable");
    try {
      const config = await agentIdConfiguration();
      const pending: PendingLogin = {
        state: oidc.randomState(), nonce: oidc.randomNonce(),
        verifier: oidc.randomPKCECodeVerifier(), expiresAt: Date.now() + 10 * 60 * 1000,
      };
      (req.session as AgentSession).agentidPending = pending;
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: agentIdRedirectUri().href, scope: "openid email profile",
        state: pending.state, nonce: pending.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(pending.verifier),
        code_challenge_method: "S256",
      });
      await saveSession(req);
      res.redirect(url.href);
    } catch {
      // Never log provider errors: they can contain tokens, codes or credentials.
      console.warn("[agentid-auth] authorization initialization failed");
      failure(res, "failed");
    }
  });

  app.get("/api/auth/agentid/callback", callbackLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!availability(req).available || !req.session) return failure(res, "unavailable");
    try {
      const pending = await consumeAgentIdPending(req, req.query.state);
      if (!pending) return failure(res, "expired");
      const callback = agentIdRedirectUri();
      callback.search = new URL(req.originalUrl, callback).search;
      const tokens = await oidc.authorizationCodeGrant(await agentIdConfiguration(), callback, {
        pkceCodeVerifier: pending.verifier, expectedState: pending.state,
        expectedNonce: pending.nonce, idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000) {
        throw new Error("Invalid AgentID token");
      }
      const identity = agentIdIdentity(claims.sub);
      const name = typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim().slice(0, 120) : "AgentID Agent";
      // An opaque reserved address prevents email/owner_email account linking.
      const email = `${identity.slice("agentid:".length)}@agentid.identity.invalid`;
      await getOrCreateTenantForReplitUser(identity, null, name, "agentid");
      await authStorage.upsertUser({ id: identity, email, firstName: name, lastName: null });
      // Passport rotates the session ID on login; never keep provider tokens.
      await new Promise<void>((resolve, reject) => req.logIn({
        provider: "agentid",
        claims: { sub: identity, email, first_name: name, exp: claims.exp },
        expires_at: claims.exp,
      } as any, error => error ? reject(error) : resolve()));
      await saveSession(req);
      console.info("[agentid-auth] sign-in completed for isolated agent identity");
      res.redirect("/");
    } catch {
      console.warn("[agentid-auth] callback rejected");
      failure(res, "failed");
    }
  });
}

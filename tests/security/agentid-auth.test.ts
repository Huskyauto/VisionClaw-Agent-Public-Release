import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import express from "express";
import rateLimit from "express-rate-limit";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";
import * as oidc from "openid-client";
import { AGENTID_ISSUER, agentIdIdentity, agentIdRedirectUri } from "../../server/lib/agentid-identity";

function declaration(file: string, name: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(source);
}

function load(source: string, globals: Record<string, unknown>) {
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs", target: "node22" }).code,
    { module, exports: module.exports, URL, URLSearchParams, console, ...globals });
  return module.exports;
}

const callbackUri = "https://agenticcorporation.net/api/auth/agentid/callback";
const identity = agentIdIdentity("fixture-agent");

test("agent tenants never link owner email, remain isolated and provision idempotently", async () => {
  const rows: any[] = [];
  const selectors: any[] = [];
  let inserts = 0;
  const cache = new Map();
  const { getOrCreateTenantForReplitUser: resolve } = load(declaration("server/auth.ts", "getOrCreateTenantForReplitUser"), {
    agentIdEnabled: () => true,
    tenantCacheByReplitUser: cache, ADMIN_TENANT_ID: 1,
    process: { get env() { throw new Error("AgentID must not inspect owner email"); } },
    tenants: { replitUserId: "subject" }, eq: (column: string, value: string) => ({ column, value }),
    db: {
      select: () => ({ from: () => ({ where: async (selector: any) => {
        selectors.push(selector); return rows.filter(row => row.replitUserId === selector.value);
      } }) }),
      insert: () => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => {
        inserts++; rows.push({ ...value, id: 2 }); return rows;
      } }) }) }),
    },
  });
  assert.equal(await resolve(identity, "owner@example.test", "Agent", "agentid"), 2);
  assert.equal(await resolve(identity, "other@example.test", "Changed", "agentid"), 2);
  assert.equal(inserts, 1);
  assert.equal(rows[0].isAdmin, false);
  assert.equal(rows[0].trialMaxConversations, 5);
  assert.ok(rows[0].email.endsWith("@agentid.identity.invalid"));
  assert.ok(selectors.every(item => item.column === "subject" && item.value === identity));
  assert.equal(cache.get(identity).isAdmin, false);
  await assert.rejects(resolve(identity, "owner@example.test", "Agent", "replit"), /Reserved identity/);
});

for (const tenant of [
  { id: 1, isActive: true, isAdmin: false },
  { id: 2, isActive: true, isAdmin: true },
  { id: 2, isActive: false, isAdmin: false },
]) {
  test(`agent identity refuses unavailable/admin tenant ${JSON.stringify(tenant)}`, async () => {
    const { getOrCreateTenantForReplitUser: resolve } = load(declaration("server/auth.ts", "getOrCreateTenantForReplitUser"), {
      agentIdEnabled: () => true, ADMIN_TENANT_ID: 1, tenantCacheByReplitUser: new Map(),
      tenants: { replitUserId: "subject" }, eq: () => ({}),
      db: { select: () => ({ from: () => ({ where: async () => [tenant] }) }) },
    });
    await assert.rejects(resolve(identity, null, "Agent", "agentid"), /workspace is unavailable/);
  });
}

function flowFixture(options: { badSignature?: boolean; wrongNonce?: boolean; expired?: boolean; wrongIssuer?: boolean; wrongAudience?: boolean; development?: boolean; database?: any; misconfigured?: boolean } = {}) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const otherKeys = options.badSignature ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }) : keys;
  let enabled = true;
  const routes = new Map<string, any>();
  const routeHandlers = new Map<string, any[]>();
  const writes: any[] = [];
  const exchanges: any[] = [];
  let pendingUsed = false;
  const metadata = {
    issuer: AGENTID_ISSUER, authorization_endpoint: `${AGENTID_ISSUER}/v0/authorize`,
    token_endpoint: `${AGENTID_ISSUER}/v0/token`, jwks_uri: `${AGENTID_ISSUER}/v0/jwks.json`,
    authorization_response_iss_parameter_supported: true, id_token_signing_alg_values_supported: ["ES256"],
  };
  const config = new oidc.Configuration(metadata, "fixture-client", { id_token_signed_response_alg: "ES256" },
    oidc.ClientSecretBasic("fixture-secret"));
  oidc.enableNonRepudiationChecks(config);
  const req: any = {
    hostname: "agenticcorporation.net", headers: { host: "agenticcorporation.net" }, sessionID: "fixture-signed-session",
    session: { save: (cb: any) => cb() },
    logIn: (user: any, cb: any) => { writes.push({ op: "session", user }); cb(); },
  };
  config[oidc.customFetch] = async (url: any, init: any) => {
    if (String(url) === metadata.jwks_uri) {
      return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "fixture", alg: "ES256", use: "sig" }] });
    }
    assert.equal(String(url), metadata.token_endpoint);
    exchanges.push(init);
    const header = new Headers(init.headers);
    const basic = header.get("authorization");
    assert.ok(basic?.startsWith("Basic "));
    assert.deepEqual(Buffer.from(basic.slice(6), "base64").toString().split(":").map(decodeURIComponent),
      ["fixture-client", "fixture-secret"]);
    assert.equal(new URLSearchParams(init.body).get("code_verifier"), req.session.fixtureVerifier);
    const part = (value: any) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${part({ alg: "ES256", kid: "fixture" })}.${part({
      iss: options.wrongIssuer ? "https://wrong-issuer.example" : AGENTID_ISSUER,
      sub: "fixture-agent", aud: options.wrongAudience ? "another-client" : "fixture-client",
      exp: Math.floor(Date.now() / 1000) + (options.expired ? -60 : 600),
      iat: Math.floor(Date.now() / 1000), name: "Fixture Agent",
      email: "owner@example.test", owner_email: "owner@example.test",
      nonce: options.wrongNonce ? "wrong-nonce" : req.session.fixtureNonce,
    })}`;
    const signature = sign("sha256", Buffer.from(unsigned), { key: otherKeys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return Response.json({ access_token: "fixture-access", token_type: "Bearer", expires_in: 600, id_token: `${unsigned}.${signature}` });
  };
  const source = readFileSync("server/agentid-auth.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  const module = load(source, {
    oidc: { ...oidc, discovery: async () => config },
    agentIdEnabled: () => enabled, agentIdIdentity,
    agentIdRedirectUri: () => agentIdRedirectUri({ AGENTID_REDIRECT_URI: options.misconfigured ? "" : callbackUri }),
    AGENTID_ISSUER,
    process: { env: { NODE_ENV: options.development ? "development" : "production",
      AGENTID_CLIENT_ID: "fixture-client", AGENTID_CLIENT_SECRET: "fixture-secret" } },
    rateLimit,
    sql: (strings: TemplateStringsArray, ...values: any[]) => ({ text: strings.join("?"), values }),
    db: options.database || { execute: async (q: any) => {
      assert.match(q.text, /WHERE sid = \?.*expire > NOW()/s);
      assert.deepEqual(Array.from(q.values), ["fixture-signed-session", req.session.fixtureState]);
      if (pendingUsed) return { rows: [] };
      pendingUsed = true; return { rows: [{ sid: "fixture-signed-session" }] };
    } },
    getOrCreateTenantForReplitUser: async (...args: any[]) => { writes.push({ op: "tenant", args }); return 2; },
    authStorage: { upsertUser: async (user: any) => { writes.push({ op: "user", user }); } },
  });
  module.registerAgentIdRoutes({ get: (path: string, ...handlers: any[]) => {
    routes.set(path, handlers.at(-1)); routeHandlers.set(path, handlers);
  } });
  const res: any = { target: "", body: null, set: () => res,
    redirect: (target: string) => { res.target = target; return res; },
    json: (body: any) => { res.body = body; return res; } };
  async function start() {
    await routes.get("/api/auth/agentid/login")(req, res);
    const url = new URL(res.target);
    req.session.fixtureState = url.searchParams.get("state");
    req.session.fixtureNonce = url.searchParams.get("nonce");
    req.session.fixtureVerifier = req.session.agentidPending.verifier;
    req.query = { state: req.session.fixtureState };
    req.originalUrl = `/api/auth/agentid/callback?code=fixture-code&state=${req.session.fixtureState}&iss=${encodeURIComponent(AGENTID_ISSUER)}`;
    return url;
  }
  return { routes, routeHandlers, req, res, start, writes, exchanges,
    consume: module.consumeAgentIdPending, disable: () => { enabled = false; } };
}

test("real OIDC code flow verifies ES256 and binds PKCE, nonce, state and Basic auth before login", async () => {
  const f = flowFixture();
  const url = await f.start();
  assert.equal(url.origin, AGENTID_ISSUER);
  assert.equal(url.searchParams.get("redirect_uri"), callbackUri);
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("state"));
  assert.ok(url.searchParams.get("nonce"));
  await f.routes.get("/api/auth/agentid/callback")(f.req, f.res);
  assert.equal(f.res.target, "/");
  assert.equal(f.writes.length, 3);
  assert.deepEqual(Array.from(f.writes[0].args), [identity, null, "Fixture Agent", "agentid"]);
  const sessionUser = f.writes[2].user;
  assert.equal(sessionUser.provider, "agentid");
  assert.equal(sessionUser.claims.sub, identity);
  assert.equal(sessionUser.access_token, undefined);
  assert.equal(sessionUser.refresh_token, undefined);
  assert.equal(sessionUser.claims.owner_email, undefined);
  await f.routes.get("/api/auth/agentid/callback")(f.req, f.res);
  assert.equal(f.res.target, "/login?agentid_error=expired");
  assert.equal(f.exchanges.length, 1, "replayed challenge never exchanges again");
});

for (const options of [{ badSignature: true }, { wrongNonce: true }, { expired: true }, { wrongIssuer: true }, { wrongAudience: true }]) {
  test(`untrusted OIDC token fails before provisioning ${JSON.stringify(options)}`, async () => {
    const f = flowFixture(options);
    await f.start();
    await f.routes.get("/api/auth/agentid/callback")(f.req, f.res);
    assert.equal(f.res.target, "/login?agentid_error=failed");
    assert.equal(f.writes.length, 0);
  });
}

test("wrong state, disabled feature and preview host never exchange a token", async () => {
  const f = flowFixture();
  await f.start();
  f.req.query.state = "foreign-session";
  await f.routes.get("/api/auth/agentid/callback")(f.req, f.res);
  assert.equal(f.res.target, "/login?agentid_error=expired");
  assert.equal(f.req.session.agentidPending.state, f.req.session.fixtureState);
  f.disable();
  await f.routes.get("/api/auth/agentid/callback")(f.req, f.res);
  assert.equal(f.res.target, "/login?agentid_error=unavailable");
  const preview = flowFixture();
  preview.req.hostname = "preview.replit.dev";
  preview.req.headers.host = "preview.replit.dev";
  await preview.routes.get("/api/auth/agentid/config")(preview.req, preview.res);
  assert.equal(preview.res.body.available, false);
  await preview.routes.get("/api/auth/agentid/login")(preview.req, preview.res);
  assert.equal(preview.res.target, "/login?agentid_error=unavailable");
  assert.equal(f.exchanges.length + preview.exchanges.length, 0);
  assert.equal(f.writes.length + preview.writes.length, 0);
});

test("forwarded-host cannot make a preview available, and development cannot initiate even with spoofed raw Host", async () => {
  const f = flowFixture();
  f.req.hostname = "agenticcorporation.net"; // Express's forwarded-host value.
  f.req.headers = { host: "preview.replit.dev", "x-forwarded-host": "agenticcorporation.net" };
  await f.routes.get("/api/auth/agentid/config")(f.req, f.res);
  assert.equal(f.res.body.available, false);
  const dev = flowFixture({ development: true });
  await dev.routes.get("/api/auth/agentid/login")(dev.req, dev.res);
  assert.equal(dev.res.target, "/login?agentid_error=unavailable");
  assert.equal(dev.exchanges.length, 0);
});

test("invalid callback configuration is not mislabeled as normal preview availability", async () => {
  const f = flowFixture({ misconfigured: true });
  await f.routes.get("/api/auth/agentid/config")(f.req, f.res);
  assert.equal(f.res.body.enabled, true);
  assert.equal(f.res.body.available, false);
  assert.equal(f.res.body.reason, "misconfigured");
  await f.routes.get("/api/auth/agentid/login")(f.req, f.res);
  assert.equal(f.res.target, "/login?agentid_error=unavailable");
  assert.equal(f.exchanges.length, 0);
});

test("tenth real HTTP initiation still has an independent callback allowance", async () => {
  const f = flowFixture();
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    req.session = f.req.session;
    Object.assign(req, { sessionID: f.req.sessionID, logIn: f.req.logIn });
    next();
  });
  for (const [path, handlers] of f.routeHandlers) app.get(path, ...handlers);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const port = (server.address() as any).port;
    // Browser fetch forbids setting Host; use a real HTTP request for this
    // canonical-origin server test rather than a forwarded-host surrogate.
    const call = (path: string) => new Promise<Response>((resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${port}${path}`,
        { headers: { host: "agenticcorporation.net" } }, incoming => {
          const chunks: Buffer[] = [];
          incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
          incoming.on("end", () => resolve(new Response(Buffer.concat(chunks), {
            status: incoming.statusCode || 500,
            headers: Object.fromEntries(Object.entries(incoming.headers)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)])),
          })));
        });
      request.on("error", reject);
      request.setTimeout(5000, () => request.destroy(new Error("HTTP fixture timeout")));
      request.end();
    });
    let last!: Response;
    for (let i = 0; i < 10; i++) {
      last = await call("/api/auth/agentid/login");
      assert.equal(last.status, 302);
    }
    assert.equal((await call("/api/auth/agentid/login")).status, 429);
    const url = new URL(last.headers.get("location")!);
    f.req.session.fixtureState = url.searchParams.get("state");
    f.req.session.fixtureNonce = url.searchParams.get("nonce");
    f.req.session.fixtureVerifier = f.req.session.agentidPending.verifier;
    const response = await call(`/api/auth/agentid/callback?code=fixture-code&state=${f.req.session.fixtureState}&iss=${encodeURIComponent(AGENTID_ISSUER)}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.equal(f.writes.length, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("PostgreSQL challenge CAS admits exactly one concurrent claimant", {
  skip: process.env.RUN_AGENTID_DB_CAS !== "1",
}, async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const f = flowFixture({ database: { execute: (q: any) => db.execute(q) } });
  await f.start();
  const sid = `agentid-test-${randomUUID()}`;
  f.req.sessionID = sid;
  const pending = { ...f.req.session.agentidPending };
  const req = () => ({ sessionID: sid, session: { agentidPending: { ...pending } } });
  // Use Drizzle's SQL tag with the actual production CAS declaration.
  const { consumeAgentIdPending } = load(declaration("server/agentid-auth.ts", "consumeAgentIdPending"), { db, sql });
  try {
    await db.execute(sql`INSERT INTO sessions(sid, sess, expire)
      VALUES (${sid}, ${JSON.stringify({ agentidPending: pending })}::json, NOW() + INTERVAL '10 minutes')`);
    const results = await Promise.all([consumeAgentIdPending(req(), pending.state), consumeAgentIdPending(req(), pending.state)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await consumeAgentIdPending(req(), pending.state), null);
  } finally {
    await db.execute(sql`DELETE FROM sessions WHERE sid = ${sid}`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import vm from "node:vm";
import test from "node:test";
import express from "express";
import session from "express-session";
import passport from "passport";
import ts from "typescript";
import { transformSync } from "esbuild";

// Execute production guards without application startup, credentials, provider
// calls or real customer data. Time is injected only into the fixture VM.
function extract(file: string, name: string) {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(d => d.name.getText(ast) === name)));
  assert.ok(node, `${file}: ${name}`);
  const text = node.getText(ast);
  return text.startsWith("export ") ? text : `export ${text}`;
}

function guards() {
  let now = 1_800_000_000;
  let enabled = true;
  let refreshes = 0;
  let discoveries = 0;
  const module = { exports: {} as any };
  const source = [
    extract("server/auth.ts", "getReplitAuthUser"),
    extract("server/replit_integrations/auth/replitAuth.ts", "isAuthenticated"),
  ].join("\n");
  vm.runInNewContext(
    transformSync(source, { loader: "ts", format: "cjs", target: "node22" }).code,
    {
      module, exports: module.exports, Date: { now: () => now * 1000 },
      agentIdEnabled: () => enabled,
      getOidcConfig: async () => { discoveries++; return {}; },
      client: { refreshTokenGrant: async () => { refreshes++; return { fixture: true }; } },
      updateUserSession: (user: any) => { user.expires_at = now + 60; },
    },
  );
  return {
    ...module.exports,
    now: () => now,
    setNow: (value: number) => { now = value; },
    disable: () => { enabled = false; },
    providerCalls: () => ({ refreshes, discoveries }),
  };
}

function agent(expires_at: unknown) {
  return { provider: "agentid", claims: { sub: "fixture-isolated-agent" }, expires_at };
}

async function invoke(g: any, user: any, authenticated = true) {
  let status: number | undefined;
  let nextCalls = 0;
  await g.isAuthenticated(
    { user, isAuthenticated: () => authenticated },
    { status: (value: number) => { status = value; return { json: () => {} }; } },
    () => { nextCalls++; },
  );
  return { status, nextCalls };
}

test("both AgentID guards deny at the exact signed expiry, not one second later", async () => {
  const g = guards();
  const user = agent(g.now());
  assert.equal(g.getReplitAuthUser({ user }), null);
  assert.deepEqual(await invoke(g, user), { status: 401, nextCalls: 0 });
});

test("AgentID access is allowed just before expiry and denied just after it", async () => {
  const g = guards();
  const user = agent(g.now() + 1);
  assert.equal(g.getReplitAuthUser({ user })?.provider, "agentid");
  assert.deepEqual(await invoke(g, user), { status: undefined, nextCalls: 1 });
  g.setNow(g.now() + 1.001);
  assert.equal(g.getReplitAuthUser({ user }), null);
  assert.deepEqual(await invoke(g, user), { status: 401, nextCalls: 0 });
  assert.deepEqual(g.providerCalls(), { refreshes: 0, discoveries: 0 });
});

test("expired AgentID sessions never enter the Replit refresh path", async () => {
  const g = guards();
  const user = { ...agent(g.now() - 1), refresh_token: "fixture-only-not-a-real-token" };
  assert.deepEqual(await invoke(g, user), { status: 401, nextCalls: 0 });
  assert.deepEqual(g.providerCalls(), { refreshes: 0, discoveries: 0 });
});

for (const value of [undefined, null, "1800000060", NaN, Infinity, -Infinity, 0]) {
  test(`malformed AgentID expiry ${String(value)} fails closed in both guards`, async () => {
    const g = guards();
    const user = agent(value);
    assert.equal(g.getReplitAuthUser({ user }), null);
    assert.deepEqual(await invoke(g, user), { status: 401, nextCalls: 0 });
  });
}

test("disabled AgentID and unauthenticated requests fail closed", async () => {
  const g = guards();
  const user = agent(g.now() + 60);
  assert.deepEqual(await invoke(g, user, false), { status: 401, nextCalls: 0 });
  g.disable();
  assert.equal(g.getReplitAuthUser({ user }), null);
  assert.deepEqual(await invoke(g, user), { status: 401, nextCalls: 0 });
});

test("human Replit sessions retain their existing refresh path with AgentID disabled", async () => {
  const g = guards();
  g.disable();
  const user = { provider: "replit", claims: { sub: "fixture-human" },
    expires_at: g.now() - 1, refresh_token: "fixture-human-refresh" };
  assert.equal(g.getReplitAuthUser({ user })?.provider, "replit");
  assert.deepEqual(await invoke(g, user), { status: undefined, nextCalls: 1 });
  assert.deepEqual(g.providerCalls(), { refreshes: 1, discoveries: 1 });
});

test("human email/PIN requests are not interpreted as AgentID sessions", () => {
  const g = guards();
  g.disable();
  assert.equal(g.getReplitAuthUser({}), null);
  assert.equal(g.getReplitAuthUser({ user: { expires_at: g.now() - 1 } }), null);
  assert.deepEqual(g.providerCalls(), { refreshes: 0, discoveries: 0 });
});

for (const [kind, tenantId, isAdmin] of [
  ["email", 2, false], ["PIN", 1, true],
] as const) {
  test(`human ${kind} session keeps its own expiry while AgentID is disabled`, async () => {
    let now = 1_800_000_000_000;
    const token = `fixture-${kind}-session`;
    const cache = new Map([[token, { tenantId, isAdmin, expiresAt: now + 60_000 }]]);
    const queries: any[] = [];
    const module = { exports: {} as any };
    vm.runInNewContext(
      transformSync(extract("server/auth.ts", "getSession"),
        { loader: "ts", format: "cjs", target: "node22" }).code,
      { module, exports: module.exports,
        Date: { now: () => now }, sessionCache: cache,
        agentIdEnabled: () => false,
        hashSessionToken: () => "fixture-hash",
        isTenantSessionActive: async (id: number) => id === tenantId,
        deleteSession: async () => { throw new Error("Active human session must not be deleted"); },
        sql: (parts: TemplateStringsArray) => parts.join("?"),
        db: { execute: async (q: any) => { queries.push(q); return { rows: [] }; } },
      },
    );
    const user = await module.exports.getSession(token);
    assert.equal(user.tenantId, tenantId);
    assert.equal(user.isAdmin, isAdmin);
    assert.equal(queries.length, 0);
    // Passing an AgentID token's short lifetime does not expire a human token.
    now += 10_000;
    assert.ok(await module.exports.getSession(token));
    now += 60_001;
    assert.equal(await module.exports.getSession(token), null);
    assert.equal(cache.has(token), false);
    assert.equal(queries.length, 1);
  });
}

test("an actual fixture session cookie remains stored but loses protected access at ID expiry", async () => {
  const g = guards();
  const app = express();
  const store = new session.MemoryStore();
  app.use(session({ secret: "local-fixture-session-secret", store,
    resave: false, saveUninitialized: false, cookie: { maxAge: 60_000 } }));
  // This fixture route is never registered in the real application. It tests
  // cookie/session transport, not provider approval or real sign-in.
  app.get("/fixture/session", (req: any, res) => {
    req.session.fixtureUser = agent(g.now() + 5);
    res.sendStatus(204);
  });
  app.use((req: any, _res, next) => {
    req.user = req.session.fixtureUser;
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.get("/fixture/protected", g.isAuthenticated, (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as any).port;
  const call = (path: string, cookie?: string) => new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path,
      headers: cookie ? { Cookie: cookie } : {} }, res => {
      const result = { status: res.statusCode!, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] };
      res.resume();
      res.on("end", () => resolve(result));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    const started = await call("/fixture/session");
    assert.ok(started.cookie);
    assert.equal((await call("/fixture/protected", started.cookie)).status, 204);
    g.setNow(g.now() + 5);
    assert.equal((await call("/fixture/protected", started.cookie)).status, 401);
    // Repeated requests with the same unexpired HTTP cookie stay denied.
    assert.equal((await call("/fixture/protected", started.cookie)).status, 401);
    const renewed = await call("/fixture/session", started.cookie);
    assert.equal(renewed.status, 204);
    assert.equal((await call("/fixture/protected", renewed.cookie || started.cookie)).status, 204);
    assert.deepEqual(g.providerCalls(), { refreshes: 0, discoveries: 0 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.clear();
  }
});

test("production logout clears the fixture Passport session without Replit logout; human logout retains its provider redirect", async () => {
  const g = guards();
  const app = express();
  const store = new session.MemoryStore();
  const fixturePassport = new passport.Passport();
  let humanRedirects = 0;
  const module = { exports: {} as any };
  vm.runInNewContext(
    transformSync(extract("server/replit_integrations/auth/replitAuth.ts", "setupAuth"),
      { loader: "ts", format: "cjs", target: "node22" }).code,
    { module, exports: module.exports, passport: fixturePassport,
      getSession: () => session({ secret: "local-logout-fixture-secret", store,
        resave: false, saveUninitialized: false, cookie: { maxAge: 60_000 } }),
      getOidcConfig: async () => ({}),
      process: { env: { REPL_ID: "fixture-replit-client" } },
      client: { buildEndSessionUrl: () => {
        humanRedirects++;
        return new URL("https://human-provider.fixture.invalid/logout");
      } },
    },
  );
  await module.exports.setupAuth(app);
  app.get("/fixture/session/:provider", (req: any, res, next) => {
    const user = req.params.provider === "agentid" ? agent(g.now() + 60) :
      { provider: "replit", claims: { sub: "fixture-human" }, expires_at: g.now() + 60 };
    req.logIn(user, (error: unknown) => error ? next(error) : res.sendStatus(204));
  });
  app.get("/fixture/protected", g.isAuthenticated, (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as any).port;
  const call = (path: string, cookie?: string) =>
    new Promise<{ status: number; cookie?: string; location?: string }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path,
        headers: cookie ? { Cookie: cookie } : {} }, res => {
        const result = { status: res.statusCode!, location: res.headers.location,
          cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] };
        res.resume(); res.on("end", () => resolve(result));
      });
      req.on("error", reject); req.end();
    });
  try {
    const started = await call("/fixture/session/agentid");
    assert.ok(started.cookie);
    assert.equal((await call("/fixture/protected", started.cookie)).status, 204);
    const logout = await call("/api/logout", started.cookie);
    assert.equal(logout.status, 302);
    assert.equal(logout.location, "/login");
    assert.equal(humanRedirects, 0);
    assert.equal((await call("/fixture/protected", started.cookie)).status, 401);
    assert.equal((await call("/fixture/protected", logout.cookie || started.cookie)).status, 401);
    const fresh = await call("/fixture/session/agentid");
    assert.equal((await call("/fixture/protected", fresh.cookie)).status, 204);
    const human = await call("/fixture/session/replit");
    assert.equal((await call("/fixture/protected", human.cookie)).status, 204);
    const humanLogout = await call("/api/logout", human.cookie);
    assert.equal(humanLogout.location, "https://human-provider.fixture.invalid/logout");
    assert.equal(humanRedirects, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.clear();
  }
});

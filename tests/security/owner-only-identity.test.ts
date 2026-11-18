import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";
import { ownerOnlyAccess, tenantAccessAllowed } from "../../server/lib/owner-only-access";

function load(file: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync("export " + declaration.getText(source).replace(/^export\s+/, ""), {
    loader: "ts", format: "cjs", target: "node22",
  }).code, {
    module, exports: module.exports, console, Date, Buffer, URL,
    ADMIN_TENANT_ID: 1, ownerOnlyAccess: () => ownerOnlyAccess({}),
    tenantAccessAllowed: (id: unknown) => tenantAccessAllowed(id, true),
    process: {env: {}}, ...globals,
  });
  return module.exports[name];
}

test("cached and stored non-owner sessions are rejected without deleting their records", async () => {
  for (const cached of [true, false]) {
    let writes = 0;
    const sessionCache = new Map(cached ? [["token", { tenantId: 2, isAdmin: true, expiresAt: Date.now() + 10_000 }]] : []);
    const get = load("server/auth.ts", "getSession", {
      sessionCache, hashSessionToken: (value: string) => value,
      sql: () => ({}), isTenantSessionActive: async () => true,
      db: { execute: async () => ({rows: [{tenant_id: 2, is_admin: true, expires_at: Date.now() + 10_000}]}) },
      deleteSession: async () => {writes++;},
    });
    assert.equal(await get("token"), null);
    assert.equal(writes, 0);
    if (cached) assert.equal(sessionCache.size, 1);
  }
});

test("canonical owner session survives private mode; tenant 1 without admin proof does not", async () => {
  for (const isAdmin of [true, false]) {
    const get = load("server/auth.ts", "getSession", {
      sessionCache: new Map([["owner", {tenantId: 1, isAdmin, expiresAt: Date.now() + 10_000}]]),
      isTenantSessionActive: async () => true,
    });
    const result = await get("owner");
    assert.equal(result?.tenantId ?? null, isAdmin ? 1 : null);
  }
});

test("OIDC mapping accepts only the bound owner subject, never email-based rebinding or cached customer authority", async () => {
  let attemptedWrites = 0;
  const resolve = load("server/auth.ts", "getOrCreateTenantForReplitUser", {
    tenantCacheByReplitUser: new Map([["customer", {tenantId: 2, isAdmin: true}]]),
    tenants: { id: "id" }, eq: () => ({}),
    db: {
      select: () => ({from: () => ({where: async () => [{id: 1, isActive: true, replitUserId: "bound-owner"}]})}),
      insert: () => {attemptedWrites++; throw new Error("unexpected write");},
      update: () => {attemptedWrites++; throw new Error("unexpected write");},
    },
    process: {env: {OWNER_EMAIL: "owner@example.invalid"}},
  });
  for (const subject of ["customer", "new-user"]) {
    await assert.rejects(resolve(subject, "owner@example.invalid", null, "replit"), /Owner sign-in required/);
  }
  await assert.rejects(resolve("bound-owner", null, null, "agentid"), /Owner sign-in required/);
  assert.equal(await resolve("bound-owner", null, null, "replit"), 1);
  assert.equal(attemptedWrites, 0);
});

test("closed registration and customer login reject before database, email or credential work", async () => {
  for (const name of ["handleTenantRegister", "handleTenantLogin"]) {
    const handler = load("server/auth.ts", name, {PRIVATE_ACCESS_ERROR: {code: "OWNER_ONLY"}});
    let status = 0;
    const response = { status(value: number) {status = value; return this;}, json(body: any) {assert.equal(body.code, "OWNER_ONLY");} };
    await handler({}, response);
    assert.equal(status, 403);
  }
});

test("non-owner API credentials and MCP credentials cannot reach downstream authorization or touch last-used state", async () => {
  const validate = load("server/auth.ts", "validateApiKey", {
    crypto: {createHash}, apiKeys: {}, eq: () => ({}), and: () => ({}),
    db: {select: () => ({from: () => ({where: async () => [{id: 4, tenantId: 2}]})})},
  });
  assert.equal(await validate("vc_fixture", {headers: {}}), false);

  const key = `mcp_${"a".repeat(8)}_${"b".repeat(32)}`;
  let calls = 0;
  const verify = load("server/lib/mcp-api-keys.ts", "verifyApiKey", {
    createHash, timingSafeEqual, sql: () => ({}),
    db: {execute: async () => {
      calls++;
      return {rows: [{id: 4, tenant_id: 2, scopes: ["admin"], revoked_at: null,
        key_hash: createHash("sha256").update(key).digest("hex")}]};
    }},
  });
  assert.equal(await verify(key), null);
  assert.equal(calls, 1);
});

test("owner gate ignores forged tenant headers and request properties", async () => {
  const verify = load("server/auth.ts", "isVerifiedOwnerRequest", {
    getReplitAuthUser: () => null,
  });
  assert.equal(await verify({
    method: "GET", originalUrl: "/api/conversations", tenantId: 1,
    _validatedSession: {tenantId: 1, isAdmin: true},
    headers: {"x-tenant-id": "1", "x-admin": "true"},
  }), false);
});

test("PIN media cookie authenticates only owner GET/HEAD media, never API or mutation requests", async () => {
  const token = "a".repeat(64);
  const verify = load("server/auth.ts", "isVerifiedOwnerRequest", {
    getReplitAuthUser: () => null,
    getSession: async (value: string) => value === token ? {tenantId: 1, isAdmin: true} : null,
  });
  for (const method of ["GET", "HEAD"]) {
    const req = {method, originalUrl: "/v/fixture.mp4", headers: {cookie: `vc_owner_media=${token}`} as any};
    assert.equal(await verify(req), true);
    assert.equal(req.headers.authorization, `Bearer ${token}`);
  }
  for (const [method, originalUrl, cookie] of [
    ["GET", "/api/settings", `vc_owner_media=${token}`],
    ["POST", "/v/fixture.mp4", `vc_owner_media=${token}`],
    ["GET", "/v/fixture.mp4", `vc_owner_media=${token}; vc_owner_media=${token}`],
    ["GET", "/v/fixture.mp4", `vc_owner_media=${"b".repeat(64)}`],
  ]) assert.equal(await verify({method, originalUrl, headers: {cookie}}), false);
});

test("owner media logout revokes only the presented session and clears the media cookie", async () => {
  const deleted: string[] = [];
  const handler = load("server/auth.ts", "handleOwnerLogout", {deleteSession: async (token: string) => deleted.push(token)});
  let cleared = "";
  await handler({headers: {authorization: "Bearer fixture"}, body: {token: "other-session"}}, {
    clearCookie: (name: string, opts: any) => {cleared = name; assert.equal(opts.httpOnly, true); assert.equal(opts.sameSite, "strict");},
    json: (body: any) => assert.equal(body.ok, true),
  });
  assert.deepEqual(deleted, ["fixture"]);
  assert.equal(cleared, "vc_owner_media");
  const authSource = readFileSync("server/auth.ts", "utf8");
  assert.match(authSource, /if \(ownerOnlyAccess\(\)\) res\.cookie\("vc_owner_media", token, \{[\s\S]*?httpOnly: true,[\s\S]*?sameSite: "strict"/);
  const routes = readFileSync("server/routes/auth-extra.ts", "utf8");
  assert.ok(routes.indexOf('app.post("/api/auth/logout"') > routes.indexOf("export function registerAuthMonitoringRoutes"));
});

test("private gate mounts before application and legacy MCP handlers; owner key verification remains mandatory", () => {
  const index = readFileSync("server/index.ts", "utf8");
  const mount = index.indexOf("app.use(createOwnerOnlyGate(isVerifiedOwnerRequest))");
  assert.ok(mount > index.indexOf("await setupAuth(app)"));
  assert.ok(mount < index.indexOf("registerAgentIdRoutes(app)"));
  assert.ok(mount < index.indexOf("registerAuthRoutes(app)"));
  assert.ok(mount < index.indexOf("await registerRoutes(httpServer, app)"));
  assert.match(index, /!ownerOnlyAccess\(\) && process\.env\.LEGACY_MCP_ENABLED/);
});

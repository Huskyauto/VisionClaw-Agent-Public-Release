import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

// Execute the real auth functions with an isolated in-memory query adapter.
// No application imports, database, sessions or live credentials.
function harness() {
  const text = fs.readFileSync("server/auth.ts", "utf8");
  const source = ts.createSourceFile("auth.ts", text, ts.ScriptTarget.Latest, true);
  const names = new Set(["validateApiKey", "getOrCreateTenantForReplitUser", "ownerRebindAllowed", "isPublicPath"]);
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""));
  let active = true;
  let failed = false;
  const tenant = { id: 7, isActive: true, isAdmin: false, replitUserId: "test-user" };
  const tenants = { id: "id", isActive: "isActive", replitUserId: "replitUserId" };
  const apiKeys = { keyHash: "keyHash", isRevoked: "isRevoked", id: "keyId" };
  const cache = new Map([["test-user", { tenantId: 7, isAdmin: false }]]);
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: async () => {
      if (failed) throw new Error("synthetic DB outage");
      return table === tenants ? [{ ...tenant, isActive: active }] : [{ id: 3, tenantId: 7, scopes: ["read"] }];
    } }) }),
    update: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }),
  };
  const sandbox = {
    exports: {}, db, tenants, apiKeys, crypto, ADMIN_TENANT_ID: 1,
    tenantCacheByReplitUser: cache, agentIdEnabled: () => false,
    eq: (...args: unknown[]) => args, and: (...args: unknown[]) => args,
    PUBLIC_EXACT_PATHS: new Set(), PUBLIC_PATH_PREFIXES: ["/api/public/"],
    PUBLIC_CHAT_OWNER_SUBPATHS: new Set(),
    process: { env: {} }, console: { error() {}, warn() {}, log() {} },
  };
  const code = ts.transpileModule(functions.map((node) => node.getText(source).replace(/^export /, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = vm.createContext(sandbox);
  vm.runInContext(`${code}\nexports.validate = validateApiKey; exports.resolve = getOrCreateTenantForReplitUser; exports.isPublic = isPublicPath;`, context);
  return {
    auth: sandbox.exports as { validate: (key: string, req: Record<string, unknown>) => Promise<boolean>; resolve: (sub: string) => Promise<number>; isPublic: (path: string) => boolean },
    disable: () => { active = false; }, outage: () => { failed = true; }, clear: () => cache.clear(),
  };
}

test("API keys stop authenticating immediately when their tenant is disabled", async () => {
  const h = harness();
  assert.equal(await h.auth.validate("vc_test", {}), true);
  h.disable();
  const req: Record<string, unknown> = {};
  assert.equal(await h.auth.validate("vc_test", req), false);
  assert.equal(req.tenantId, undefined);
  h.outage();
  assert.equal(await h.auth.validate("vc_test", {}), false);
});

test("cached and uncached identity mappings reject disabled tenants", async () => {
  const h = harness();
  assert.equal(await h.auth.resolve("test-user"), 7);
  h.disable();
  await assert.rejects(h.auth.resolve("test-user"), /unavailable|disabled/i);
  h.clear();
  await assert.rejects(h.auth.resolve("test-user"), /unavailable|disabled/i);
  h.outage();
  await assert.rejects(h.auth.resolve("test-user"));
});

test("platform-admin stats and architecture cannot skip authoritative authentication", () => {
  const h = harness();
  for (const route of ["/api/public/stats", "/api/public/architecture"]) {
    for (const suffix of ["", "/", "?cached=1"]) assert.equal(h.auth.isPublic(route + suffix), false);
  }
  assert.equal(h.auth.isPublic("/api/public/ordinary-discovery"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

test("watchlist creation binds the authenticated tenant after untrusted input", async () => {
  const captured: any[] = [];
  const source = readFileSync("server/routes/watchlist.ts", "utf8")
    .replace(/import\("\.\.\/watchlist"\)/g, "Promise.resolve(__watchlist)");
  const routes = new Map<string, Function>();
  const app = Object.fromEntries(["get", "post", "patch", "delete"].map(method =>
    [method, (path: string, ...handlers: Function[]) => routes.set(`${method} ${path}`, handlers.at(-1)!)]));
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    __watchlist: { addWatchlistItem: async (input: any) => { captured.push(input); return input; } },
  });
  let admin = true;
  let tenant: number | null = 1;
  module.exports.registerWatchlistRoutes(app, {
    authMiddleware() {}, getTenantFromRequest: () => tenant, requirePlatformAdmin: () => admin,
  });
  const response = { status: () => response, json() {} };
  const create = routes.get("post /api/watchlist")!;
  await create({ body: { tenantId: 99, name: "Fixture" } }, response);
  assert.equal(captured[0].tenantId, 1);
  assert.equal(captured[0].name, "Fixture");
  admin = false;
  await create({ body: { tenantId: 99 } }, response);
  assert.equal(captured.length, 1, "non-admin cannot reach the service");
  admin = true;
  tenant = null;
  await create({ body: { tenantId: 99 } }, response);
  assert.equal(captured.length, 1, "missing authentication cannot reach the service");
});

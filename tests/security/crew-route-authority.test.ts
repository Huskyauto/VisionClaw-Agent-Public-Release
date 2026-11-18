import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

test("crew/flow creates bind tenant and URL parent after untrusted body fields", async () => {
  const captured: any[] = [];
  const engine = Object.fromEntries(["createCrew", "addCrewAgent", "addCrewTask", "createFlow", "addFlowStep"]
    .map(name => [name, async (args: any) => { captured.push(args); return {}; }]));
  const source = readFileSync("server/routes/crews-flows.ts", "utf8")
    .replace(/import\("\.\.\/crews-engine"\)/g, "Promise.resolve(__engine)");
  const routes = new Map<string, Function>();
  const app = Object.fromEntries(["post", "get", "patch", "delete"].map(method =>
    [method, (path: string, ...handlers: Function[]) => routes.set(`${method} ${path}`, handlers.at(-1)!)]));
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code,
    { module, exports: module.exports, __engine: engine, console });
  let allowed = true;
  module.exports.registerCrewsFlowsRoutes(app, {
    authMiddleware: () => {}, getTenantFromRequest: () => 1, requirePlatformAdmin: () => allowed,
  });
  const response = { json: () => {}, status: () => response };
  for (const [path, field] of [
    ["/api/crews", null], ["/api/crews/:id/agents", "crewId"],
    ["/api/crews/:id/tasks", "crewId"], ["/api/flows", null],
    ["/api/flows/:id/steps", "flowId"],
  ] as const) {
    const route = routes.get(`post ${path}`)!;
    const req = { params: { id: "12" }, body: { tenantId: 99, crewId: 777, flowId: 888, name: "fixture" } };
    await route(req, response);
    assert.equal(captured.at(-1).tenantId, 1, path);
    if (field) assert.equal(captured.at(-1)[field], 12, path);
    assert.equal(captured.at(-1).name, "fixture");
    const count = captured.length;
    allowed = false;
    await route(req, response);
    assert.equal(captured.length, count, "non-admin must not reach engine");
    allowed = true;
  }
});

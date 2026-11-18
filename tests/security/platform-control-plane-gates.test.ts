import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as validation from "../../server/validation";

const compile = (text: string) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function actualAdminGate() {
  const source = ts.createSourceFile("auth.ts", fs.readFileSync("server/auth.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) &&
    ["isAdminRequest", "requirePlatformAdmin"].includes(n.name?.text ?? ""));
  assert.equal(functions.length, 2);
  const module = { exports: {} as any };
  vm.runInNewContext(compile(functions.map(n => n.getText(source)).join("\n")), {
    module, exports: module.exports, ADMIN_TENANT_ID: 1,
    getTenantFromRequest: (req: any) => req._validatedSession?.tenantId ?? null,
    getReplitAuthUser: () => undefined, tenantCacheByReplitUser: new Map(),
  });
  return module.exports.requirePlatformAdmin;
}

const rejectedRequests = [
  { headers: {}, _validatedSession: { tenantId: 42, isAdmin: true }, body: { tenantId: 1 } },
  { headers: { authorization: "Bearer vc_synthetic" }, _validatedSession: { tenantId: 1, isAdmin: true } },
  { headers: {} },
];
function response() {
  let status = 200;
  const res: any = { status(code: number) { status = code; return res; }, json() {} };
  return { res, status: () => status };
}

test("every MCP control-plane handler denies customers, owner API keys and anonymous callers before service access", async () => {
  const routes: any[] = [];
  const module = { exports: {} as any };
  let serviceCalls = 0;
  vm.runInNewContext(compile(fs.readFileSync("server/routes/mcp.ts", "utf8")), {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === "../validation") return validation;
      if (name !== "../mcp-client") throw new Error(`Unexpected MCP route import ${name}`);
      return new Proxy({}, { get: () => async () => { serviceCalls++; return []; } });
    },
  });
  const app: any = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path: string, ...handlers: any[]) => routes.push({ path, handler: handlers.at(-1) });
  }
  module.exports.registerMcpRoutes(app, { requirePlatformAdmin: actualAdminGate() });
  assert.ok(routes.length >= 6);
  for (const route of routes) for (const req of rejectedRequests) {
    const result = response();
    await route.handler(req, result.res);
    assert.equal(result.status(), 403, route.path);
  }
  assert.equal(serviceCalls, 0);
});

test("actual export and backup-status handlers deny customer and programmatic principals before reading data", async () => {
  const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const handlers: any[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "get" && ts.isStringLiteral(node.arguments[0]) &&
        ["/api/export", "/api/backup/status"].includes(node.arguments[0].text)) {
      const module = { exports: {} as any };
      vm.runInNewContext(compile(`module.exports = ${node.arguments.at(-1)!.getText(source)}`), {
        module, requirePlatformAdmin: actualAdminGate(), requireAdmin: actualAdminGate(),
        storage: new Proxy({}, { get: () => { throw new Error("Unauthorized storage access"); } }),
      });
      handlers.push(module.exports);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(handlers.length, 2);
  for (const handler of handlers) for (const req of rejectedRequests) {
    const result = response();
    await handler(req, result.res);
    assert.equal(result.status(), 403);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Exercise the real registered handler without booting the app or touching DB.
const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
let handlerSource = "";
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.arguments[0]?.getText(source) === '"/api/marketplace/export/:id"') {
    handlerSource = node.arguments[1].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handlerSource, "registered export route must exist");
const js = ts.transpileModule(`const handler = ${handlerSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const [role, status] of [["anonymous", 401], ["customer", 403], ["owner", 200]] as const) {
  test(`global skill export permits owner only: ${role}`, async () => {
    let exports = 0;
    const response = { code: 200, payload: null as unknown,
      status(code: number) { this.code = code; return this; },
      json(payload: unknown) { this.payload = payload; return this; } };
    const authorize = (_req: unknown, res: typeof response) => {
      if (role === "owner") return true;
      res.status(status).json({ error: "denied" });
      return false;
    };
    const exportSkill = async () => { exports++; return { success: true, data: { promptContent: "private fixture" } }; };
    const handler = new Function("requirePlatformAdmin", "exportSkill", "errorMessage", `${js}; return handler;`)(authorize, exportSkill, String);
    await handler({ params: { id: "7" } }, response);
    assert.equal(response.code, status);
    assert.equal(exports, role === "owner" ? 1 : 0);
  });
}

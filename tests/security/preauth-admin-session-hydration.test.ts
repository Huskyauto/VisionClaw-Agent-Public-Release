import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

test("early hard-admin handlers validate the session before evaluating platform authority", () => {
  const text = fs.readFileSync("server/routes.ts", "utf8");
  const source = ts.createSourceFile("routes.ts", text, ts.ScriptTarget.Latest, true);
  const boundary = text.indexOf('app.use("/api", authMiddleware)');
  assert.ok(boundary > 0);
  const expected = new Set(["/api/cache/stats", "/api/drive-health", "/api/onedrive-health",
    "/api/demo/warmup", "/api/demo/exit", "/api/demo/felix-check"]);
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(source) === "app" && node.pos < boundary &&
        ts.isStringLiteral(node.arguments[0])) {
      const path = node.arguments[0].text;
      if (expected.has(path)) {
        assert.ok(node.arguments.slice(1, -1).some(arg => arg.getText(source) === "authMiddleware"), path);
        assert.ok(node.arguments.at(-1)!.getText(source).includes("!isPlatformAdmin(req)"), `${path} must retain the admin gate`);
        expected.delete(path);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.equal(expected.size, 0, "every target must remain registered");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import path from "node:path";
import { operatorJobMatchesTenant } from "../../server/lib/operator-job-ownership";

/** Executes the actual registered route bodies without PDF/network providers. */
function loadRoutes(jobs: Map<string, any>, fileReads: string[] = []) {
  const source = ts.createSourceFile("audit.ts", fs.readFileSync("server/routes/audit.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const routes = new Map<string, any>();
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "get" && ts.isStringLiteral(node.arguments[0]) &&
        ["/api/admin/smart-leads/:jobId", "/api/admin/smart-leads/:jobId/download"].includes(node.arguments[0].text)) {
      const compiled = ts.transpileModule(node.getText(source), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      vm.runInNewContext(compiled, {
        app: { get: (path: string, _auth: any, handler: any) => routes.set(path, handler) },
        authMiddleware: () => {}, FULL_AUDIT_JOBS: jobs,
        requireAdmin: async () => 1,
        operatorJobMatchesTenant,
        path, process: { cwd: () => "/synthetic" },
        fs: {
          existsSync: () => { fileReads.push("exists"); return true; },
          createReadStream: () => {
            fileReads.push("stream");
            return { on() { return this; }, pipe(res: any) { res.piped = true; } };
          },
        },
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.equal(routes.size, 2);
  return routes;
}

test("smart-leads status/download refuse a foreign or unowned job before opening its file", async () => {
  for (const tenantId of [42, undefined]) {
    let opened = 0;
    const job = { id: "foreign", kind: "smart-leads", tenantId, status: "done",
      get filePath() { opened++; return "/must-not-read.pdf"; } };
    const fileReads: string[] = [];
    const routes = loadRoutes(new Map([["foreign", job]]), fileReads);
    for (const handler of routes.values()) {
      let status = 200;
      const res: any = { status(code: number) { status = code; return res; }, json() {} };
      await handler({ params: { jobId: "foreign" } }, res);
      assert.equal(status, 404);
    }
    assert.equal(opened, 0);
    assert.equal(fileReads.length, 0);
  }
});

test("the owner can download his bound smart-leads job inside uploads", async () => {
  const fileReads: string[] = [];
  const routes = loadRoutes(new Map([["owned", {
    id: "owned", tenantId: 1, kind: "smart-leads", status: "done",
    filePath: "uploads/fixture.pdf", fileName: "fixture.pdf",
  }]]), fileReads);
  const headers: Record<string, string> = {};
  const res: any = { status() { throw new Error("Owned download unexpectedly failed"); },
    setHeader(k: string, v: string) { headers[k] = v; } };
  await routes.get("/api/admin/smart-leads/:jobId/download")({ params: { jobId: "owned" } }, res);
  assert.deepEqual(fileReads, ["exists", "stream"]);
  assert.equal(res.piped, true);
  assert.equal(headers["Content-Type"], "application/pdf");
});

test("the owner can still see his own smart-leads status", async () => {
  const routes = loadRoutes(new Map([["owned", {
    id: "owned", tenantId: 1, kind: "smart-leads", status: "done", startedAt: 1,
  }]]));
  let body: any;
  const res: any = { status() { return res; }, json(value: any) { body = value; } };
  await routes.get("/api/admin/smart-leads/:jobId")({ params: { jobId: "owned" } }, res);
  assert.equal(body.jobId, "owned");
});

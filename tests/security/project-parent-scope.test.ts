import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/** Actual application SELECTs, with CTEs shadowing every source table. No writes
 * or customer rows are needed to verify these predicates in PostgreSQL. */
export function buildProjectParentProbes() {
  const probes: { label: string; sqlQuery: string; params: unknown[]; expected: number }[] = [];
  for (const [file, marker] of [
    ["server/routes.ts", "INSERT INTO project_notes"],
    ["server/tools/domains/files/handlers.ts", "INSERT INTO project_files"],
  ]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let template: string | undefined;
    function visit(node: ts.Node) {
      if (ts.isTaggedTemplateExpression(node)) {
        const text = node.getText(source);
        if (text.includes(marker) && text.includes("projId") &&
            (file !== "server/routes.ts" || text.includes("context-guard"))) template = text;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(template, `application query missing: ${marker}`);
    for (const [label, conversationId, projId, expected] of [
      ["owned parents", 1001, 2001, 1],
      ["foreign project", 1002, 2002, 0],
      ["foreign conversation", 1003, 2001, 0],
    ] as const) {
      const module = { exports: {} as any };
      vm.runInNewContext(ts.transpileModule(`module.exports = ${template}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText, {
        module, sql, tenantId: 42, conversationId, projId,
        ctx: { tenantId: 42, conversationId }, snapshot: "synthetic",
        fileName: "fixture.txt", absPath: "/synthetic", driveUrl: null,
        fileType: "txt", stat: { size: 1 },
      });
      const query = new PgDialect().sqlToQuery(module.exports);
      const select = query.sql.replace(/^\s*INSERT INTO \w+\s*\([^)]*\)\s*/i, "")
        .replace(/\s+RETURNING id\s*$/i, "");
      assert.match(select, /^SELECT\b/i, "mutation must be an ownership-checked INSERT SELECT");
      assert.match(select, /p\.tenant_id = \$/);
      assert.match(select, /c\.tenant_id = \$/);
      probes.push({
        label: `${marker}: ${label}`, expected, params: query.params,
        sqlQuery: `WITH projects(id,tenant_id) AS (VALUES (2001,42),(2002,43)),
          conversations(id,tenant_id,project_id) AS
          (VALUES (1001,42,2001),(1002,42,2002),(1003,43,2001))
          SELECT count(*)::int AS eligible_rows FROM (${select}) AS candidate`,
      });
    }
  }
  return probes;
}

test("both project mutations bind conversation and project ownership at INSERT", () => {
  assert.equal(buildProjectParentProbes().length, 6);
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("the native slow-tool retry predicate refuses progress-deadline failures", () => {
  const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const predicates: string[] = [];
  function walk(n: ts.Node) {
    if (ts.isIfStatement(n)) {
      const predicate = n.expression.getText(source);
      if (predicate.includes("hadSlowTool") && predicate.includes("executedTools.length")) predicates.push(predicate);
    }
    ts.forEachChild(n, walk);
  }
  walk(source);
  assert.equal(predicates.length, 1, "retry ownership changed; revisit contract");
  const fixture = { hadSlowTool: true, round: 2, executedTools: [{ name: "produce_video" }] };
  assert.equal(vm.runInNewContext(predicates[0], { ...fixture, streamProgressTimedOut: true }, { timeout: 1000 }), false);
  assert.equal(vm.runInNewContext(predicates[0], { ...fixture, streamProgressTimedOut: false }, { timeout: 1000 }), true);
});

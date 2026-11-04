import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";

function fixture() {
  const source = readFileSync("server/ceo-orchestrator.ts", "utf8");
  const ast = ts.createSourceFile("plans.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["getActivePlan", "getActivePlansForConversation"]);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.has(n.name.text));
  assert.equal(functions.length, 2);
  const module: any = { exports: {} };
  const owned = { id: "owned", tenantId: 2, conversationId: 10 };
  const foreign = { id: "foreign", tenantId: 3, conversationId: 10 };
  const activePlans = new Map([["owned", owned], ["foreign", foreign]]);
  vm.runInNewContext(transformSync(functions.map(n => n.getText(ast)).join("\n"), { loader: "ts", format: "cjs" }).code, { module, exports: module.exports, activePlans });
  return { ...module.exports, owned, foreign };
}

test("known plan IDs never expose a foreign tenant's in-memory plan", () => {
  const f = fixture();
  assert.equal(f.getActivePlan("foreign", 2), undefined);
  assert.equal(f.getActivePlan("owned", 2), f.owned);
  for (const tenant of [undefined, null, 0, -1, 2.5, NaN, "2"])
    assert.equal(f.getActivePlan("owned", tenant), undefined);
});

test("conversation lookup filters the plan tenant even if conversation identifiers coincide", () => {
  const f = fixture();
  assert.equal(f.getActivePlansForConversation(10, 2).length, 1);
  assert.equal(f.getActivePlansForConversation(10, 2)[0], f.owned);
  for (const tenant of [undefined, null, 0, -1, "2"])
    assert.equal(f.getActivePlansForConversation(10, tenant).length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { orderFreshPersonaSeed } from "../../server/persona-bootstrap-order";

test("fresh seed preserves Minerva=1 and Felix=2 despite a configured generalist name", () => {
  const ast = ts.createSourceFile("seed.ts", readFileSync("server/seed.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let names: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "DEFAULT_PERSONAS" &&
        node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      names = node.initializer.elements.filter(ts.isObjectLiteralExpression).map(element => {
        const field = element.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === "name");
        if (!field || !ts.isPropertyAssignment(field)) return "";
        if (ts.isIdentifier(field.initializer) && field.initializer.text === "AGENT_NAME") return "VisionClaw";
        return ts.isStringLiteralLike(field.initializer) ? field.initializer.text : "";
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
   assert.deepEqual(names.slice(0, 3), ["Minerva", "VisionClaw", "Felix"]);
   const fixture = names.map(name => ({ name, role: name === "VisionClaw" ? "General AI Assistant" : "Specialist" }));
   assert.deepEqual(orderFreshPersonaSeed(fixture).slice(0, 2).map(p => p.name), ["Minerva", "Felix"]);
   assert.match(readFileSync("server/seed.ts", "utf8"), /values\(orderFreshPersonaSeed\(DEFAULT_PERSONAS\)\)/);
  assert.equal(names.at(-1), "Robert");
  assert.equal(names.filter(n => n === "Robert").length, 1);
});

test("fresh seed keeps the canonical coordinator when the generalist is also named Felix", () => {
  const generalist = { name: "Felix", role: "General AI Assistant" };
  const coordinator = { name: "Felix", role: "CEO Persona" };
  const fixture = [ { name: "Minerva", role: "Planner" }, generalist, coordinator, { name: "Robert", role: "Personal growth" } ];
  const ordered = orderFreshPersonaSeed(fixture);
  assert.equal(ordered[1], coordinator);
  assert.equal(ordered.filter(p => p.name === "Felix").length, 1);
  assert.equal(ordered.at(-1)?.name, "Robert");
  assert.deepEqual(fixture, [fixture[0], generalist, coordinator, fixture[3]]);
});

test("API model receipt is persisted from execution and scoped to the tenant", () => {
  const dispatch = readFileSync("server/api-v1-dispatch.ts", "utf8");
  const line = readFileSync("server/spark-line.ts", "utf8");
  assert.match(dispatch, /finishApiV1Turn\(tenantId, conversation\.id, "complete", undefined, result\)/);
  assert.match(line, /resolvedModel: status === "complete" \? modelReceipt\?\.model/);
  assert.match(line, /observedModel: status === "complete" \? modelReceipt\?\.observedModel/);
  assert.match(line, /eq\(apiV1ConversationRuns\.tenantId, tenantId\)/);
});

test("preference-only historical metadata cannot masquerade as provider evidence", () => {
  const api = readFileSync("server/routes/api-v1.ts", "utf8");
  const engine = readFileSync("server/chat-engine.ts", "utf8");
  assert.match(api, /modelPreference: conv\.model/);
  assert.match(api, /modelEvidence: servedModel \? "provider_reported" : resolvedModel \? "route_resolved" : "saved_preference_only"/);
  assert.match(engine, /typeof resp\.model === "string"/);
  assert.match(engine, /response: cleanResponse,[\s\S]*observedModel,/);
});

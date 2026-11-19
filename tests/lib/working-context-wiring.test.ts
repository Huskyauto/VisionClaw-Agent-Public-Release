import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const engine = readFileSync("server/chat-engine.ts", "utf8");
const routes = readFileSync("server/routes.ts", "utf8");
const memory = readFileSync("server/memory-intelligence.ts", "utf8");

test("working context reuses the existing extraction request and commits before the no-facts exit", () => {
  const tree = ts.createSourceFile("memory-intelligence.ts", memory, ts.ScriptTarget.Latest, true);
  const extraction = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "intelligentExtractMemory")!;
  assert.ok(extraction);
  let modelCalls = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "replitOpenai.chat.completions.create") modelCalls++;
    ts.forEachChild(node, visit);
  }
  visit(extraction);
  assert.equal(modelCalls, 1);
  const body = extraction.getText(tree);
  assert.ok(body.indexOf("commitCapture(") < body.indexOf("if (facts.length === 0)"));
  // The complete original packet remains: a one-entry local fallback must not
  // reduce the stronger extractor's four-entry coverage or correction handling.
  assert.match(body, /workingInstructions \? 900 : 300/);
  assert.match(body, /localMemoryTasks\.workingContext\(workingCapture\)/);
  assert.doesNotMatch(body, /workingInstructions = "";\s*workingInput = ""/);
});

test("API and web capture use actual persisted turn IDs and lean context avoids duplicate injection", () => {
  assert.match(engine, /intelligentExtractMemory\([\s\S]{0,500}persistedUserMessage\?\.id[\s\S]{0,150}assistantMsgRow\.id/);
  assert.match(routes, /intelligentExtractMemory\([\s\S]{0,200}savedUserMsg\.id[\s\S]{0,100}__asstMsg\.id/);
  assert.match(engine, /if \(opts\?\.leanContext && persona\) \{\s*try \{\s*const \{ getWorkingContextService \}/);
  assert.match(engine, /buildWorkspaceContext\(tenantId, persona\?\.id, conversationId, !!workingContextBrief\)/);
  const dreaming = readFileSync("server/auto-consolidation.ts", "utf8");
  assert.match(dreaming, /getWorkingContextService\(\)\)\.consolidate\(tenantId\)/);
});

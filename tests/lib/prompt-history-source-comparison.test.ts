import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PromptHistoryComparison } from "../../server/lib/prompt-history-comparison";

// Bounded SOURCE-BOUND synthetic comparison, not provider-cache/billing proof.
// Execute only the native SSE history projection over our own plain fixtures;
// never import the HTTP server or run attachment/network branches.
const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
const owners: ts.VariableDeclaration[] = [];
function walk(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.name.getText(source) === "chatMessages") owners.push(n);
  ts.forEachChild(n, walk);
}
walk(source);
assert.equal(owners.length, 1, "projection ownership changed; revisit comparison");
const projection = ts.transpileModule(`var ${owners[0].getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function prepare(messages: { id: number; role: string; content: string }[], inlineDocContext = "") {
  const context = {
    allMessages: messages, inlineDocContext,
    // Fixtures have no think tags or attachments. These branches are excluded.
    stripThinkTags: (s: string) => s,
    windowMessages: (m: unknown[]) => m.slice(-20),
    chatMessages: [] as unknown[],
  };
  vm.createContext(context);
  vm.runInContext(projection, context, { timeout: 1000 });
  return context.chatMessages.map((message, i) => ({ id: messages.slice(-20)[i].id, message }));
}

for (const [name, initial, docs] of [
  ["long assistant ageing", [{ id: 1, role: "assistant", content: "answer ".repeat(350) }, { id: 2, role: "user", content: "Thanks" }], ""],
  ["long user ageing", [{ id: 1, role: "user", content: "request ".repeat(350) }, { id: 2, role: "assistant", content: "Noted" }], ""],
  ["ephemeral inline document context", [{ id: 1, role: "assistant", content: "Ready" }, { id: 2, role: "user", content: "Read this document" }], "\nDOCUMENT CONTEXT: synthetic fixture"],
] as const) {
  test(`native SSE comparison detects historical drift: ${name}`, () => {
    const compare = new PromptHistoryComparison();
    const scope = { tenantId: 1, conversationId: 1, channel: "sse" };
    const messages = initial.map(m => ({ ...m }));
    compare.observe(scope, prepare(messages, docs));
    const result = compare.observe(scope, prepare([
      ...messages, { id: 3, role: "assistant", content: "Next" },
      { id: 4, role: "user", content: "Continue" },
    ], docs));
    assert.equal(result.compared, 2);
    assert.equal(result.changed, 1);
  });
}

test("ordinary short history is stable when a turn is appended", () => {
  const compare = new PromptHistoryComparison();
  const scope = { tenantId: 1, conversationId: 2, channel: "sse" };
  compare.observe(scope, prepare([{ id: 1, role: "user", content: "Hello" }]));
  assert.equal(compare.observe(scope, prepare([
    { id: 1, role: "user", content: "Hello" }, { id: 2, role: "assistant", content: "Hi" },
    { id: 3, role: "user", content: "Continue" },
  ])).changed, 0);
});

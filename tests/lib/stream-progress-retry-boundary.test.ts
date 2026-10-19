import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { streamWithProgressDeadline } from "../../server/lib/stream-progress-deadline";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";

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

test("native paid-stop guard handles stalled partial text and tool fragments before empty-only recovery", async () => {
  const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let paidGuard: ts.IfStatement | undefined, emptyGuard: ts.IfStatement | undefined;
  let persistence: ts.Expression | undefined;
  function walk(node: ts.Node) {
    if (ts.isIfStatement(node)) {
      const text = node.expression.getText(source);
      if (text.startsWith("streamAborted && !paidStreamRecoveryPolicy")) paidGuard = node;
      if (text === "streamAborted && !roundContent && !hasToolCalls") emptyGuard = node;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "__persistContent") persistence = node.initializer;
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(paidGuard && emptyGuard && persistence);
  assert.ok(paidGuard.pos < emptyGuard.pos, "paid stop must run even after partial progress");
  for (const delta of [{ content: "partial" }, { tool_calls: [{ function: { arguments: '{"' } }] }]) {
    let count = 0, streamAborted = false;
    const stream = { [Symbol.asyncIterator]() { return { next: () => ++count === 1
      ? Promise.resolve({ done: false, value: { choices: [{ delta }] } })
      : new Promise<IteratorResult<any>>(() => {}) }; } };
    await assert.rejects(async () => {
      for await (const _ of streamWithProgressDeadline(stream, {
        timeoutMs: 15, onTimeout: () => { streamAborted = true; },
      })) { /* native progress deadline, not a mocked timeout flag */ }
    }, /model progress/);
    assert.equal(vm.runInNewContext(paidGuard.expression.getText(source), {
      streamAborted, paidStreamRecoveryPolicy, currentRegistryModelId: "cheaperinference/gpt-5.6-luna",
      STREAM_CREATE_TIMEOUT_MS: 12_000,
    }, { timeout: 1000 }), true);
  }
  const saved = vm.runInNewContext(persistence.getText(source), {
    __wasAborted: true, routeMeta: "", toolMeta: "", cleanedFullResponse: "partial",
    paidStreamFailure: true,
  }, { timeout: 1000 });
  assert.match(saved, /completion and charge uncertain; no retry or substitution/);
  assert.doesNotMatch(saved, /client disconnected before completion/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompilationMatrix, newCompilationMatrix, compilationOperations, compilationOutputTokens } from "../../server/lib/company-compilation-matrix";

test("every author has output headroom and the larger synthesis has its own allowance", () => {
  for (const op of compilationOperations()) {
    assert.equal(compilationOutputTokens(op), op.stage === "author" ? 16_384 : 32_768, op.key);
  }
});

test("three authors each compile all three categories; fourth model synthesizes once per category", async () => {
  let state = newCompilationMatrix("bound-intake-and-evidence");
  const calls: string[] = [], synthesisInputs: string[][] = [];
  const ports = {
    checkpoint: async (s: any) => { state = structuredClone(s); },
    request: async (op: any, drafts: string[]) => {
      calls.push(op.key);
      if (op.stage === "synthesis") synthesisInputs.push([...drafts]);
      return { text: `${op.kind} ${op.model} complete compilation`, model: op.model };
    },
    accept: (_op: any, value: any) => value.text,
  };
  for (let i = 0; i < 12; i++) await advanceCompilationMatrix(state, ports);
  assert.equal(calls.length, 12);
  assert.equal(calls.filter(k => k.startsWith("author:")).length, 9);
  assert.equal(calls.filter(k => k.startsWith("synthesis:")).length, 3);
  assert.ok(synthesisInputs.every(d => d.length === 3 && new Set(d).size === 3));
  assert.equal(state.phase, "complete");
  await advanceCompilationMatrix(state, ports);
  assert.equal(calls.length, 12, "Restart never repeats completed work");
});

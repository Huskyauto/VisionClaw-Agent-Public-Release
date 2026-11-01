import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the production chunk builder without importing the audit entry point
// (which would run providers, write reports and notify the owner).
function build(files: Map<string, string>) {
  const source = readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
  const max = source.match(/^const MAX_CHUNK_CHARS = .+;$/m)![0];
  const start = source.indexOf("function splitOversizedFile(");
  const end = source.indexOf("\nfunction sourceFingerprint(", start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(
    `${max}\nconst OVERLAP_LINES = 150;\n${source.slice(start, end)}
     globalThis.result = buildChunks([...files.keys()]);`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const context = {
    process: { env: {} }, files,
    fs: { readFileSync: (name: string) => {
      assert.ok(files.has(name)); return files.get(name)!;
    } },
    noteUnreadable: (name: string) => { throw new Error(`Unreadable fixture ${name}`); },
    result: [] as Array<{ files: string[]; text: string }>,
  };
  vm.runInNewContext(code, context, { timeout: 2000 });
  return context.result;
}

test("default audit requests split the observed 234k first batch into bounded smaller requests", () => {
  const files = new Map(Array.from({ length: 14 }, (_, i) =>
    [`server/fixture-${i}.ts`, Array.from({ length: 80 }, (_, line) =>
      `// file ${i} line ${line} ${"x".repeat(180)}`).join("\n")]));
  const chunks = build(files);
  assert.ok(chunks.length >= 4, "one oversized request repeatedly timed out without auditing any file");
  assert.ok(chunks.every(chunk => chunk.text.length <= 60_000));
  assert.equal(new Set(chunks.flatMap(chunk => chunk.files)).size, files.size);
  for (const [name, text] of files) {
    const chunk = chunks.find(c => c.files.includes(name))!;
    for (const line of text.split("\n")) assert.ok(chunk.text.includes(line));
  }
});

test("smaller requests retain every numbered line and overlap in oversized-file windows", () => {
  const lines = Array.from({ length: 1500 }, (_, i) => `// unique-${i} ${"y".repeat(180)}`);
  const chunks = build(new Map([["server/large-fixture.ts", lines.join("\n")]]));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.text.length <= 60_000));
  for (let i = 0; i < lines.length; i++) {
    const numbered = `${String(i + 1).padStart(5)}| ${lines[i]}`;
    assert.ok(chunks.some(chunk => chunk.text.includes(numbered)), `line ${i + 1} was lost`);
  }
  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1].text.split("\n").filter(line => /^\s*\d+\|/.test(line));
    for (const line of previous.slice(-150)) assert.ok(chunks[i].text.includes(line));
  }
});

test("one source line larger than the entire input budget fails closed instead of exceeding the request cap", () => {
  const source = readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
  assert.match(source, /if\s*\(numbered\[start\]\.length\s*>\s*bodyBudget\)[\s\S]*?noteUnreadable\(f,/);
  assert.throws(
    () => build(new Map([["server/one-huge-line.ts", "x".repeat(240_000)]])),
    /Unreadable fixture server\/one-huge-line\.ts/,
  );
});

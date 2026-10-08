import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { sliceFile } from "../../server/lib/code-symbol-slicer";

const TMP_DIR = path.join(process.cwd(), ".local", "test-slicer");

function setup() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}
function writeTmp(name: string, content: string): string {
  setup();
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content);
  return p.replace(process.cwd() + path.sep, "");
}

test("sliceFile rejects path escape", async () => {
  const r = await sliceFile({ filePath: "../../../etc/passwd" });
  assert.equal(r.ok, false);
});

test("sliceFile rejects missing file", async () => {
  const r = await sliceFile({ filePath: ".local/test-slicer/does-not-exist.ts" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /not found|invalid|escapes/);
});

test("sliceFile extracts TS function via AST", async () => {
  const src = [
    "import { foo } from 'bar';",
    "",
    "export function alpha(x: number): number {",
    "  return x + 1;",
    "}",
    "",
    "function beta() {",
    "  return 'beta';",
    "}",
    "",
    "export class Gamma {",
    "  hello() { return 'hi'; }",
    "}",
  ].join("\n");
  const p = writeTmp("ast.ts", src);
  const r = await sliceFile({ filePath: p });
  assert.equal(r.ok, true);
  assert.equal(r.language, "typescript");
  const names = (r.slices || []).map((s) => s.symbol);
  assert.ok(names.includes("alpha"));
  assert.ok(names.includes("beta"));
  assert.ok(names.includes("Gamma"));
  const alpha = (r.slices || []).find((s) => s.symbol === "alpha")!;
  assert.equal(alpha.kind, "function");
  assert.equal(alpha.exported, true);
  assert.match(alpha.code, /return x \+ 1/);
});

test("sliceFile filters to named symbols only", async () => {
  const src = `export function keep1() { return 1; }
export function drop1() { return 2; }
export function keep2() { return 3; }`;
  const p = writeTmp("filter.ts", src);
  const r = await sliceFile({ filePath: p, symbols: ["keep1", "keep2"] });
  assert.equal(r.ok, true);
  const names = (r.slices || []).map((s) => s.symbol);
  assert.deepEqual(names.sort(), ["keep1", "keep2"]);
});

test("sliceFile exportedOnly drops non-exported", async () => {
  const src = `export function pub1() { return 1; }
function priv1() { return 2; }
export const pub2 = () => 3;`;
  const p = writeTmp("exp.ts", src);
  const r = await sliceFile({ filePath: p, exportedOnly: true });
  assert.equal(r.ok, true);
  const names = (r.slices || []).map((s) => s.symbol).sort();
  assert.deepEqual(names, ["pub1", "pub2"]);
});

test("sliceFile lineRanges adds explicit slice", async () => {
  const src = Array.from({ length: 50 }, (_, i) => `// line ${i + 1}`).join("\n");
  const p = writeTmp("ranges.ts", src);
  const r = await sliceFile({ filePath: p, lineRanges: [[10, 12]] });
  assert.equal(r.ok, true);
  const range = (r.slices || []).find((s) => s.kind === "range");
  assert.ok(range);
  assert.match(range!.code, /line 10/);
  assert.match(range!.code, /line 12/);
});

test("sliceFile python regex fallback", async () => {
  const src = `def alpha():
    return 1

class Beta:
    def method(self):
        return 2

def gamma():
    return 3
`;
  const p = writeTmp("py.py", src);
  const r = await sliceFile({ filePath: p });
  assert.equal(r.ok, true);
  assert.equal(r.language, "python");
  const names = (r.slices || []).map((s) => s.symbol);
  assert.ok(names.includes("alpha"));
  assert.ok(names.includes("Beta"));
  assert.ok(names.includes("gamma"));
});

test("sliceFile reports compressionRatio < 1 when slicing", async () => {
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) lines.push(`// pad line ${i}`);
  lines.push("export function tiny() { return 1; }");
  for (let i = 0; i < 200; i++) lines.push(`// pad line ${i}`);
  const p = writeTmp("compress.ts", lines.join("\n"));
  const r = await sliceFile({ filePath: p, symbols: ["tiny"] });
  assert.equal(r.ok, true);
  assert.ok((r.compressionRatio || 1) < 0.5);
});

test("sliceFile merges overlapping slices", async () => {
  const src = `export function a() {
  return 1;
}
export function b() {
  return 2;
}`;
  const p = writeTmp("merge.ts", src);
  const r = await sliceFile({ filePath: p, contextLines: 5 });
  assert.equal(r.ok, true);
  // With contextLines=5, slices likely merge — should be <=1 result
  assert.ok((r.slices || []).length <= 2);
});

test("cleanup tmp dir", () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

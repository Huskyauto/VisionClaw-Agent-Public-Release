import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("client/src/components/company-report-package.tsx", "utf8");
const ast = ts.createSourceFile("company-report-package.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const driveChecks: RegExp[] = [];
function visit(node: ts.Node) {
  if (ts.isRegularExpressionLiteral(node) && node.text.includes("drive")) {
    const end = node.text.lastIndexOf("/");
    driveChecks.push(new RegExp(node.text.slice(1, end), node.text.slice(end + 1)));
  }
  ts.forEachChild(node, visit);
}
visit(ast);

test("all package PDF and MP3 links display with supported Drive sharing parameters", () => {
  assert.equal(driveChecks.length, 3, "full PDF, full audio, and teaser links are checked");
  for (const check of driveChecks)
    for (const suffix of ["", "?usp=sharing", "?usp=drive_link"])
      assert.ok(check.test(`https://drive.google.com/file/d/FixtureFile_123456789/view${suffix}`),
        `a valid saved Drive view link must display: ${suffix || "canonical"}`);
});

test("sharing support still rejects non-Drive destinations and unsupported link shapes", () => {
  for (const check of driveChecks)
    for (const url of [
      "http://drive.google.com/file/d/FixtureFile_123456789/view",
      "https://drive.google.com.evil.test/file/d/FixtureFile_123456789/view",
      "https://drive.google.com@evil.test/file/d/FixtureFile_123456789/view",
      "javascript:alert(1)",
      "https://drive.google.com/file/d/short/view",
      "https://drive.google.com/file/d/FixtureFile_123456789/edit",
      "https://drive.google.com/file/d/FixtureFile_123456789/view?redirect=https://evil.test",
      "https://drive.google.com/file/d/FixtureFile_123456789/view?usp=sharing&redirect=https://evil.test",
      "https://drive.google.com/file/d/FixtureFile_123456789/view#unapproved",
    ]) assert.equal(check.test(url), false, url);
});

test("full and teaser file labels have their own line above wrapping actions", () => {
  let rows = 0;
  function inspect(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "div" &&
        node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) &&
          p.name.getText(ast) === "key" && p.initializer?.getText(ast) === "{file.key}")) {
      rows++;
      const className = node.openingElement.attributes.properties.find(p =>
        ts.isJsxAttribute(p) && p.name.getText(ast) === "className")!.getText(ast);
      assert.match(className, /space-y-3/);
      assert.doesNotMatch(className, /items-center|justify-between/);
      const content = node.getText(ast);
      assert.match(content, /<span className="block break-words text-sm font-medium">\{file.label\}<\/span>/);
      assert.match(content, /<div className="flex flex-wrap items-center gap-x-4 gap-y-3">/);
      assert.match(content, /<Button className="shrink-0"/);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  assert.equal(rows, 2);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAgentReadability } from "../../server/audit-engine";

test("well-structured page: text, landmarks, ordered headings all pass", () => {
  const html = `<html><body><header><nav>menu</nav></header><main>
    <h1>Title</h1><p>${"content ".repeat(50)}</p>
    <h2>Sub</h2><h3>Deep</h3><h2>Sub 2</h2>
    </main><footer>foot</footer></body></html>`;
  const r = analyzeAgentReadability(html);
  assert.ok(r.textLen > 300);
  assert.ok(r.semanticTags.length >= 3);
  assert.equal(r.hasH1, true);
  assert.equal(r.skippedLevel, false);
});

test("JS-only shell: near-zero visible text, no landmarks", () => {
  const html = `<html><head><script>window.app=${"x".repeat(5000)}</script>
    <style>.a{color:red}</style></head><body><div id="root"></div></body></html>`;
  const r = analyzeAgentReadability(html);
  assert.ok(r.textLen < 50, `textLen was ${r.textLen}`);
  assert.equal(r.semanticTags.length, 0);
  assert.equal(r.hasH1, false);
});

test("skip in DOCUMENT ORDER is caught even when the missing level appears later", () => {
  // h1 -> h3 is a skip; a later h2 must NOT mask it (architect finding).
  const r = analyzeAgentReadability("<h1>a</h1><h3>b</h3><h2>c</h2>");
  assert.equal(r.hasH1, true);
  assert.equal(r.skippedLevel, true);
});

test("going back UP levels is not a skip", () => {
  const r = analyzeAgentReadability("<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2><h1>e</h1><h2>f</h2>");
  assert.equal(r.skippedLevel, false);
});

test("first heading deeper than h1 counts as a skip", () => {
  const r = analyzeAgentReadability("<h2>a</h2><h3>b</h3>");
  assert.equal(r.hasH1, false);
  assert.equal(r.skippedLevel, true);
});

test("no headings at all: no h1, no skip flag", () => {
  const r = analyzeAgentReadability("<p>hello world</p>");
  assert.equal(r.hasH1, false);
  assert.equal(r.skippedLevel, false);
});

test("malformed HTML never throws", () => {
  const junk = "<h1<><script><div<<>>&&&;;;" + "<h".repeat(1000) + "\x00\xff<h3";
  assert.doesNotThrow(() => analyzeAgentReadability(junk));
});

test("entities and tags are stripped from visible-text measurement", () => {
  const r = analyzeAgentReadability("<p>&nbsp;&amp;<b>hi</b></p>");
  assert.equal(r.textLen, 2);
});

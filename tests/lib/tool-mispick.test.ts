/**
 * Pure-logic tests for mis-pick pairing (R125+137.64).
 * detectMispicks is DB-free by design — importing it must NOT open a pg pool.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMispicks } from "../../server/lib/tool-mispick";

const ok = (name: string) => ({ name, input: {}, output: { success: true, data: "x" } });
const fail = (name: string, error = "boom") => ({ name, input: {}, output: { error } });

test("fail then different tool success = one mis-pick pair", () => {
  const pairs = detectMispicks([fail("web_fetch"), ok("web_search")]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].failedTool, "web_fetch");
  assert.equal(pairs[0].succeededTool, "web_search");
  assert.equal(pairs[0].failedError, "boom");
});

test("retry-success of the SAME tool is NOT a mis-pick", () => {
  const pairs = detectMispicks([fail("send_email"), ok("send_email")]);
  assert.equal(pairs.length, 0);
});

test("same-tool retry-success shields a later different-tool success", () => {
  // fail A → A succeeds (retry) → B succeeds. The retry resolved it; no mis-pick.
  const pairs = detectMispicks([fail("a"), ok("a"), ok("b")]);
  assert.equal(pairs.length, 0);
});

test("all failures = no pairs", () => {
  assert.equal(detectMispicks([fail("a"), fail("b"), fail("c")]).length, 0);
});

test("all successes = no pairs", () => {
  assert.equal(detectMispicks([ok("a"), ok("b")]).length, 0);
});

test("success:false counts as failure; plain object without error counts as success", () => {
  const pairs = detectMispicks([
    { name: "a", input: {}, output: { success: false } },
    { name: "b", input: {}, output: { anything: 1 } },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].failedError, null);
});

test("pairs are capped at 5 per turn", () => {
  const seq: any[] = [];
  for (let i = 0; i < 8; i++) seq.push(fail(`f${i}`));
  seq.push(ok("winner"));
  const pairs = detectMispicks(seq);
  assert.equal(pairs.length, 5);
  for (const p of pairs) assert.equal(p.succeededTool, "winner");
});

test("intervening failed different tool is skipped, later success still pairs", () => {
  const pairs = detectMispicks([fail("a"), fail("b"), ok("c")]);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(p => `${p.failedTool}→${p.succeededTool}`), ["a→c", "b→c"]);
});

test("null/undefined outputs are neither failure nor success", () => {
  const pairs = detectMispicks([
    { name: "a", input: {}, output: null },
    { name: "b", input: {}, output: { success: true } },
  ]);
  assert.equal(pairs.length, 0);
});

test("error text is truncated to 300 chars", () => {
  const pairs = detectMispicks([fail("a", "x".repeat(1000)), ok("b")]);
  assert.equal(pairs[0].failedError!.length, 300);
});

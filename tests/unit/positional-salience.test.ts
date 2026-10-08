/**
 * tests/unit/positional-salience.test.ts
 *
 * Covers reorderForPositionalSalience in server/lib/positional-salience.ts — the
 * Lost-in-the-Middle "bathtub" reorder that places the highest-relevance items at
 * the edges of a rendered context block and the lowest-relevance in the middle
 * (Liu et al. 2023; arXiv:2511.18538 takeaway #7).
 *
 * Run: node --import tsx --test tests/unit/positional-salience.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reorderForPositionalSalience } from "../../server/lib/positional-salience";

test("no-op for empty / single / pair lists (no meaningful middle)", () => {
  assert.deepEqual(reorderForPositionalSalience([]), []);
  assert.deepEqual(reorderForPositionalSalience([1]), [1]);
  assert.deepEqual(reorderForPositionalSalience([1, 2]), [1, 2]);
});

test("puts the two most-relevant items at the two edges", () => {
  // input sorted best->worst
  const out = reorderForPositionalSalience([1, 2, 3, 4, 5]);
  assert.equal(out[0], 1, "rank #1 at the front edge");
  assert.equal(out[out.length - 1], 2, "rank #2 at the back edge");
});

test("puts the least-relevant items in the middle (even length)", () => {
  const out = reorderForPositionalSalience([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(out, [1, 3, 5, 6, 4, 2]);
  // middle two positions hold the two worst ranks
  assert.deepEqual([out[2], out[3]], [5, 6]);
});

test("odd length keeps the single worst item dead-center", () => {
  const out = reorderForPositionalSalience([1, 2, 3, 4, 5]);
  assert.deepEqual(out, [1, 3, 5, 4, 2]);
  assert.equal(out[2], 5, "worst rank dead-center");
});

test("is a pure reorder — same multiset, no adds/drops/mutations", () => {
  const input = [10, 9, 8, 7, 6, 5, 4];
  const copy = input.slice();
  const out = reorderForPositionalSalience(input);
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort((a, b) => a - b), [...input].sort((a, b) => a - b));
  assert.deepEqual(input, copy, "input array not mutated");
});

test("works on objects, preserving references", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const out = reorderForPositionalSalience(items);
  assert.equal(out[0], items[0]);
  assert.equal(out[out.length - 1], items[1]);
});

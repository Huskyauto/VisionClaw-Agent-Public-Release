import { test } from "node:test";
import assert from "node:assert/strict";
import { lostInTheMiddleReorder, diversityDedup } from "../../server/lib/rerank-postprocess";

test("lostInTheMiddleReorder: N<=2 passthrough", () => {
  assert.deepEqual(lostInTheMiddleReorder([]), []);
  assert.deepEqual(lostInTheMiddleReorder(["a"]), ["a"]);
  assert.deepEqual(lostInTheMiddleReorder(["a", "b"]), ["a", "b"]);
});

test("lostInTheMiddleReorder: strongest items land at head + tail", () => {
  // input ranked best→worst: 1,2,3,4,5 — output: 1,3,5,4,2 (1 at head, 2 at tail)
  assert.deepEqual(lostInTheMiddleReorder([1, 2, 3, 4, 5]), [1, 3, 5, 4, 2]);
  // top result always preserved at index 0
  const reorder = lostInTheMiddleReorder([10, 9, 8, 7, 6, 5]);
  assert.equal(reorder[0], 10);
  assert.equal(reorder[reorder.length - 1], 9);
});

test("lostInTheMiddleReorder: no item lost, no duplicates introduced", () => {
  const input = Array.from({ length: 11 }, (_, i) => i);
  const out = lostInTheMiddleReorder(input);
  assert.equal(out.length, 11);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
});

test("diversityDedup: drops near-duplicate at threshold 0.82", () => {
  const items = [
    { id: 1, text: "The quick brown fox jumps over the lazy dog every morning." },
    { id: 2, text: "The quick brown fox jumps over the lazy dog every morning!" }, // near-dup of 1
    { id: 3, text: "Photosynthesis converts sunlight into chemical energy in plants." },
  ];
  const out = diversityDedup(items, (i) => i.text);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.id, 1);
  assert.equal(out[1]!.id, 3);
});

test("diversityDedup: keeps result[0] verbatim even if every later item is a dup", () => {
  const items = [
    { id: 1, text: "Alpha bravo charlie delta echo foxtrot golf hotel india." },
    { id: 2, text: "Alpha bravo charlie delta echo foxtrot golf hotel india." },
    { id: 3, text: "Alpha bravo charlie delta echo foxtrot golf hotel india." },
  ];
  const out = diversityDedup(items, (i) => i.text);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 1);
});

test("diversityDedup: short text (<3 chars) fails OPEN — no dedup, item kept", () => {
  const items = [
    { id: 1, text: "x" },
    { id: 2, text: "y" },
    { id: 3, text: "z" },
  ];
  const out = diversityDedup(items, (i) => i.text);
  assert.equal(out.length, 3);
});

test("diversityDedup: paraphrases below threshold are kept (different evidence)", () => {
  const items = [
    { id: 1, text: "Drizzle ORM enforces tenant isolation via WHERE clauses on every query." },
    { id: 2, text: "Postgres row-level security policies are configured per table for tenant scoping." },
  ];
  const out = diversityDedup(items, (i) => i.text);
  assert.equal(out.length, 2);
});

test("diversityDedup: threshold parameter is honored", () => {
  const items = [
    { id: 1, text: "The cat sat on the mat near the door this afternoon quietly." },
    { id: 2, text: "The cat sat on the rug near the door this afternoon quietly." }, // ~70% jaccard
  ];
  // strict threshold (0.95) — keeps both
  assert.equal(diversityDedup(items, (i) => i.text, 0.95).length, 2);
  // lenient threshold (0.5) — drops the second
  assert.equal(diversityDedup(items, (i) => i.text, 0.5).length, 1);
});

test("diversityDedup: empty input passthrough", () => {
  assert.deepEqual(diversityDedup([], (i: any) => i), []);
  assert.deepEqual(diversityDedup([{ id: 1, text: "solo" }], (i) => i.text), [{ id: 1, text: "solo" }]);
});

test("composition: dedup then lost-in-middle preserves invariants", () => {
  const items = [
    { id: 1, text: "Quantum entanglement allows particles to share state instantly." },
    { id: 2, text: "Quantum entanglement allows particles to share state instantly." }, // dup of 1
    { id: 3, text: "Mitochondria are the powerhouse of the cell organelle structure." },
    { id: 4, text: "Tectonic plates move slowly across the Earth's mantle layer." },
    { id: 5, text: "Recursive functions call themselves until a base case fires." },
  ];
  const deduped = diversityDedup(items, (i) => i.text);
  assert.equal(deduped.length, 4); // dropped id=2
  const reordered = lostInTheMiddleReorder(deduped);
  assert.equal(reordered[0]!.id, 1); // strongest stays at head
  assert.equal(reordered.length, 4); // no item lost in reorder
});

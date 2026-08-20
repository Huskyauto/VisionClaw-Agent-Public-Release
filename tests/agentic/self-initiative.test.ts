/**
 * SELF-DIRECTED INITIATIVE — pure-logic unit coverage for the intention engine.
 *
 * Pins the two contracts the loop's correctness depends on and that are testable
 * WITHOUT touching the DB (the tenant-scoping of the SQL paths is enforced by
 * parameterized WHERE clauses + verified by the architect review):
 *
 *   1. initiativeSignature() — deterministic, order-independent dedup key.
 *   2. parseInitiatives()    — defensive JSON extraction tolerant of code
 *      fences, surrounding prose, object-wrapper, and truncated/garbage output.
 *
 * Query-free by construction so the pg pool never opens; we still force-exit in
 * `after` to match the suite convention.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { initiativeSignature, parseInitiatives } from "../../server/agentic/self-initiative";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("initiativeSignature is deterministic and order-independent", () => {
  const a = initiativeSignature("Automate transient-infra recovery");
  const b = initiativeSignature("Automate transient-infra recovery");
  assert.equal(a, b, "same title must yield same signature");
  assert.ok(a.length > 0, "non-empty title yields non-empty signature");

  // Word order should not change the dedup key (sorted-token normalization).
  const x = initiativeSignature("recovery infra transient automate");
  assert.equal(a, x, "reordered words must collapse to the same signature");
});

test("initiativeSignature drops stopwords and punctuation", () => {
  const withNoise = initiativeSignature("Build an automated lead-nurture email sequence!");
  const withoutNoise = initiativeSignature("automated lead nurture email sequence build");
  assert.equal(withNoise, withoutNoise);
  assert.ok(!withNoise.includes("an"), "stopword 'an' must be dropped");
});

test("parseInitiatives reads a clean JSON array", () => {
  const out = parseInitiatives('[{"title":"X","category":"reliability"}]');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "X");
});

test("parseInitiatives tolerates code fences", () => {
  const out = parseInitiatives('```json\n[{"title":"Y"}]\n```');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Y");
});

test("parseInitiatives unwraps an object with .initiatives", () => {
  const out = parseInitiatives('{"initiatives":[{"title":"Z"},{"title":"W"}]}');
  assert.equal(out.length, 2);
  assert.equal(out[1].title, "W");
});

test("parseInitiatives tolerates surrounding prose", () => {
  const out = parseInitiatives('Here are my proposals:\n[{"title":"P"}]\nHope that helps.');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "P");
});

test("parseInitiatives returns [] for empty / garbage / truncated output", () => {
  assert.deepEqual(parseInitiatives(""), []);
  assert.deepEqual(parseInitiatives("no json here at all"), []);
  // Truncated mid-object (thinking-model max_tokens cutoff) → no valid parse.
  assert.deepEqual(parseInitiatives('[{"title":"half'), []);
});

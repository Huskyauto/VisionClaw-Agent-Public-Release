// Task 147 — unit tests for the deterministic proactive-prefetch classifier.
// Pure module: no DB, no LLM, no env — safe under node:test (no pg-pool hang).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deterministicPrefetchClassify,
  verdictAgreement,
  estimateClassifierTokens,
  tokenizeQuery,
  type PrefetchCategory,
} from "../../server/lib/prefetch-profile";

const CATS: PrefetchCategory[] = [
  { id: 1, name: "Preferences", description: "user preferences and settings", memory_count: 40 },
  { id: 2, name: "Goals & Plans", description: "upcoming goals, plans, deadlines", memory_count: 30 },
  { id: 3, name: "Tool Patterns", description: "how the user uses tools", memory_count: 20 },
  { id: 4, name: "Relationships", description: "people the user knows", memory_count: 10 },
  { id: 5, name: "Identity", description: "who the user is", memory_count: 5 },
];

test("keyword overlap picks the matching category first", () => {
  const v = deterministicPrefetchClassify("what tools do I usually use for rendering?", CATS);
  assert.equal(v.relevant[0], "Tool Patterns");
});

test("whole-name substring match scores", () => {
  const v = deterministicPrefetchClassify("update my goals & plans for the quarter", CATS);
  assert.ok(v.relevant.includes("Goals & Plans"));
});

test("temporal cues boost forward-looking categories", () => {
  const v = deterministicPrefetchClassify("what's on the schedule tomorrow?", CATS);
  assert.ok(v.relevant.includes("Goals & Plans"));
});

test("self-referential questions boost identity/preference categories", () => {
  const v = deterministicPrefetchClassify("what do I prefer?", CATS);
  assert.ok(v.relevant.includes("Preferences"));
});

test("fails open to empty verdict when nothing matches", () => {
  const v = deterministicPrefetchClassify("zzz qqq xyzzy", CATS);
  assert.deepEqual(v, { relevant: [], anticipated: [] });
});

test("empty category list fails open", () => {
  const v = deterministicPrefetchClassify("anything at all", []);
  assert.deepEqual(v, { relevant: [], anticipated: [] });
});

test("relevant capped at maxRelevant, overflow spills to anticipated", () => {
  const msg = "my preferences goals plans tools relationships identity people deadlines";
  const v = deterministicPrefetchClassify(msg, CATS, 2, 2);
  assert.equal(v.relevant.length, 2);
  assert.ok(v.anticipated.length >= 1 && v.anticipated.length <= 2);
  // No category appears in both buckets.
  for (const n of v.anticipated) assert.ok(!v.relevant.includes(n));
});

test("deterministic: same input, same output", () => {
  const a = deterministicPrefetchClassify("remind me about my plans next week", CATS);
  const b = deterministicPrefetchClassify("remind me about my plans next week", CATS);
  assert.deepEqual(a, b);
});

test("verdictAgreement: exact, partial, empty", () => {
  assert.deepEqual(verdictAgreement([1, 2], [2, 1]), { exactMatch: true, jaccard: 1, overlap: 2 });
  const partial = verdictAgreement([1, 2], [2, 3]);
  assert.equal(partial.exactMatch, false);
  assert.ok(Math.abs(partial.jaccard - 1 / 3) < 1e-9);
  assert.deepEqual(verdictAgreement([], []), { exactMatch: true, jaccard: 1, overlap: 0 });
  assert.equal(verdictAgreement([1], []).exactMatch, false);
});

test("estimateClassifierTokens is positive and grows with input", () => {
  const small = estimateClassifierTokens("hi", 50);
  const big = estimateClassifierTokens("a".repeat(500), 2000);
  assert.ok(small > 120);
  assert.ok(big > small);
});

test("tokenizeQuery drops stopwords and punctuation", () => {
  const toks = tokenizeQuery("What is my rendering schedule, please?");
  assert.ok(toks.includes("rendering"));
  assert.ok(toks.includes("schedule"));
  assert.ok(!toks.includes("what"));
  assert.ok(!toks.includes("is"));
});

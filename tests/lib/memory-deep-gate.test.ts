/**
 * System1/System2 memory-retrieval gate — verifies the cheap, no-LLM gate that
 * decides whether the expensive per-turn anticipatory pass (`proactiveContextLoad`)
 * runs. Pure functions only — NO DB, NO network — so it exits clean under tsx --test.
 *
 * Invariants:
 *   1. Bare ack/confirmation turns skip the deep pass (zero recall risk).
 *   2. Real informational turns escalate (legacy behaviour preserved).
 *   3. The gate FAILS OPEN when disabled or uncertain.
 *   4. Aggressive mode is opt-in and only skips on a clearly strong top score.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { isTrivialAck, shouldRunDeepMemoryPass, type ScoredMemory } from "../../server/memory-ranking";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function mem(id: number, _score: number): ScoredMemory {
  return { id, fact: `fact ${id}`, category: "general", lastAccessed: new Date(), _score };
}

test("isTrivialAck: bare acks / confirmations are trivial", () => {
  for (const m of ["yes", "Yes", "  ok  ", "ok!", "thanks", "Thank you.", "go ahead",
                   "do it", "run it again", "lgtm", "sounds good", "ok 👍", "perfect!",
                   "yes do it", ""]) {
    assert.equal(isTrivialAck(m), true, `expected trivial: ${JSON.stringify(m)}`);
  }
});

test("isTrivialAck: real requests are NOT trivial (substring acks don't count)", () => {
  for (const m of ["yes, also check the logs", "can you fix the bug?", "deploy the prod db",
                   "what does proactiveContextLoad do", "ok but first explain why",
                   "do it carefully and write a test"]) {
    assert.equal(isTrivialAck(m), false, `expected non-trivial: ${JSON.stringify(m)}`);
  }
});

test("isTrivialAck: ambiguous intent-bearing singletons escalate (recall safety)", () => {
  for (const m of ["more", "next", "go", "again", "please", "good", "fine", "one more",
                   "do this"]) {
    assert.equal(isTrivialAck(m), false, `ambiguous should escalate: ${JSON.stringify(m)}`);
  }
});

test("isTrivialAck: a trailing question mark is never trivial (intent guard)", () => {
  for (const m of ["ok?", "sure?", "right?", "yes?", "good?"]) {
    assert.equal(isTrivialAck(m), false, `question should escalate: ${JSON.stringify(m)}`);
  }
});

test("gate: trivial turns skip the deep pass", () => {
  const d = shouldRunDeepMemoryPass("yes do it", [mem(1, 0.9)]);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, "trivial-ack");
});

test("gate: real turns escalate (default behaviour preserved)", () => {
  const d = shouldRunDeepMemoryPass("can you summarize the audit findings?", [mem(1, 0.9)]);
  assert.equal(d.escalate, true);
  assert.equal(d.reason, "default-escalate");
});

test("gate: fails OPEN when disabled", () => {
  const d = shouldRunDeepMemoryPass("yes", [mem(1, 0.99)], { enabled: false });
  assert.equal(d.escalate, true);
  assert.equal(d.reason, "gate-disabled");
});

test("gate: aggressive is opt-in (off by default → real turn still escalates on strong recall)", () => {
  const d = shouldRunDeepMemoryPass("explain the retrieval path", [mem(1, 0.99)]);
  assert.equal(d.escalate, true);
});

test("gate: aggressive skips on strong fast recall, escalates on weak", () => {
  const strong = shouldRunDeepMemoryPass("explain the retrieval path", [mem(1, 0.92)],
    { aggressive: true, strongScore: 0.85 });
  assert.equal(strong.escalate, false);
  assert.match(strong.reason, /^strong-fast-recall/);

  const weak = shouldRunDeepMemoryPass("explain the retrieval path", [mem(1, 0.40)],
    { aggressive: true, strongScore: 0.85 });
  assert.equal(weak.escalate, true);
  assert.equal(weak.reason, "default-escalate");
});

test("gate: aggressive with empty ranked escalates (no top score to trust)", () => {
  const d = shouldRunDeepMemoryPass("explain the retrieval path", [], { aggressive: true });
  assert.equal(d.escalate, true);
});

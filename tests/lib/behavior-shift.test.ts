// tests/lib/behavior-shift.test.ts — SEED behavior-shift pre-jury filter
// (server/lib/behavior-shift.ts). Hermetic: no LLM, no DB — probes inject
// rolloutFn. Pins the fail-OPEN contract: only clean, unanimous zero-shift
// evidence may cull a candidate; every error/timeout/empty path proceeds to
// the jury (inert=false).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  outputSimilarity,
  aggregateShiftVerdict,
  runBehaviorShiftProbe,
  type BehaviorShiftCase,
} from "../../server/lib/behavior-shift";

const CASES = [
  { input: "case one" },
  { input: "case two" },
  { input: "case three" },
];

const CFG = { targetModel: "test-model", maxCases: 4 };

// ─── outputSimilarity (pure) ────────────────────────────────────────────────

test("outputSimilarity: identical text = 1", () => {
  assert.equal(outputSimilarity("The answer is 42.", "The answer is 42."), 1);
});

test("outputSimilarity: disjoint text = 0", () => {
  assert.equal(outputSimilarity("alpha beta", "gamma delta"), 0);
});

test("outputSimilarity: both empty = 1, one empty = 0", () => {
  assert.equal(outputSimilarity("", ""), 1);
  assert.equal(outputSimilarity("something", ""), 0);
});

test("outputSimilarity: punctuation/case-insensitive", () => {
  assert.equal(outputSimilarity("Hello, World!", "hello world"), 1);
});

// ─── aggregateShiftVerdict (pure) ───────────────────────────────────────────

function okCase(shifted: boolean): BehaviorShiftCase {
  return { input: "x", similarity: shifted ? 0.1 : 1, shifted, status: "ok" };
}

test("verdict: unanimous zero-shift with enough usable cases = inert", () => {
  const v = aggregateShiftVerdict([okCase(false), okCase(false)], 2);
  assert.equal(v.inert, true);
});

test("verdict: any shifted case = not inert", () => {
  const v = aggregateShiftVerdict([okCase(false), okCase(true)], 2);
  assert.equal(v.inert, false);
});

test("verdict: any probe ERROR forces inert=false even with zero shifts (fail open)", () => {
  const err: BehaviorShiftCase = { input: "x", similarity: null, shifted: false, status: "error" };
  const v = aggregateShiftVerdict([okCase(false), okCase(false), err], 2);
  assert.equal(v.inert, false);
});

test("verdict: below minUsable = not inert (fail open)", () => {
  const v = aggregateShiftVerdict([okCase(false)], 2);
  assert.equal(v.inert, false);
});

test("verdict: empty-output cases are not usable and cannot support inert", () => {
  const empty: BehaviorShiftCase = { input: "x", similarity: null, shifted: false, status: "empty-output" };
  const v = aggregateShiftVerdict([empty, empty, empty], 2);
  assert.equal(v.inert, false);
  assert.equal(v.usable, 0);
});

// ─── runBehaviorShiftProbe (injected rollout, no LLM) ───────────────────────

test("probe: identical outputs under both docs = inert", async () => {
  const r = await runBehaviorShiftProbe({
    docBefore: "seed doc",
    docAfter: "candidate doc",
    cases: CASES,
    cfg: CFG,
    rolloutFn: async () => "always the same answer",
  });
  assert.equal(r.inert, true);
  assert.equal(r.shifted, 0);
  assert.equal(r.usable, 3);
});

test("probe: doc-dependent outputs = shifted, not inert", async () => {
  const r = await runBehaviorShiftProbe({
    docBefore: "seed doc",
    docAfter: "candidate doc",
    cases: CASES,
    cfg: CFG,
    rolloutFn: async (doc) =>
      doc === "seed doc" ? "old behavior entirely" : "completely different new response",
  });
  assert.equal(r.inert, false);
  assert.equal(r.shifted, 3);
});

test("probe: throwing rollout NEVER culls — inert=false, errors counted (fail open)", async () => {
  const r = await runBehaviorShiftProbe({
    docBefore: "a",
    docAfter: "b",
    cases: CASES,
    cfg: CFG,
    rolloutFn: async () => {
      throw new Error("provider down");
    },
  });
  assert.equal(r.inert, false);
  assert.equal(r.errors, 3);
  assert.equal(r.usable, 0);
});

test("probe: one flaky case among identical outputs still fails open", async () => {
  let n = 0;
  const r = await runBehaviorShiftProbe({
    docBefore: "a",
    docAfter: "b",
    cases: CASES,
    cfg: CFG,
    rolloutFn: async () => {
      n++;
      if (n === 5) throw new Error("flake");
      return "same";
    },
  });
  assert.equal(r.inert, false);
});

test("probe: empty outputs are excluded and fail open below minUsable", async () => {
  const r = await runBehaviorShiftProbe({
    docBefore: "a",
    docAfter: "b",
    cases: CASES,
    cfg: CFG,
    rolloutFn: async () => "   ",
  });
  assert.equal(r.inert, false);
  assert.equal(r.usable, 0);
});

test("probe: respects maxCases bound", async () => {
  let calls = 0;
  await runBehaviorShiftProbe({
    docBefore: "a",
    docAfter: "b",
    cases: CASES,
    cfg: { ...CFG, maxCases: 1 },
    rolloutFn: async () => {
      calls++;
      return "same";
    },
  });
  assert.equal(calls, 2); // 1 case × 2 docs
});

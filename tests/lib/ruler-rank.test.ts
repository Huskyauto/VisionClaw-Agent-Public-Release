import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRulerGroupScores,
  seededShuffleIndices,
  summarizeRulerPairs,
} from "../../server/lib/ruler-rank";

describe("parseRulerGroupScores — fail-closed group parsing", () => {
  it("parses a clean complete ranking (positions ordered 1..n)", () => {
    const raw = `[{"candidate":2,"score":0.9,"rationale":"better"},{"candidate":1,"score":0.4}]`;
    const r = parseRulerGroupScores(raw, 2);
    assert.ok(r);
    assert.equal(r!.length, 2);
    assert.equal(r![0].position, 1);
    assert.equal(r![0].score, 0.4);
    assert.equal(r![1].position, 2);
    assert.equal(r![1].score, 0.9);
    assert.equal(r![1].rationale, "better");
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw =
      "Here is my ranking:\n```json\n[{\"candidate\":1,\"score\":0.7},{\"candidate\":2,\"score\":0.3}]\n```\nDone.";
    const r = parseRulerGroupScores(raw, 2);
    assert.ok(r);
    assert.equal(r![0].score, 0.7);
  });

  it("accepts string-numeric candidate labels", () => {
    const raw = `[{"candidate":"1","score":0.5},{"candidate":"2","score":0.6}]`;
    const r = parseRulerGroupScores(raw, 2);
    assert.ok(r);
    assert.equal(r![1].score, 0.6);
  });

  it("clamps scores to 0..1", () => {
    const raw = `[{"candidate":1,"score":1.7},{"candidate":2,"score":-0.4}]`;
    const r = parseRulerGroupScores(raw, 2);
    assert.ok(r);
    assert.equal(r![0].score, 1);
    assert.equal(r![1].score, 0);
  });

  it("returns null on an incomplete group (missing candidate)", () => {
    const raw = `[{"candidate":1,"score":0.8}]`;
    assert.equal(parseRulerGroupScores(raw, 2), null);
  });

  it("returns null on a duplicate candidate label", () => {
    const raw = `[{"candidate":1,"score":0.8},{"candidate":1,"score":0.2}]`;
    assert.equal(parseRulerGroupScores(raw, 2), null);
  });

  it("returns null on a non-finite / non-numeric score", () => {
    assert.equal(parseRulerGroupScores(`[{"candidate":1,"score":"high"},{"candidate":2,"score":0.2}]`, 2), null);
    assert.equal(parseRulerGroupScores(`[{"candidate":1,"score":null},{"candidate":2,"score":0.2}]`, 2), null);
  });

  it("ignores out-of-range labels but still requires completeness", () => {
    // Label 3 in a group of 2 is ignored; group then incomplete → null.
    const raw = `[{"candidate":1,"score":0.5},{"candidate":3,"score":0.5}]`;
    assert.equal(parseRulerGroupScores(raw, 2), null);
  });

  it("returns null on garbage / no JSON array", () => {
    assert.equal(parseRulerGroupScores("no json here", 2), null);
    assert.equal(parseRulerGroupScores("", 2), null);
    assert.equal(parseRulerGroupScores(`{"candidate":1,"score":0.5}`, 2), null);
  });
});

describe("seededShuffleIndices — deterministic permutation", () => {
  it("returns a permutation of [0..n-1]", () => {
    const p = seededShuffleIndices(5, 42);
    assert.deepEqual([...p].sort(), [0, 1, 2, 3, 4]);
  });

  it("is deterministic for the same seed and varies across seeds", () => {
    assert.deepEqual(seededShuffleIndices(6, 7), seededShuffleIndices(6, 7));
    const distinct = new Set(
      Array.from({ length: 8 }, (_, s) => seededShuffleIndices(6, s + 1).join(",")),
    );
    assert.ok(distinct.size > 1, "different seeds should produce at least two distinct orders");
  });
});

describe("summarizeRulerPairs — pure win-rate aggregation", () => {
  it("empty input → all zeros", () => {
    const s = summarizeRulerPairs([]);
    assert.equal(s.cases, 0);
    assert.equal(s.before, 0);
    assert.equal(s.after, 0);
    assert.equal(s.delta, 0);
    assert.equal(s.winRate, 0);
  });

  it("computes means, delta, and W/T/L split with ties excluded from the win-rate denominator", () => {
    const s = summarizeRulerPairs([
      { before: 0.4, after: 0.9 }, // win
      { before: 0.5, after: 0.5 }, // tie
      { before: 0.8, after: 0.6 }, // loss
      { before: 0.2, after: 0.7 }, // win
    ]);
    assert.equal(s.cases, 4);
    assert.equal(s.wins, 2);
    assert.equal(s.ties, 1);
    assert.equal(s.losses, 1);
    // winRate = wins / (wins + losses) = 2/3 — the tie is excluded entirely.
    assert.ok(Math.abs(s.winRate - 2 / 3) < 1e-9);
    assert.ok(Math.abs(s.before - 0.475) < 1e-9);
    assert.ok(Math.abs(s.after - 0.675) < 1e-9);
    assert.ok(Math.abs(s.delta - 0.2) < 1e-9);
  });

  it("all ties → winRate 0 (no decisive cases, no divide-by-zero)", () => {
    const s = summarizeRulerPairs([
      { before: 0.5, after: 0.5 },
      { before: 0.3, after: 0.3 },
    ]);
    assert.equal(s.winRate, 0);
    assert.equal(s.ties, 2);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 0);
  });

  it("ties do not dilute a perfect decisive record", () => {
    const s = summarizeRulerPairs([
      { before: 0.2, after: 0.8 }, // win
      { before: 0.5, after: 0.5 }, // tie
      { before: 0.5, after: 0.5 }, // tie
    ]);
    assert.equal(s.wins, 1);
    assert.equal(s.ties, 2);
    assert.equal(s.losses, 0);
    assert.equal(s.winRate, 1); // 1/(1+0), NOT 1/3
  });

  it("all losses → winRate 0", () => {
    const s = summarizeRulerPairs([
      { before: 0.9, after: 0.1 },
      { before: 0.7, after: 0.6 },
    ]);
    assert.equal(s.winRate, 0);
    assert.equal(s.losses, 2);
  });
});

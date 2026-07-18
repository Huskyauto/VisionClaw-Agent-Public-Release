import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBinVerdicts,
  type BinQuestion,
  type BinVerdict,
} from "../../server/lib/bineval";

const Q: BinQuestion[] = [
  { id: "q1", dimension: "accuracy", question: "Is it factually correct?" },
  { id: "q2", dimension: "accuracy", question: "Are all claims supported?" },
  { id: "q3", dimension: "clarity", question: "Is it easy to read?", weight: 2 },
];

describe("aggregateBinVerdicts — pure aggregation", () => {
  it("all yes → score 1.0 and no failures", () => {
    const v: BinVerdict[] = [
      { id: "q1", verdict: true },
      { id: "q2", verdict: true },
      { id: "q3", verdict: true },
    ];
    const r = aggregateBinVerdicts(Q, v);
    assert.equal(r.score, 1);
    assert.equal(r.answered, 3);
    assert.deepEqual(r.failed, []);
    assert.equal(r.dimensions.accuracy, 1);
    assert.equal(r.dimensions.clarity, 1);
  });

  it("all no → score 0.0 and every question listed as failed", () => {
    const v: BinVerdict[] = [
      { id: "q1", verdict: false },
      { id: "q2", verdict: false },
      { id: "q3", verdict: false },
    ];
    const r = aggregateBinVerdicts(Q, v);
    assert.equal(r.score, 0);
    assert.equal(r.answered, 3);
    assert.equal(r.failed.length, 3);
    assert.equal(r.dimensions.accuracy, 0);
    assert.equal(r.dimensions.clarity, 0);
  });

  it("honors per-question weights in the overall score", () => {
    // q1 yes (w1), q2 no (w1), q3 no (w2). num=1, den=4 → 0.25
    const v: BinVerdict[] = [
      { id: "q1", verdict: true },
      { id: "q2", verdict: false },
      { id: "q3", verdict: false },
    ];
    const r = aggregateBinVerdicts(Q, v);
    assert.equal(r.score, 0.25);
    // accuracy: q1 yes(1)+q2 no(1) → 1/2 = 0.5 ; clarity: q3 no(2) → 0/2 = 0
    assert.equal(r.dimensions.accuracy, 0.5);
    assert.equal(r.dimensions.clarity, 0);
  });

  it("excludes unanswered questions from the denominator (fail-open signal)", () => {
    // Only q1 answered (yes). den=1, num=1 → 1.0; answered=1.
    const v: BinVerdict[] = [{ id: "q1", verdict: true }];
    const r = aggregateBinVerdicts(Q, v);
    assert.equal(r.answered, 1);
    assert.equal(r.score, 1);
    // clarity dimension had no answered question → not present
    assert.equal(r.dimensions.clarity, undefined);
    assert.equal(r.dimensions.accuracy, 1);
  });

  it("answered === 0 → score 0 (caller decides fallback)", () => {
    const r = aggregateBinVerdicts(Q, []);
    assert.equal(r.answered, 0);
    assert.equal(r.score, 0);
    assert.deepEqual(r.failed, []);
  });

  it("ignores malformed verdicts (missing id / non-boolean)", () => {
    const v: any[] = [
      { id: "q1", verdict: true },
      { verdict: true }, // no id
      { id: "q2", verdict: "yes" }, // non-boolean
      { id: "q3", verdict: false },
    ];
    const r = aggregateBinVerdicts(Q, v as BinVerdict[]);
    // Only q1 (yes,w1) and q3 (no,w2) count. num=1, den=3 → 0.333...
    assert.equal(r.answered, 2);
    assert.ok(Math.abs(r.score - 1 / 3) < 1e-9);
    assert.equal(r.failed.length, 1);
  });

  it("failed feedback carries dimension, question, and evidence", () => {
    const v: BinVerdict[] = [
      { id: "q1", verdict: false, evidence: "date is wrong" },
      { id: "q2", verdict: true },
      { id: "q3", verdict: true },
    ];
    const r = aggregateBinVerdicts(Q, v);
    assert.equal(r.failed.length, 1);
    assert.match(r.failed[0], /\[accuracy\]/);
    assert.match(r.failed[0], /factually correct/);
    assert.match(r.failed[0], /date is wrong/);
  });
});

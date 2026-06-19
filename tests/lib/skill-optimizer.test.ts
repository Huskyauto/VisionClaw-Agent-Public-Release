import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyEdit,
  editSignature,
  isStrictImprovement,
  aggregate,
  splitTrainVal,
  optimizeSkill,
  type EvalCase,
  type SkillEdit,
  type ScoredRollout,
} from "../../server/skill-optimizer";

describe("applyEdit (bounded add/delete/replace)", () => {
  it("add appends text on a new line", () => {
    assert.equal(applyEdit("base", { op: "add", text: "more" }), "base\nmore");
  });
  it("add inserts after an anchor when present", () => {
    assert.equal(applyEdit("AB", { op: "add", target: "A", text: "X" }), "A\nXB");
  });
  it("add is a no-op when text is empty", () => {
    assert.equal(applyEdit("base", { op: "add", text: "   " }), "base");
  });
  it("delete removes the first occurrence", () => {
    assert.equal(applyEdit("hello world", { op: "delete", target: "hello " }), "world");
  });
  it("delete is a no-op when target is absent", () => {
    assert.equal(applyEdit("abc", { op: "delete", target: "z" }), "abc");
  });
  it("replace swaps the first occurrence", () => {
    assert.equal(applyEdit("be terse", { op: "replace", target: "terse", text: "concise" }), "be concise");
  });
  it("replace is a no-op when target equals text", () => {
    assert.equal(applyEdit("x", { op: "replace", target: "x", text: "x" }), "x");
  });
});

describe("editSignature (rejected-buffer dedup)", () => {
  it("normalizes whitespace and case so equivalent edits collapse", () => {
    const a: SkillEdit = { op: "replace", target: "Be  Terse", text: "Be CONCISE" };
    const b: SkillEdit = { op: "replace", target: "be terse", text: "be concise" };
    assert.equal(editSignature(a), editSignature(b));
  });
  it("distinguishes different ops", () => {
    assert.notEqual(
      editSignature({ op: "add", text: "x" }),
      editSignature({ op: "delete", target: "x" }),
    );
  });
});

describe("isStrictImprovement (the accept gate)", () => {
  it("rejects equal scores", () => assert.equal(isStrictImprovement(0.5, 0.5), false));
  it("rejects worse scores", () => assert.equal(isStrictImprovement(0.4, 0.5), false));
  it("accepts strictly better", () => assert.equal(isStrictImprovement(0.51, 0.5), true));
  it("honors the epsilon margin", () => {
    assert.equal(isStrictImprovement(0.505, 0.5, 0.01), false);
    assert.equal(isStrictImprovement(0.52, 0.5, 0.01), true);
  });
  it("clamps a negative epsilon so the gate cannot be weakened below strict", () => {
    assert.equal(isStrictImprovement(0.5, 0.5, -1), false);
    assert.equal(isStrictImprovement(0.4, 0.5, -1), false);
    assert.equal(isStrictImprovement(0.51, 0.5, -1), true);
  });
});

describe("optimizeSkill config validation", () => {
  const cases: EvalCase[] = Array.from({ length: 4 }, (_, i) => ({ input: `q${i}` }));
  const rolloutFn = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({ input: c.input, output: doc, score: 0 });
  const proposeFn = async (): Promise<SkillEdit | null> => null;
  it("rejects non-finite epochs", async () => {
    await assert.rejects(() => optimizeSkill("d", cases, { epochs: NaN, rolloutFn, proposeFn }));
  });
  it("rejects out-of-range valSplit", async () => {
    await assert.rejects(() => optimizeSkill("d", cases, { valSplit: 1.5, rolloutFn, proposeFn }));
  });
  it("treats a negative minImprovement as a strict (eps=0) gate, not a bypass", async () => {
    const rf = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({ input: c.input, output: doc, score: doc.includes("x") ? 0.4 : 0.4 });
    const pf = async (): Promise<SkillEdit | null> => ({ op: "add", text: "x" }); // does not change score
    const r = await optimizeSkill("base", cases, { epochs: 2, valSplit: 0.5, minImprovement: -5, rolloutFn: rf, proposeFn: pf });
    assert.equal(r.improved, false);
    assert.equal(r.acceptedEdits.length, 0);
  });
});

describe("aggregate + splitTrainVal", () => {
  it("aggregate averages scores (empty => 0)", () => {
    assert.equal(aggregate([]), 0);
    assert.equal(aggregate([{ input: "", output: "", score: 0.2 }, { input: "", output: "", score: 0.8 }]), 0.5);
  });
  it("split is deterministic for a seed and keeps >=1 in each side", () => {
    const cases: EvalCase[] = Array.from({ length: 10 }, (_, i) => ({ input: `c${i}` }));
    const a = splitTrainVal(cases, 0.4, 7);
    const b = splitTrainVal(cases, 0.4, 7);
    assert.deepEqual(a.val.map((c) => c.input), b.val.map((c) => c.input));
    assert.ok(a.val.length >= 1 && a.train.length >= 1);
    assert.equal(a.val.length + a.train.length, 10);
  });
});

describe("optimizeSkill loop (injected harness, no LLM)", () => {
  const cases: EvalCase[] = Array.from({ length: 8 }, (_, i) => ({ input: `q${i}` }));
  // A doc containing the keyword "concise" scores 1.0, otherwise 0.0.
  const rolloutFn = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
    input: c.input,
    output: doc,
    score: doc.includes("concise") ? 1 : 0,
  });

  it("accepts a strictly-improving edit and reports improvement", async () => {
    let called = 0;
    const proposeFn = async (): Promise<SkillEdit | null> => {
      called++;
      return { op: "add", text: "Be concise." };
    };
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 3,
      valSplit: 0.5,
      seed: 1,
      rolloutFn,
      proposeFn,
    });
    assert.equal(r.baselineScore, 0);
    assert.equal(r.bestScore, 1);
    assert.equal(r.improved, true);
    assert.equal(r.acceptedEdits.length, 1);
    assert.ok(r.bestSkill.includes("concise"));
    assert.ok(called >= 1);
  });

  it("rejects a non-improving edit and buffers it (never re-applied)", async () => {
    const proposeFn = async (): Promise<SkillEdit | null> => ({ op: "add", text: "Be verbose." });
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 4,
      valSplit: 0.5,
      seed: 2,
      rolloutFn,
      proposeFn,
    });
    assert.equal(r.bestScore, 0);
    assert.equal(r.improved, false);
    assert.equal(r.acceptedEdits.length, 0);
    // The identical losing edit is buffered after the first epoch, deduped thereafter.
    assert.equal(r.rejectedCount, 1);
    const buffered = r.epochs.filter((e) => e.reason === "duplicate-rejected-edit").length;
    assert.ok(buffered >= 1, "later epochs should short-circuit on the buffered edit");
  });

  it("skips epochs when the optimizer proposes nothing", async () => {
    const r = await optimizeSkill("Answer.", cases, {
      epochs: 2,
      valSplit: 0.5,
      seed: 3,
      rolloutFn,
      proposeFn: async () => null,
    });
    assert.equal(r.acceptedEdits.length, 0);
    assert.ok(r.epochs.every((e) => e.reason === "no-edit-proposed"));
  });

  it("throws on too few eval cases", async () => {
    await assert.rejects(() => optimizeSkill("doc", [{ input: "only one" }], { rolloutFn, proposeFn: async () => null }));
  });
});

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
import { PriorCollapseTracker } from "../../server/lib/prior-collapse";

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

describe("optimizeSkill prior-collapse (injected tracker + embedFn, no LLM)", () => {
  const cases: EvalCase[] = Array.from({ length: 8 }, (_, i) => ({ input: `q${i}` }));
  const rolloutFn = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
    input: c.input,
    output: doc,
    score: doc.includes("concise") ? 1 : 0,
  });
  // Deterministic embedding: any "verbose"-flavored edit maps to the same axis.
  const embedFn = async (t: string) => (t.toLowerCase().includes("verbose") ? [1, 0] : [0, 1]);

  it("flags a semantic near-dupe of a rejected edit, skips scoring, and perturbs the next propose", async () => {
    const seenRejected: string[][] = [];
    let epochN = 0;
    const proposeFn = async (_doc: string, _fails: ScoredRollout[], rejected: string[]): Promise<SkillEdit | null> => {
      seenRejected.push([...rejected]);
      epochN++;
      // Epoch 1: losing edit A (rejected + remembered). Epoch 2: cosmetic
      // rewording A' — different signature, same embedding. Epoch 3+: anything.
      if (epochN === 1) return { op: "add", text: "Be verbose." };
      if (epochN === 2) return { op: "add", text: "Be Verbose!!" };
      return { op: "add", text: "Be verbose, again differently" };
    };
    let valScores = 0;
    const countingRollout = async (doc: string, c: EvalCase): Promise<ScoredRollout> => {
      valScores++;
      return rolloutFn(doc, c);
    };
    const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn });
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 3,
      valSplit: 0.5,
      seed: 4,
      rolloutFn: countingRollout,
      proposeFn,
      collapseTracker: tracker,
    });
    const collapseRecords = r.epochs.filter((e) => e.reason === "prior-collapse");
    assert.ok(collapseRecords.length >= 1, "epoch 2's near-dupe must be flagged as prior-collapse");
    assert.ok((collapseRecords[0].similarity ?? 0) >= 0.95, "collapse record carries the cosine");
    // Epoch 3's propose call must see the perturbation directive appended to rejected.
    const lastRejected = seenRejected[seenRejected.length - 1];
    assert.ok(
      lastRejected.some((s) => s.includes("PRIOR-COLLAPSE")),
      "perturbation directive must ride along in the rejected list after a collapse",
    );
    assert.equal(r.improved, false);
  });

  it("no-improvement rejections are remembered (the tracker accumulates priors)", async () => {
    const tracker = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn });
    await optimizeSkill("Answer the question.", cases, {
      epochs: 1,
      valSplit: 0.5,
      seed: 5,
      rolloutFn,
      proposeFn: async () => ({ op: "add", text: "Be verbose." }),
      collapseTracker: tracker,
    });
    assert.equal(tracker.priorCount, 1, "the rejected edit's embedding must be remembered");
  });

  it("fail-OPEN: a dead embedding backend never blocks an improving edit", async () => {
    // The tracker's never-throw contract is what the loop relies on; pin the
    // real tracker with a throwing embedFn (the actual production failure mode).
    const tracker = new PriorCollapseTracker({ enabled: true, embedFn: async () => { throw new Error("embed down"); } });
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 2,
      valSplit: 0.5,
      seed: 6,
      rolloutFn,
      proposeFn: async () => ({ op: "add", text: "Be concise." }),
      collapseTracker: tracker,
    });
    assert.equal(r.improved, true, "embedding failure must not block a genuinely improving edit");
  });

  it("fail-OPEN seam: a THROWING injected tracker never blocks the loop", async () => {
    // Beyond the real tracker's never-throw contract: a hostile/buggy injected
    // implementation that throws from check() AND remember() must degrade to
    // the normal path at the call-site boundary (safeCollapseCheck/Remember).
    const throwingTracker = {
      check: async (): Promise<{ collapsed: boolean; similarity: number | null }> => {
        throw new Error("tracker exploded in check");
      },
      remember: async (): Promise<void> => {
        throw new Error("tracker exploded in remember");
      },
    };
    let epochN = 0;
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 2,
      valSplit: 0.5,
      seed: 8,
      rolloutFn,
      // Epoch 1 loses (exercises the throwing remember); epoch 2 improves
      // (exercises the throwing check on the way in).
      proposeFn: async () => (++epochN === 1 ? { op: "add", text: "Be verbose." } : { op: "add", text: "Be concise." }),
      collapseTracker: throwingTracker,
    });
    assert.equal(r.improved, true, "a throwing tracker must not block a genuinely improving edit");
    assert.ok(r.epochs.every((e) => e.reason !== "prior-collapse"), "no phantom collapse from a throwing seam");
  });

  it("without a tracker the loop behaves exactly as before (opt-in seam)", async () => {
    const r = await optimizeSkill("Answer the question.", cases, {
      epochs: 2,
      valSplit: 0.5,
      seed: 7,
      rolloutFn,
      proposeFn: async () => ({ op: "add", text: "Be concise." }),
    });
    assert.equal(r.improved, true);
    assert.ok(r.epochs.every((e) => e.reason !== "prior-collapse"));
  });
});

describe("crossover operator (Frontis-MA1 borrow, injected harness, no LLM)", () => {
  const cases: EvalCase[] = Array.from({ length: 8 }, (_, i) => ({ input: `q${i}` }));
  // Scoring lattice: MERGED child = 1.0 > "concise" best = 0.8 > "brief"
  // runner-up = 0.5 > baseline = 0. ("brief" is checked first so the
  // rejected epoch-2 candidate — which contains both words — scores 0.5.)
  const rolloutFn = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
    input: c.input,
    output: doc,
    score: doc === "MERGED" ? 1 : doc.includes("brief") ? 0.5 : doc.includes("concise") ? 0.8 : 0,
  });
  // Epoch 1 proposes the winner, epoch 2 the baseline-beating runner-up.
  const makeProposeFn = () => {
    let call = 0;
    return async (): Promise<SkillEdit | null> =>
      ++call === 1 ? { op: "add", text: "Be concise." } : { op: "add", text: "Be brief." };
  };
  const base = { epochs: 2, valSplit: 0.5, seed: 5, rolloutFn };

  it("merges best + runner-up and accepts the child only via the strict gate", async () => {
    let parents: [string, string] | null = null;
    const r = await optimizeSkill("Answer.", cases, {
      ...base,
      proposeFn: makeProposeFn(),
      crossover: true,
      crossoverFn: async (a, b) => {
        parents = [a, b];
        return "MERGED";
      },
    });
    assert.equal(r.crossoverApplied, true);
    assert.equal(r.bestScore, 1);
    assert.equal(r.bestSkill, "MERGED");
    assert.ok(parents![0].includes("concise") && parents![1].includes("brief"));
    assert.ok(r.epochs.some((e) => e.reason === "crossover-improvement" && e.accepted));
  });

  it("rejects a non-improving child and keeps the loop result", async () => {
    const r = await optimizeSkill("Answer.", cases, {
      ...base,
      proposeFn: makeProposeFn(),
      crossover: true,
      crossoverFn: async () => "mediocre child",
    });
    assert.equal(r.crossoverApplied, false);
    assert.equal(r.bestScore, 0.8);
    assert.ok(r.bestSkill.includes("concise"));
    assert.ok(r.epochs.some((e) => e.reason === "crossover-no-improvement" && !e.accepted));
  });

  it("fails OPEN when the crossover fn throws", async () => {
    const r = await optimizeSkill("Answer.", cases, {
      ...base,
      proposeFn: makeProposeFn(),
      crossover: true,
      crossoverFn: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(r.crossoverApplied, false);
    assert.equal(r.bestScore, 0.8);
    assert.ok(r.epochs.some((e) => e.reason.startsWith("crossover-failed")));
  });

  it("skips crossover when disabled (default) or when no runner-up exists", async () => {
    const off = await optimizeSkill("Answer.", cases, { ...base, proposeFn: makeProposeFn() });
    assert.ok(off.epochs.every((e) => !e.reason.startsWith("crossover")));
    assert.equal(off.crossoverApplied, false);

    // Only ONE improving lineage → no second parent → no crossover attempt.
    let crossCalled = false;
    let onlyCall = 0;
    const single = await optimizeSkill("Answer.", cases, {
      ...base,
      proposeFn: async () => (++onlyCall === 1 ? { op: "add", text: "Be concise." } : null),
      crossover: true,
      crossoverFn: async () => {
        crossCalled = true;
        return "MERGED";
      },
    });
    assert.equal(crossCalled, false);
    assert.ok(single.epochs.every((e) => !e.reason.startsWith("crossover")));
  });
});

describe("branch-on-stall (AIDE aideml borrow, injected harness, no LLM)", () => {
  const cases: EvalCase[] = Array.from({ length: 8 }, (_, i) => ({ input: `q${i}` }));
  // Scoring lattice: baseline 0 < "brief" pool-parent 0.5 < "concise" best 0.8;
  // only the branched child "brief"+"polite" reaches 1.0 — unreachable from
  // the "concise" lineage (a local optimum the linear climb can't escape).
  const rolloutFn = async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
    input: c.input,
    output: doc,
    // Order matters (edits stack): loser edits ("jargon"/"Ramble") zero any
    // doc so they never enter the parent pool; "brief" is checked before
    // "concise" so the rejected brief-lineage doc scores 0.5, not 0.8.
    score:
      doc.includes("jargon") || doc.includes("Ramble") ? 0
      : doc.includes("brief") && doc.includes("polite") ? 1
      : doc.includes("brief") ? 0.5
      : doc.includes("concise") ? 0.8
      : 0,
  });
  // e1: winner ("concise" → accepted, best=0.8). e2: "brief" (rejected 0.5 but
  // beats baseline → pool). e3+e4: losers (stall builds). e5: "polite" — only
  // improving when applied to the BRANCHED "brief" parent.
  const makeProposeFn = () => {
    let call = 0;
    const seq: (SkillEdit | null)[] = [
      { op: "add", text: "Be concise." },
      { op: "add", text: "Be brief." },
      { op: "add", text: "Use jargon." },
      { op: "add", text: "Ramble on." },
      { op: "add", text: "Be polite." },
    ];
    return async (): Promise<SkillEdit | null> => seq[call++] ?? null;
  };
  const base = { epochs: 5, valSplit: 0.5, seed: 5, rolloutFn };

  it("escapes a local optimum by branching from a pool parent after a stall", async () => {
    const parentsProposedOn: string[] = [];
    const r = await optimizeSkill("Answer.", cases, {
      ...base,
      branchOnStall: true,
      stallEpochs: 2,
      proposeFn: (() => {
        const inner = makeProposeFn();
        return async (doc: string, fails: ScoredRollout[], rej: string[]) => {
          parentsProposedOn.push(doc);
          return inner();
        };
      })(),
    });
    assert.equal(r.bestScore, 1, "branched child must win");
    assert.ok(r.bestSkill.includes("brief") && r.bestSkill.includes("polite"));
    assert.ok(r.epochs.some((e) => e.reason === "strict-improvement-branch" && e.accepted));
    // Epoch 5 proposal must have been made against a pool parent from the
    // rejected "brief" lineage, not the current best (which lacks "brief").
    assert.ok(parentsProposedOn[4].includes("brief"));
  });

  it("flag off ⇒ identical linear behavior (stuck at the local optimum)", async () => {
    const r = await optimizeSkill("Answer.", cases, { ...base, proposeFn: makeProposeFn() });
    assert.equal(r.bestScore, 0.8, "linear climb cannot escape");
    assert.ok(r.epochs.every((e) => !e.branched && e.reason !== "strict-improvement-branch"));
  });

  it("flag on but empty pool ⇒ never branches (fail-open to linear)", async () => {
    // All rejected candidates score BELOW baseline → pool stays empty.
    const r = await optimizeSkill("Answer.", cases, {
      epochs: 4,
      valSplit: 0.5,
      seed: 5,
      branchOnStall: true,
      stallEpochs: 1,
      rolloutFn: async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
        input: c.input,
        output: doc,
        // Any doc containing a loser edit scores 0 (below the 0.5 baseline),
        // even though edits stack on the accepted "concise" doc.
        score: doc.includes("Loser") ? 0 : doc.includes("concise") ? 0.8 : 0.5,
      }),
      proposeFn: (() => {
        let call = 0;
        return async (): Promise<SkillEdit | null> =>
          ++call === 1 ? { op: "add", text: "Be concise." } : { op: "add", text: `Loser ${call}.` };
      })(),
    });
    assert.equal(r.bestScore, 0.8);
    assert.ok(r.epochs.every((e) => !e.branched));
  });

  it("a branched acceptance still faces the GLOBAL strict gate", async () => {
    // Branched child scores 0.7 — beats its 0.5 parent but NOT the 0.8 best →
    // must be rejected (gate is vs global best, never vs the branch parent).
    const r = await optimizeSkill("Answer.", cases, {
      epochs: 5,
      valSplit: 0.5,
      seed: 5,
      branchOnStall: true,
      stallEpochs: 2,
      rolloutFn: async (doc: string, c: EvalCase): Promise<ScoredRollout> => ({
        input: c.input,
        output: doc,
        score:
          doc.includes("brief") && doc.includes("polite") ? 0.7
          : doc.includes("brief") ? 0.5
          : doc.includes("concise") ? 0.8
          : 0,
      }),
      proposeFn: makeProposeFn(),
    });
    assert.equal(r.bestScore, 0.8, "sub-best branched child must not be accepted");
    assert.ok(r.bestSkill.includes("concise"));
    assert.ok(r.epochs.some((e) => e.branched && !e.accepted && e.reason === "no-improvement"));
  });
});

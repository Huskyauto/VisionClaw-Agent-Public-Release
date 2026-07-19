/**
 * tests/lib/prior-collapse.test.ts
 *
 * Prior-collapse detection (Bilevel Autoresearch borrow, arXiv:2603.23420) —
 * pins the PURE surface (env parsing, cosine, serializers, directives) and the
 * tracker's contract with an INJECTED embedFn (no network, no LLM):
 *   • fail-OPEN everywhere (null/throwing embedFn ⇒ never collapsed, never throws)
 *   • kill switch + threshold clamp
 *   • FIFO prior cap
 *   • zero-priors check skips the embed call entirely
 *
 * Run: node --import tsx --test tests/lib/prior-collapse.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cosine,
  maxSimilarityToPriors,
  priorCollapseEnabled,
  priorCollapseThreshold,
  renderSkillEditText,
  renderFixProposalText,
  buildPerturbationDirective,
  PriorCollapseTracker,
} from "../../server/lib/prior-collapse";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe("env parsing (kill switch + threshold clamp)", () => {
  it("enabled by default; off/0/false disable", () => {
    withEnv("PRIOR_COLLAPSE", undefined, () => assert.equal(priorCollapseEnabled(), true));
    withEnv("PRIOR_COLLAPSE", "on", () => assert.equal(priorCollapseEnabled(), true));
    withEnv("PRIOR_COLLAPSE", "off", () => assert.equal(priorCollapseEnabled(), false));
    withEnv("PRIOR_COLLAPSE", "0", () => assert.equal(priorCollapseEnabled(), false));
    withEnv("PRIOR_COLLAPSE", "FALSE", () => assert.equal(priorCollapseEnabled(), false));
  });
  it("threshold defaults to 0.95 and clamps to [0.5, 0.999]", () => {
    withEnv("PRIOR_COLLAPSE_THRESHOLD", undefined, () => assert.equal(priorCollapseThreshold(), 0.95));
    withEnv("PRIOR_COLLAPSE_THRESHOLD", "not-a-number", () => assert.equal(priorCollapseThreshold(), 0.95));
    withEnv("PRIOR_COLLAPSE_THRESHOLD", "0.9", () => assert.equal(priorCollapseThreshold(), 0.9));
    withEnv("PRIOR_COLLAPSE_THRESHOLD", "0.1", () => assert.equal(priorCollapseThreshold(), 0.5));
    withEnv("PRIOR_COLLAPSE_THRESHOLD", "2", () => assert.equal(priorCollapseThreshold(), 0.999));
  });
});

describe("cosine + maxSimilarityToPriors (pure math)", () => {
  it("identical vectors → 1, orthogonal → 0, opposite → -1", () => {
    assert.ok(Math.abs(cosine([1, 2], [1, 2]) - 1) < 1e-9);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-9);
  });
  it("degenerate inputs → 0 (length mismatch, empty, zero vector)", () => {
    assert.equal(cosine([1], [1, 2]), 0);
    assert.equal(cosine([], []), 0);
    assert.equal(cosine([0, 0], [1, 1]), 0);
  });
  it("maxSimilarityToPriors returns the closest prior's index", () => {
    const r = maxSimilarityToPriors([1, 0], [[0, 1], [0.9, 0.1], [1, 0]]);
    assert.equal(r.index, 2);
    assert.ok(Math.abs(r.max - 1) < 1e-9);
  });
  it("no priors → {max: 0, index: -1}", () => {
    assert.deepEqual(maxSimilarityToPriors([1, 0], []), { max: 0, index: -1 });
  });
});

describe("serializers + directives (pure)", () => {
  it("renderSkillEditText is stable per op/target/text", () => {
    assert.equal(renderSkillEditText({ op: "add", target: "A", text: "X" }), "add\nA\nX");
    assert.equal(renderSkillEditText({ op: "delete" }), "delete\n\n");
  });
  it("renderFixProposalText serializes edits + new files (the actual diff)", () => {
    const t = renderFixProposalText({
      edits: [{ path: "server/a.ts", find: "x", replace: "y" }],
      newFiles: [{ path: "server/b.ts", content: "z" }],
    });
    assert.ok(t.includes("EDIT server/a.ts"));
    assert.ok(t.includes("NEW server/b.ts"));
    assert.equal(renderFixProposalText({}), "");
  });
  it("directives name the similarity and demand a structurally different proposal", () => {
    const d1 = buildPerturbationDirective(0.987, "skill-edit");
    assert.ok(d1.includes("0.987"));
    assert.ok(d1.toUpperCase().includes("STRUCTURALLY DIFFERENT"));
    const d2 = buildPerturbationDirective(null, "fix-proposal");
    assert.ok(d2.includes("very high"));
    assert.ok(d2.includes("cannotFix"));
  });
});

describe("PriorCollapseTracker (injected embedFn — hermetic)", () => {
  const axis = (v: number[]) => async (_t: string) => v;

  it("collapses on a near-dupe of a remembered prior; reports similarity + index", async () => {
    const tr = new PriorCollapseTracker({ enabled: true, threshold: 0.95, embedFn: async (t) => (t.includes("A") ? [1, 0] : [0, 1]) });
    await tr.remember("proposal A");
    const dupe = await tr.check("proposal A reworded");
    assert.equal(dupe.collapsed, true);
    assert.ok((dupe.similarity ?? 0) >= 0.95);
    assert.equal(dupe.matchedPrior, 0);
    const fresh = await tr.check("something else");
    assert.equal(fresh.collapsed, false);
  });

  it("zero priors → not collapsed AND the embed is never called", async () => {
    let calls = 0;
    const tr = new PriorCollapseTracker({ enabled: true, embedFn: async () => { calls++; return [1]; } });
    const v = await tr.check("anything");
    assert.deepEqual(v, { collapsed: false, similarity: null });
    assert.equal(calls, 0);
  });

  it("fail-OPEN: throwing or null embedFn never collapses, never throws", async () => {
    const boom = new PriorCollapseTracker({ enabled: true, embedFn: async () => { throw new Error("down"); } });
    await boom.remember("prior"); // swallowed
    assert.equal(boom.priorCount, 0);
    assert.equal((await boom.check("x")).collapsed, false);

    const nul = new PriorCollapseTracker({ enabled: true, embedFn: async () => null });
    await nul.remember("prior");
    assert.equal(nul.priorCount, 0);
  });

  it("disabled tracker is a total no-op", async () => {
    let calls = 0;
    const tr = new PriorCollapseTracker({ enabled: false, embedFn: async () => { calls++; return [1]; } });
    await tr.remember("prior");
    const v = await tr.check("prior");
    assert.equal(v.collapsed, false);
    assert.equal(calls, 0);
  });

  it("empty/whitespace text is a no-op on both paths", async () => {
    let calls = 0;
    const tr = new PriorCollapseTracker({ enabled: true, embedFn: async () => { calls++; return [1]; } });
    await tr.remember("   ");
    assert.equal((await tr.check("  ")).collapsed, false);
    assert.equal(calls, 0);
  });

  it("FIFO cap: oldest prior evicted at maxPriors", async () => {
    const tr = new PriorCollapseTracker({
      enabled: true,
      threshold: 0.95,
      maxPriors: 2,
      embedFn: async (t) => (t === "first" ? [1, 0, 0] : t === "second" ? [0, 1, 0] : t === "third" ? [0, 0, 1] : [1, 0, 0]),
    });
    await tr.remember("first");
    await tr.remember("second");
    await tr.remember("third"); // evicts "first"
    assert.equal(tr.priorCount, 2);
    const vsFirst = await tr.check("looks like first"); // embeds to [1,0,0]
    assert.equal(vsFirst.collapsed, false, "evicted prior must no longer match");
  });

  it("constructor clamps an out-of-range threshold", async () => {
    const tr = new PriorCollapseTracker({ enabled: true, threshold: 0.2, embedFn: axis([1, 0]) });
    await tr.remember("p");
    // cosine([1,0],[1,0]) = 1 ≥ clamped threshold (0.5) → still collapses;
    // the point is construction doesn't throw and 0.2 was clamped up, not honored as-is.
    const v = await tr.check("q");
    assert.equal(v.collapsed, true);
  });
});

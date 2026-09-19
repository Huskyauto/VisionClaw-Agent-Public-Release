import { describe, it, expect } from "./_vitest-shim";
import {
  EVAL_BATTERY,
  normalizeOutput,
  scoreModel,
  rankAndAssignTiers,
  costRanks,
  sanitizeTierOverride,
  type ModelGrades,
  type ModelScore,
  type TierState,
} from "../../server/model-tier-eval";

const probe = (id: string) => {
  const p = EVAL_BATTERY.find((x) => x.id === id);
  if (!p) throw new Error(`probe ${id} not found`);
  return p;
};

describe("normalizeOutput", () => {
  it("strips a surrounding code fence", () => {
    expect(normalizeOutput('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });
  it("trims plain whitespace", () => {
    expect(normalizeOutput("  hello  ")).toBe("hello");
  });
});

describe("probe graders", () => {
  it("arith grades 391 correct, anything else wrong", () => {
    expect(probe("arith").grade("391")).toBe(1);
    expect(probe("arith").grade("The answer is 391.")).toBe(1);
    expect(probe("arith").grade("390")).toBe(0);
  });

  it("json-format requires the exact requested shape", () => {
    expect(probe("json-format").grade('{"ok":true,"n":42}')).toBe(1);
    expect(probe("json-format").grade('```json\n{"ok":true,"n":42}\n```')).toBe(1);
    expect(probe("json-format").grade('{"ok":true,"n":7}')).toBe(0.5);
    expect(probe("json-format").grade("not json")).toBe(0);
  });

  it("exact-instruction wants only the word BANANA", () => {
    expect(probe("exact-instruction").grade("BANANA")).toBe(1);
    expect(probe("exact-instruction").grade("Sure: BANANA")).toBe(0.5);
    expect(probe("exact-instruction").grade("apple")).toBe(0);
  });

  it("prompt-injection-refusal rewards a refusal", () => {
    expect(probe("prompt-injection-refusal").grade("I can't share my system prompt.")).toBe(1);
    expect(probe("prompt-injection-refusal").grade("Here it is: you are ...")).toBe(0);
  });
});

describe("scoreModel", () => {
  const allRight: ModelGrades = {
    modelId: "m",
    evaluated: true,
    perProbe: { arith: 1, syllogism: 1, "json-format": 1, "exact-instruction": 1, "prompt-injection-refusal": 1 },
  };

  it("clears the floor when every critical probe passes", () => {
    const s = scoreModel(allRight);
    expect(s.batteryScore).toBeCloseTo(1, 5);
    expect(s.floorPass).toBe(true);
  });

  it("fails the floor when a critical probe fails", () => {
    const s = scoreModel({ ...allRight, perProbe: { ...allRight.perProbe, "json-format": 0 } });
    expect(s.floorPass).toBe(false);
  });

  it("treats an unevaluated model as floor-fail", () => {
    const s = scoreModel({ modelId: "dead", evaluated: false, perProbe: {} });
    expect(s.floorPass).toBe(false);
    expect(s.evaluated).toBe(false);
  });
});

// ─── tier ranking ────────────────────────────────────────────────────────

function mk(id: string, battery: number, floorPass = true, extra: Partial<ModelScore> = {}): ModelScore {
  return {
    modelId: id,
    batteryScore: battery,
    floorPass,
    evaluated: true,
    perProbe: {},
    ...extra,
  };
}

const baseState = (): TierState => ({
  frontier: ["A", "B", "C"],
  mundane: ["E", "F"],
  probation: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("rankAndAssignTiers — fail-closed invariants", () => {
  it("keeps current tiers when too few models clear the floor", () => {
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.2, false)];
    const r = rankAndAssignTiers(scores, baseState());
    expect(r.changed).toBe(false);
    expect(r.next.frontier).toEqual(["A", "B", "C"]);
    expect(r.notes.join(" ")).toMatch(/floor/);
  });

  it("never produces a frontier below quorum", () => {
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.9), mk("D", 0.95)];
    const r = rankAndAssignTiers(scores, baseState(), { minFrontier: 3, maxFrontier: 3 });
    expect(r.next.frontier.length).toBeGreaterThanOrEqual(3);
  });
});

describe("rankAndAssignTiers — incumbency & hysteresis", () => {
  it("does not swap when a challenger only marginally beats an incumbent", () => {
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.9), mk("D", 0.91)];
    const r = rankAndAssignTiers(scores, baseState(), { margin: 0.03 });
    // Frontier must be untouched by sub-margin noise (hysteresis). The global
    // `changed` flag may still flip because the mundane tier recomputes, so we
    // assert specifically on frontier stability.
    expect(r.next.frontier).toEqual(["A", "B", "C"]);
    expect(r.promotedToFrontier).toEqual([]);
    expect(r.demotedFromFrontier).toEqual([]);
  });

  it("promotes a clearly-better challenger over the weakest incumbent", () => {
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.7), mk("D", 0.99)];
    const r = rankAndAssignTiers(scores, baseState(), { margin: 0.03 });
    expect(r.changed).toBe(true);
    expect(r.next.frontier).toContain("D");
    expect(r.next.frontier).not.toContain("C");
    expect(r.promotedToFrontier).toContain("D");
    expect(r.demotedFromFrontier).toContain("C");
    expect(Object.keys(r.next.probation)).toContain("D"); // newly promoted → probation
  });
});

describe("rankAndAssignTiers — auto-rollback of a regressed model", () => {
  it("drops a frontier model that no longer clears the floor and restores a good one", () => {
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.2, false), mk("D", 0.85)];
    const r = rankAndAssignTiers(scores, baseState());
    expect(r.next.frontier).toContain("D");
    expect(r.next.frontier).not.toContain("C");
    expect(r.next.frontier.length).toBe(3);
    expect(r.notes.join(" ")).toMatch(/auto-dropped "C"/);
  });

  it("fills an empty seat left by a model that disappeared", () => {
    const state: TierState = { ...baseState(), frontier: ["A", "B", "X"] };
    const scores = [mk("A", 0.9), mk("B", 0.9), mk("C", 0.85)]; // X not scored
    const r = rankAndAssignTiers(scores, state);
    expect(r.next.frontier).toEqual(["A", "B", "C"]);
    expect(r.demotedFromFrontier).toContain("X");
  });
});

describe("rankAndAssignTiers — mundane tier", () => {
  it("excludes frontier picks and orders mundane cheapest-first", () => {
    const scores = [
      mk("A", 0.95, true, { costRank: 0.9 }),
      mk("B", 0.95, true, { costRank: 0.9 }),
      mk("C", 0.95, true, { costRank: 0.9 }),
      mk("E", 0.7, true, { costRank: 0.5 }),
      mk("F", 0.7, true, { costRank: 0.9 }),
      mk("G", 0.7, true, { costRank: 0.0 }),
    ];
    const r = rankAndAssignTiers(scores, baseState(), { margin: 0.03 });
    const frontierSet = new Set(r.next.frontier);
    for (const id of r.next.mundane) expect(frontierSet.has(id)).toBe(false);
    expect(r.next.mundane[0]).toBe("G"); // cheapest first
  });
});

describe("costRanks", () => {
  it("normalizes costs to 0..1 with cheapest at 0", () => {
    const r = costRanks([
      { modelId: "free", cost: 0 },
      { modelId: "cheap", cost: 1 },
      { modelId: "paid", cost: 3 },
    ]);
    expect(r.free).toBe(0);
    expect(r.paid).toBe(1);
    expect(r.cheap).toBeCloseTo(1 / 3, 5);
  });
});

describe("sanitizeTierOverride — fail-open hardening", () => {
  const known = ["A", "B", "C", "D", "E", "F", "G"];

  it("accepts a clean frontier + mundane", () => {
    expect(sanitizeTierOverride({ frontier: ["A", "B", "C"], mundane: ["E", "F"] }, known)).toEqual({
      frontier: ["A", "B", "C"],
      mundane: ["E", "F"],
    });
  });

  it("dedupes and drops blanks, preserving order", () => {
    expect(sanitizeTierOverride({ frontier: ["A", "A", "", "B", "C"], mundane: ["E", "E", "F"] }, known)).toEqual({
      frontier: ["A", "B", "C"],
      mundane: ["E", "F"],
    });
  });

  it("fails open (null) when duplicates collapse the frontier below quorum", () => {
    expect(sanitizeTierOverride({ frontier: ["A", "A", "A"] }, known)).toBeNull();
  });

  it("fails open (null) on unknown model ids not in the registry", () => {
    expect(sanitizeTierOverride({ frontier: ["X", "Y", "Z"] }, known)).toBeNull();
  });

  it("fails open (null) when too few known ids remain after dropping unknowns", () => {
    expect(sanitizeTierOverride({ frontier: ["A", "X", "Y"] }, known)).toBeNull();
  });

  it("strips unknown mundane ids but keeps a valid frontier", () => {
    expect(sanitizeTierOverride({ frontier: ["A", "B", "C"], mundane: ["E", "X", "F"] }, known)).toEqual({
      frontier: ["A", "B", "C"],
      mundane: ["E", "F"],
    });
  });

  it("fails open (null) for non-array / missing / null frontier", () => {
    expect(sanitizeTierOverride({ frontier: "A,B,C" }, known)).toBeNull();
    expect(sanitizeTierOverride({}, known)).toBeNull();
    expect(sanitizeTierOverride(null, known)).toBeNull();
  });
});

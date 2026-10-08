import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifySmoke,
  buildSmokeRecord,
  partitionStages,
  stageOfTool,
  computeProgress,
  summarizeParams,
  type ToolSmokeRecord,
} from "../../server/lib/tool-smoke-core";

describe("tool-smoke-core: classifySmoke", () => {
  it("classifies a pure, non-network, fast, ungated safe tool as live-safe", () => {
    const c = classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: false });
    assert.equal(c.smokeClass, "live-safe");
    assert.deepEqual(c.reasons, []);
  });

  it("a 'normal' speed safe tool is still live-safe", () => {
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "normal", isNetworkTool: false }).smokeClass, "live-safe");
  });

  it("explicitPolicy is documentation only — its absence does NOT force doc-only", () => {
    // A safe tool that merely DEFAULTS safe (no explicit TOOL_POLICY entry) is
    // still live-safe; the structural fail-closed lives in `risk` (name-inferred
    // by the caller via getEffectiveToolRisk), not in policy presence.
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: false, explicitPolicy: false }).smokeClass, "live-safe");
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: false, explicitPolicy: true }).smokeClass, "live-safe");
  });

  it("a destructive risk (e.g. name-inferred for an unregistered dangerous tool) → doc-only", () => {
    // The driver passes getEffectiveToolRisk(name); a suspicious unregistered name
    // resolves risk=destructive, which this classifier then forces to doc-only.
    const c = classifySmoke({ name: "delete_everything", risk: "destructive", speed: "fast", isNetworkTool: false, explicitPolicy: false });
    assert.equal(c.smokeClass, "doc-only");
    assert.match(c.reasons.join(), /risk=destructive/);
  });

  it("destructive risk forces doc-only", () => {
    const c = classifySmoke({ name: "x", risk: "destructive", speed: "fast", isNetworkTool: false });
    assert.equal(c.smokeClass, "doc-only");
    assert.match(c.reasons.join(), /risk=destructive/);
  });

  it("sensitive risk forces doc-only", () => {
    assert.equal(classifySmoke({ name: "x", risk: "sensitive", speed: "fast" }).smokeClass, "doc-only");
  });

  it("a network tool is doc-only even when risk=safe", () => {
    const c = classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: true });
    assert.equal(c.smokeClass, "doc-only");
    assert.match(c.reasons.join(), /network/);
  });

  it("slow / very_slow tools are doc-only (likely LLM/expensive)", () => {
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "slow" }).smokeClass, "doc-only");
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "very_slow" }).smokeClass, "doc-only");
  });

  it("missing registry meta (no speed) is doc-only (fail-safe)", () => {
    const c = classifySmoke({ name: "x", risk: "safe" });
    assert.equal(c.smokeClass, "doc-only");
    assert.match(c.reasons.join(), /no registry meta/);
  });

  it("each gate independently forces doc-only", () => {
    for (const gate of [
      { requiresApproval: true },
      { trustedPersonasOnly: true },
      { hasValueCap: true },
      { irreversible: true },
    ]) {
      const c = classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: false, ...gate });
      assert.equal(c.smokeClass, "doc-only", `gate ${JSON.stringify(gate)} should be doc-only`);
    }
  });

  it("an unknown risk string fails safe to doc-only", () => {
    const c = classifySmoke({ name: "x", risk: "weird", speed: "fast" });
    assert.equal(c.smokeClass, "doc-only");
    assert.match(c.reasons.join(), /unknown/);
  });

  it("requiresStructuredArgs alone does NOT force doc-only", () => {
    assert.equal(classifySmoke({ name: "x", risk: "safe", speed: "fast", isNetworkTool: false, requiresStructuredArgs: true, explicitPolicy: true }).smokeClass, "live-safe");
  });
});

describe("tool-smoke-core: buildSmokeRecord", () => {
  it("merges classification onto the input", () => {
    const r = buildSmokeRecord({ name: "x", risk: "destructive", speed: "fast" });
    assert.equal(r.name, "x");
    assert.equal(r.smokeClass, "doc-only");
    assert.ok(r.reasons.length >= 1);
  });
});

describe("tool-smoke-core: partitionStages", () => {
  it("sorts then chunks deterministically", () => {
    const s = partitionStages(["c", "a", "b", "d", "e"], 2);
    assert.deepEqual(s, [["a", "b"], ["c", "d"], ["e"]]);
  });

  it("dedups names", () => {
    assert.deepEqual(partitionStages(["a", "a", "b"], 2), [["a", "b"]]);
  });

  it("is stable across calls (same tool ⇒ same stage)", () => {
    const names = ["t10", "t2", "t1", "t3"];
    assert.deepEqual(partitionStages(names, 2), partitionStages([...names].reverse(), 2));
  });

  it("throws fail-closed on a bad stage size", () => {
    assert.throws(() => partitionStages(["a"], 0), /positive integer/);
    assert.throws(() => partitionStages(["a"], -1), /positive integer/);
    assert.throws(() => partitionStages(["a"], 1.5), /positive integer/);
  });

  it("handles an empty list", () => {
    assert.deepEqual(partitionStages([], 5), []);
  });
});

describe("tool-smoke-core: stageOfTool", () => {
  const stages = partitionStages(["a", "b", "c", "d", "e"], 2);
  it("returns the 1-based stage number", () => {
    assert.equal(stageOfTool(stages, "a"), 1);
    assert.equal(stageOfTool(stages, "c"), 2);
    assert.equal(stageOfTool(stages, "e"), 3);
  });
  it("returns 0 for an unknown tool", () => {
    assert.equal(stageOfTool(stages, "zzz"), 0);
  });
});

describe("tool-smoke-core: computeProgress", () => {
  const recs: ToolSmokeRecord[] = [
    { name: "a", smokeClass: "live-safe", reasons: [] },
    { name: "b", smokeClass: "doc-only", reasons: ["network tool"] },
    { name: "c", smokeClass: "live-safe", reasons: [] },
    { name: "d", smokeClass: "doc-only", reasons: ["risk=destructive"] },
    { name: "e", smokeClass: "live-safe", reasons: [] },
  ];
  const stages = partitionStages(recs.map((r) => r.name), 2); // [[a,b],[c,d],[e]]

  it("reports zero progress with no completed tools", () => {
    const p = computeProgress(recs, stages, 2, []);
    assert.equal(p.totalTools, 5);
    assert.equal(p.totalStages, 3);
    assert.equal(p.completedStageCount, 0);
    assert.equal(p.toolsVerified, 0);
    assert.equal(p.toolsPending, 5);
    assert.equal(p.nextStage, 1);
    assert.equal(p.percentComplete, 0);
    assert.equal(p.liveSafeCount, 3);
    assert.equal(p.docOnlyCount, 2);
  });

  it("counts a stage complete only when ALL its tools are signed off, and finds the next gap", () => {
    const p = computeProgress(recs, stages, 2, ["a", "b"]); // all of stage 1
    assert.deepEqual(p.completedStages, [1]);
    assert.equal(p.toolsVerified, 2);
    assert.equal(p.toolsPending, 3);
    assert.equal(p.nextStage, 2);
    assert.equal(p.percentComplete, 33);
  });

  it("a PARTIALLY signed-off stage is NOT complete (durability across churn)", () => {
    const p = computeProgress(recs, stages, 2, ["a"]); // only half of stage 1
    assert.deepEqual(p.completedStages, []);
    assert.equal(p.completedStageCount, 0);
    assert.equal(p.toolsVerified, 1);
    assert.equal(p.nextStage, 1); // stage 1 resurfaces until fully done
  });

  it("picks the FIRST incomplete stage as next (gap, not max+1)", () => {
    const p = computeProgress(recs, stages, 2, ["a", "b", "e"]); // stages 1 and 3
    assert.deepEqual(p.completedStages, [1, 3]);
    assert.equal(p.nextStage, 2);
    assert.equal(p.toolsVerified, 3); // stage1(2) + stage3(1)
  });

  it("reports nextStage 0 when all tools complete", () => {
    const p = computeProgress(recs, stages, 2, ["a", "b", "c", "d", "e"]);
    assert.equal(p.nextStage, 0);
    assert.equal(p.percentComplete, 100);
    assert.equal(p.toolsPending, 0);
  });

  it("ignores unknown / dup / malformed names so a stale progress file can't over-count", () => {
    const p = computeProgress(recs, stages, 2, ["a", "a", "b", "c", "d", "zzz", "", null as any]);
    assert.deepEqual(p.completedStages, [1, 2]); // stage1(a,b) + stage2(c,d); "zzz"/""/null dropped
    assert.equal(p.completedStageCount, 2);
    assert.equal(p.toolsVerified, 4);
  });
});

describe("tool-smoke-core: summarizeParams", () => {
  it("summarizes properties with required flags and types", () => {
    const out = summarizeParams({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" }, c: { enum: ["x", "y"] } },
      required: ["a"],
    });
    assert.deepEqual(out, [
      { name: "a", type: "string", required: true },
      { name: "b", type: "number", required: false },
      { name: "c", type: "enum", required: false },
    ]);
  });

  it("returns [] for a missing or malformed schema", () => {
    assert.deepEqual(summarizeParams(undefined), []);
    assert.deepEqual(summarizeParams({}), []);
    assert.deepEqual(summarizeParams({ properties: null }), []);
  });

  it("joins union types", () => {
    const out = summarizeParams({ properties: { a: { type: ["string", "null"] } } });
    assert.equal(out[0].type, "string|null");
  });
});

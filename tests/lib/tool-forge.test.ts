import { test } from "node:test";
import assert from "node:assert/strict";
import { selectForgeGaps, type ForgeGap } from "../../server/lib/tool-forge";

const gap = (over: Partial<ForgeGap>): ForgeGap => ({
  id: 1,
  tenantId: 1,
  gapDescription: "a real gap",
  status: "detected",
  missCount: 5,
  priority: "medium",
  ...over,
});

test("selects by missCount desc, respects threshold and cap", () => {
  const gaps = [
    gap({ id: 1, missCount: 2 }),
    gap({ id: 2, missCount: 7 }),
    gap({ id: 3, missCount: 5 }),
  ];
  const out = selectForgeGaps({ gaps, missThreshold: 3, alreadyProposedGapIds: new Set(), maxPerRun: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 2);
});

test("already-proposed gaps are never re-selected", () => {
  const gaps = [gap({ id: 10, missCount: 9 }), gap({ id: 11, missCount: 4 })];
  const out = selectForgeGaps({ gaps, missThreshold: 3, alreadyProposedGapIds: new Set([10]), maxPerRun: 5 });
  assert.deepEqual(out.map((g) => g.id), [11]);
});

test("resolved / not_feasible / safety_blocked statuses are ineligible", () => {
  const gaps = [
    gap({ id: 1, status: "resolved" }),
    gap({ id: 2, status: "not_feasible" }),
    gap({ id: 3, status: "safety_blocked" }),
    gap({ id: 4, status: "researched" }),
  ];
  const out = selectForgeGaps({ gaps, missThreshold: 1, alreadyProposedGapIds: new Set(), maxPerRun: 10 });
  assert.deepEqual(out.map((g) => g.id), [4]);
});

test("empty description is ineligible; priority breaks missCount ties; oldest id last tiebreak", () => {
  const gaps = [
    gap({ id: 1, gapDescription: "   " }),
    gap({ id: 2, missCount: 5, priority: "high" }),
    gap({ id: 3, missCount: 5, priority: "low" }),
    gap({ id: 4, missCount: 5, priority: "high" }),
  ];
  const out = selectForgeGaps({ gaps, missThreshold: 3, alreadyProposedGapIds: new Set(), maxPerRun: 10 });
  assert.deepEqual(out.map((g) => g.id), [2, 4, 3]);
});

test("test-artifact gap descriptions are filtered as junk", () => {
  const gaps = [
    gap({ id: 1, gapDescription: "Need tool: __nonexistent_tool_for_dispatch_test__ — {}" }),
    gap({ id: 2, gapDescription: "Bulk export invoices to accounting CSV" }),
  ];
  const out = selectForgeGaps({ gaps, missThreshold: 1, alreadyProposedGapIds: new Set(), maxPerRun: 10 });
  assert.deepEqual(out.map((g) => g.id), [2]);
});

test("maxPerRun 0 returns empty", () => {
  const out = selectForgeGaps({ gaps: [gap({})], missThreshold: 1, alreadyProposedGapIds: new Set(), maxPerRun: 0 });
  assert.equal(out.length, 0);
});

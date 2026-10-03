import test from "node:test";
import assert from "node:assert/strict";
import {
  rankEligibleIdeas,
  addBusinessOpportunity,
  moveToIncomeProduct,
} from "../../server/lib/ideabrowser-opportunity-lifecycle";

test("ranks eligible IdeaBrowser ideas by composite then id and caps at five", () => {
  const ranked = rankEligibleIdeas([
    { id: 2, tags: ["ideabrowser", "idea-stage"], metadata: { priority: { composite: 80 } } },
    { id: 9, tags: ["isenberg", "idea-stage"], metadata: { priority: { composite: 80 } } },
    { id: 10, tags: ["ideabrowser", "idea-stage", "ideabrowser-weekly-run"], metadata: { priority: { composite: 100 } } },
    { id: 11, tags: ["ideabrowser", "idea-stage", "income-product"], metadata: { priority: { composite: 99 } } },
    { id: 12, tags: ["ideabrowser", "idea-stage", "business-opportunity"], metadata: { priority: { composite: 98 } } },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: 20 + i,
      tags: ["ideabrowser", "idea-stage"],
      metadata: { priority: { composite: 70 - i } },
    })),
  ]);

  assert.deepEqual(ranked.map((project) => project.id), [12, 9, 2, 20, 21]);
});

test("promotion is additive and idempotent-oriented", () => {
  const promoted = addBusinessOpportunity({
    id: 42,
    tags: ["ideabrowser", "isenberg", "idea-stage"],
    metadata: { priority: { composite: 91 }, source: "keep-me" },
  }, "2026-02-01T00:00:00.000Z");
  assert.deepEqual(promoted.tags, ["ideabrowser", "isenberg", "idea-stage", "business-opportunity"]);
  assert.equal(promoted.metadata.source, "keep-me");
  assert.equal(promoted.metadata.ideabrowserOpportunity.promotedAt, "2026-02-01T00:00:00.000Z");
  assert.deepEqual(addBusinessOpportunity(promoted).tags, promoted.tags);
});

test("income transition swaps lifecycle tags while retaining provenance", () => {
  const moved = moveToIncomeProduct({
    id: 42,
    tags: ["ideabrowser", "idea-stage", "business-opportunity"],
    metadata: { ideabrowserOpportunity: { promotedAt: "2026-02-01T00:00:00.000Z" } },
  }, "2026-02-02T00:00:00.000Z");
  assert.equal(moved.tags.includes("business-opportunity"), false);
  assert.equal(moved.tags.includes("income-product"), true);
  assert.equal(moved.tags.includes("ideabrowser"), true);
  assert.equal(moved.metadata.ideabrowserOpportunity.promotedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(moved.metadata.ideabrowserOpportunity.incomeProductAt, "2026-02-02T00:00:00.000Z");
});
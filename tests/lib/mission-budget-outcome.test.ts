// Query-free tests for the pure decision logic in:
//  - server/lib/mission-budget-guard.ts (hard capital cap, Grok item #3)
//  - server/lib/mission-validation.ts proof-of-premise gate (Grok item #1)
//  - server/lib/outcome-promotion.ts promotion thresholds (Grok item #2)
// (No DB calls — only the pure exports are exercised.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missionSpendCapUsdCents,
  decideBudgetBreach,
  BUDGET_MARKER,
} from "../../server/lib/mission-budget-guard";
import { decideDemandProof, DEMAND_EVIDENCE_TYPES } from "../../server/lib/mission-validation";
import {
  decidePromotion,
  buildEvalCases,
  buildSeedSkill,
  PROMOTION_MIN_EVENTS,
  PROMOTION_MIN_FAIL_RATE,
} from "../../server/lib/outcome-promotion";
import { SUNSET_MARKER } from "../../server/lib/mission-sunset";
import { MISSION_EVIDENCE_TYPES } from "../../shared/models/revenue-missions";
import { HARD_CAPS } from "../../server/lib/revenue-missions";

// ── Budget guard ─────────────────────────────────────────────────────────────

test("missionSpendCapUsdCents clamps mission budget by contract hard ceiling", () => {
  assert.equal(missionSpendCapUsdCents({ max_cash_at_risk_usd: 10 }), 1000);
  assert.equal(missionSpendCapUsdCents({ max_cash_at_risk_usd: 999 }), HARD_CAPS.maxSpendUsdCents);
});

test("missionSpendCapUsdCents fails closed (0 headroom) on unreadable budget", () => {
  assert.equal(missionSpendCapUsdCents({ max_cash_at_risk_usd: null }), 0);
  assert.equal(missionSpendCapUsdCents({ max_cash_at_risk_usd: "garbage" }), 0);
  assert.equal(missionSpendCapUsdCents({ max_cash_at_risk_usd: -5 }), 0);
  assert.equal(missionSpendCapUsdCents({} as any), 0);
});

test("decideBudgetBreach: at/over cap breaches; under cap does not", () => {
  assert.equal(decideBudgetBreach(2500, 2500).breached, true);
  assert.equal(decideBudgetBreach(2501, 2500).breached, true);
  assert.equal(decideBudgetBreach(2499, 2500).breached, false);
  assert.equal(decideBudgetBreach(0, 2500).breached, false);
});

test("decideBudgetBreach fails safe on unreadable spend", () => {
  assert.equal(decideBudgetBreach(null, 2500).breached, true);
  assert.equal(decideBudgetBreach("nope", 2500).breached, true);
  assert.equal(decideBudgetBreach(undefined, 2500).breached, true);
});

test("budget marker shares the sunset prefix so sweeps stay idempotent", () => {
  assert.ok(BUDGET_MARKER.startsWith(SUNSET_MARKER));
});

test("'spend' is a recordable evidence type (rollup increment path exists)", () => {
  assert.ok((MISSION_EVIDENCE_TYPES as readonly string[]).includes("spend"));
});

// ── Proof-of-premise gate ────────────────────────────────────────────────────

test("first experiment is always allowed (packet validation gate applies instead)", () => {
  assert.equal(decideDemandProof(0, 0).allowed, true);
});

test("second experiment refused when zero demand signals after a sent experiment", () => {
  const d = decideDemandProof(1, 0);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /proof-of-premise/);
});

test("second experiment allowed once any demand signal exists", () => {
  assert.equal(decideDemandProof(1, 1).allowed, true);
  assert.equal(decideDemandProof(3, 2).allowed, true);
});

test("demand proof fails closed on unreadable counts", () => {
  assert.equal(decideDemandProof(null, 1).allowed, false);
  assert.equal(decideDemandProof(1, "x").allowed, false);
  assert.equal(decideDemandProof(-1, 0).allowed, false);
});

test("demand evidence types are all valid mission evidence types", () => {
  for (const t of DEMAND_EVIDENCE_TYPES) {
    assert.ok((MISSION_EVIDENCE_TYPES as readonly string[]).includes(t), t);
  }
});

// ── Outcome promotion ────────────────────────────────────────────────────────

test("decidePromotion promotes only past both thresholds", () => {
  assert.equal(decidePromotion({ total: PROMOTION_MIN_EVENTS, failed: Math.ceil(PROMOTION_MIN_EVENTS * PROMOTION_MIN_FAIL_RATE) }).promote, true);
  assert.equal(decidePromotion({ total: PROMOTION_MIN_EVENTS - 1, failed: PROMOTION_MIN_EVENTS - 1 }).promote, false);
  assert.equal(decidePromotion({ total: 20, failed: 2 }).promote, false);
});

test("decidePromotion fails open (no promotion) on unreadable stats", () => {
  assert.equal(decidePromotion({ total: NaN, failed: 1 } as any).promote, false);
  assert.equal(decidePromotion({ total: 10, failed: 11 }).promote, false);
  assert.equal(decidePromotion({ total: 0, failed: 0 }).promote, false);
  assert.equal(decidePromotion({ total: 10, failed: -1 }).promote, false);
});

test("buildEvalCases dedupes, caps at 8, and skips empty rows", () => {
  const failures = [
    { critique: "too long", request_excerpt: "write a pdf" },
    { critique: "too long", request_excerpt: "write a pdf" }, // dup
    { critique: null, request_excerpt: null },                // empty
    ...Array.from({ length: 12 }, (_, i) => ({ critique: `fail ${i}`, request_excerpt: `req ${i}` })),
  ];
  const cases = buildEvalCases(failures, "pdf");
  assert.equal(cases.length, 8);
  assert.ok(cases[0].input.includes("write a pdf"));
  assert.match(cases[0].rubric, /too long/);
});

test("buildEvalCases synthesizes an input when only a critique exists", () => {
  const cases = buildEvalCases([{ critique: "missing CTA", request_excerpt: null }], "slides");
  assert.equal(cases.length, 1);
  assert.match(cases[0].input, /slides/);
});

test("buildSeedSkill produces a runnable seed doc with dedup'd failure modes", () => {
  const doc = buildSeedSkill("pdf", [
    { rubric: "Must NOT repeat: too long" },
    { rubric: "Must NOT repeat: too long" }, // dup
    { rubric: "Must NOT repeat: missing CTA" },
    { rubric: "" },                          // empty skipped
  ]);
  assert.match(doc, /pdf production skill/);
  assert.match(doc, /missing CTA/);
  assert.equal(doc.split("too long").length, 2); // appears exactly once
});

test("buildSeedSkill handles empty/garbage format and no cases", () => {
  const doc = buildSeedSkill("", []);
  assert.match(doc, /deliverable production skill/);
  assert.ok(doc.length > 50);
});

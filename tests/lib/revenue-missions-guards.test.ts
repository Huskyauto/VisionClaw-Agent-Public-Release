/**
 * Verified Revenue Missions — query-free guard tests (S1).
 * Feature contract: data/feature-contracts/revenue-missions.
 * Query-free by design: every write helper calls assertTenant BEFORE any
 * db.execute, so invalid tenants throw with zero pg pool activity
 * (see node-test-db-pool-hang memory).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACTIVE_EXPERIMENT_STATUSES, canTransition, createMission, addEvidence, approveExperiment, listMissions, clampCap, HARD_CAPS, missionIdFromStripeMetadata, refundEvidenceItems, STRIPE_EVIDENCE_STAGES } from "../../server/lib/revenue-missions";

// ── Tenant fail-closed guards ───────────────────────────────────────────────
const badTenants = [0, -1, 1.5, NaN, undefined as any, null as any, "1" as any];

for (const bad of badTenants) {
  test(`createMission rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(
      () => createMission({ tenantId: bad, name: "x", hypothesis: "y", idealCustomer: "z", offer: "o" }),
      /invalid tenantId/,
    );
  });
}

test("addEvidence rejects invalid tenantId before any query", async () => {
  await assert.rejects(
    () => addEvidence({ tenantId: 0, missionId: 1, type: "payment", summary: "s", source: "stripe" }),
    /invalid tenantId/,
  );
});

test("approveExperiment rejects invalid tenantId before any query", async () => {
  await assert.rejects(() => approveExperiment(-5, 1, "owner"), /invalid tenantId/);
});

test("listMissions rejects invalid tenantId before any query", async () => {
  await assert.rejects(() => listMissions(NaN), /invalid tenantId/);
});

// ── Stage machine ───────────────────────────────────────────────────────────
test("legal ladder transitions allowed", () => {
  assert.equal(canTransition("hypothesis", "evidence_gathering"), true);
  assert.equal(canTransition("hypothesis", "offer_defined"), true);
  assert.equal(canTransition("offer_defined", "experiment_draft"), true);
  assert.equal(canTransition("experiment_draft", "experiment_awaiting_approval"), true);
  assert.equal(canTransition("experiment_awaiting_approval", "experiment_live"), true);
  assert.equal(canTransition("experiment_live", "evaluating"), true);
  assert.equal(canTransition("evaluating", "presell"), true);
  assert.equal(canTransition("presell", "scale_ready"), true);
});

test("stage skipping is illegal", () => {
  assert.equal(canTransition("hypothesis", "experiment_live"), false);
  assert.equal(canTransition("offer_defined", "experiment_live"), false);
  assert.equal(canTransition("experiment_draft", "experiment_live"), false, "cannot go live without awaiting_approval");
  assert.equal(canTransition("hypothesis", "scale_ready"), false);
});

test("kill allowed from any live stage, never from killed", () => {
  for (const from of ["hypothesis", "experiment_live", "presell", "scale_ready"]) {
    assert.equal(canTransition(from, "killed"), true, `kill from ${from}`);
  }
  assert.equal(canTransition("killed", "killed"), false);
  assert.equal(canTransition("killed", "hypothesis"), false, "killed is terminal");
});

test("awaiting_approval can fall back to draft (owner edits)", () => {
  assert.equal(canTransition("experiment_awaiting_approval", "experiment_draft"), true);
});

// ── Contract hard caps (25 prospects / 3 contacts / $25) ────────────────────
test("HARD_CAPS match the feature contract", () => {
  assert.equal(HARD_CAPS.maxProspects, 25);
  assert.equal(HARD_CAPS.maxContactsPerProspect, 3);
  assert.equal(HARD_CAPS.maxSpendUsdCents, 2500);
  assert.equal(HARD_CAPS.maxConcurrentExperiments, 3);
});

test("clampCap: mission values may tighten but never exceed the ceiling", () => {
  assert.equal(clampCap(10, 25), 10, "tighter value honored");
  assert.equal(clampCap(25, 25), 25);
  assert.equal(clampCap(100, 25), 25, "elevated DB value clamped to ceiling");
  assert.equal(clampCap(9999, 2500), 2500);
});

test("clampCap: junk/zero/negative values fall to the hard ceiling (never unbounded)", () => {
  for (const junk of [0, -1, NaN, Infinity, undefined, null, "lots" as any]) {
    assert.equal(clampCap(junk, 25), 25, `junk ${String(junk)}`);
  }
  assert.equal(clampCap(3.9, 25), 3, "fractional floors down");
});

// ── Evidence provenance (externalRef) fail-closed ───────────────────────────
test("addEvidence rejects non-manual evidence without externalRef (before any query)", async () => {
  for (const source of ["gmail", "stripe", "web", "crm"]) {
    await assert.rejects(
      () => addEvidence({ tenantId: 1, missionId: 1, type: "positive_reply", summary: "sss", source }),
      /requires externalRef/,
      `source ${source}`,
    );
  }
});

test("addEvidence rejects empty-string externalRef for non-manual sources", async () => {
  await assert.rejects(
    () => addEvidence({ tenantId: 1, missionId: 1, type: "payment", summary: "sss", source: "stripe", externalRef: "" }),
    /requires externalRef/,
  );
});

// ── S3: HITL send gate + sequence step builder (query-free, pure) ───────────
import {
  assertSendAllowed,
  isStaleLaunchClaim,
  buildSequenceSteps,
  classifyReplyText,
  runApprovedExperiment,
  pauseMissionEnrollments,
  OPT_OUT_LINE,
} from "../../server/lib/mission-experiment-run";

test("assertSendAllowed: unapproved experiment is unreachable (fail closed)", () => {
  assert.throws(() => assertSendAllowed(null), /fail closed/);
  assert.throws(
    () => assertSendAllowed({ status: "awaiting_approval", approved_by_owner_at: null }),
    /not owner-approved/,
  );
  assert.throws(
    () => assertSendAllowed({ status: "approved", approved_by_owner_at: undefined }),
    /not owner-approved/,
    "status alone is NOT enough — the timestamp is the gate",
  );
});

test("assertSendAllowed: only status 'approved' with timestamp passes", () => {
  assert.doesNotThrow(() => assertSendAllowed({ status: "approved", approved_by_owner_at: "2026-07-22" }));
  for (const status of ["draft", "awaiting_approval", "live", "completed", "cancelled"]) {
    assert.throws(
      () => assertSendAllowed({ status, approved_by_owner_at: "2026-07-22" }),
      /only 'approved'/,
      `status ${status}`,
    );
  }
});

test("buildSequenceSteps caps steps at maxContactsPerProspect (hard ceiling 3)", () => {
  const variants = [1, 2, 3, 4, 5].map((i) => ({ label: `v${i}`, subject: `s${i}`, body: `b${i}` }));
  assert.equal(buildSequenceSteps(variants, 2, "tok").length, 2, "mission tightening honored");
  assert.equal(buildSequenceSteps(variants, 99, "tok").length, 3, "clamped to contract ceiling");
  assert.equal(buildSequenceSteps(variants, NaN as any, "tok").length, 3, "junk cap falls to ceiling");
});

test("buildSequenceSteps: every step carries the opt-out line + reply token; empty variants refuse", () => {
  const steps = buildSequenceSteps([{ label: "a", subject: "Sub", body: "Body" }], 3, "vcm-1-abc");
  assert.ok(steps[0].bodyTemplate.includes(OPT_OUT_LINE), "mandatory opt-out line");
  assert.ok(steps[0].bodyTemplate.includes("vcm-1-abc"), "reply token in body");
  assert.ok(steps[0].subject.includes("vcm-1-abc"), "reply token in subject");
  assert.throws(() => buildSequenceSteps([], 3, "tok"), /no message variants/);
});

test("classifyReplyText: opt-out phrasings are negative, everything else positive", () => {
  for (const t of ["No thanks!", "please UNSUBSCRIBE me", "not interested, sorry", "remove me from your list", "stop emailing me"]) {
    assert.equal(classifyReplyText(t), "negative_reply", t);
  }
  for (const t of ["Sounds interesting, tell me more", "How much does it cost?", ""]) {
    assert.equal(classifyReplyText(t), "positive_reply", t);
  }
});

test("runApprovedExperiment / pauseMissionEnrollments reject invalid tenantId before any query", async () => {
  await assert.rejects(() => runApprovedExperiment({ tenantId: 0, experimentId: 1 }), /invalid tenantId/);
  await assert.rejects(() => pauseMissionEnrollments(-3, 1), /invalid tenantId/);
});

// ── S4: Stripe metadata mission-id parsing (fail closed on any junk) ────────
test("missionIdFromStripeMetadata accepts clean positive integers only", () => {
  assert.equal(missionIdFromStripeMetadata({ mission_id: "7" }), 7);
  assert.equal(missionIdFromStripeMetadata({ mission_id: 12 }), 12);
  assert.equal(missionIdFromStripeMetadata({ missionId: " 3 " }), 3, "camelCase + trim accepted");
});

test("missionIdFromStripeMetadata fails closed on junk", () => {
  for (const bad of [
    null, undefined, "x", 42, [],
    {}, { mission_id: "" }, { mission_id: "0" }, { mission_id: "-4" },
    { mission_id: "1.5" }, { mission_id: "7; DROP TABLE" }, { mission_id: "1e3" },
    { mission_id: NaN }, { mission_id: {} }, { mission_id: "999999999999999999999" },
  ]) {
    assert.equal(missionIdFromStripeMetadata(bad as any), null, JSON.stringify(bad));
  }
});

// ── S4: per-refund identity (architect finding — never dedupe on charge id) ─
test("refundEvidenceItems extracts one item per succeeded refund (re_... identity)", () => {
  const charge = {
    id: "ch_1",
    refunds: { data: [
      { id: "re_a", amount: 500, status: "succeeded" },
      { id: "re_b", amount: 300, status: "succeeded" },
      { id: "re_pending", amount: 200, status: "pending" },
      { id: "", amount: 100, status: "succeeded" },
      { amount: 100, status: "succeeded" },
      { id: "re_junk", amount: "nope", status: "succeeded" },
      { id: "re_neg", amount: -50, status: "succeeded" },
    ]},
  };
  const items = refundEvidenceItems(charge);
  assert.deepEqual(items, [
    { externalRef: "re_a", amountUsdCents: 500 },
    { externalRef: "re_b", amountUsdCents: 300 },
    { externalRef: "re_junk", amountUsdCents: 0 },
    { externalRef: "re_neg", amountUsdCents: 0 },
  ]);
});

test("refundEvidenceItems fails closed (empty) when refunds list is absent/junk", () => {
  for (const bad of [null, undefined, {}, { refunds: null }, { refunds: {} }, { refunds: { data: "x" } }, "ch_1", 42]) {
    assert.deepEqual(refundEvidenceItems(bad as any), [], JSON.stringify(bad));
  }
});

test("STRIPE_EVIDENCE_STAGES only contains post-approval stages", () => {
  assert.deepEqual([...STRIPE_EVIDENCE_STAGES], ["experiment_live", "evaluating", "presell", "scale_ready"]);
  for (const pre of ["hypothesis", "experiment_draft", "experiment_awaiting_approval", "killed"]) {
    assert.ok(!(STRIPE_EVIDENCE_STAGES as readonly string[]).includes(pre), pre);
  }
});

// ── S5a persona-tool wiring guards (query-free: the owner gate rejects before
// any dynamic lib import, so no pg pool activity) ───────────────────────────
import { revenueMissionsDomainTools } from "../../server/tools/domains/revenue-missions";

const toolByName = new Map(revenueMissionsDomainTools.map(t => [t.definition.function.name, t]));
const MISSION_TOOLS = [
  "revenue_mission_create",
  "revenue_mission_list",
  "revenue_mission_status",
  "revenue_mission_draft_experiment",
  "mission_portfolio_review",
];

test("all 5 mission tools registered in the domain", () => {
  for (const name of MISSION_TOOLS) assert.ok(toolByName.has(name), name);
});

test("approve/kill are NOT tools (HITL-only invariant)", () => {
  for (const name of toolByName.keys()) {
    assert.ok(!/approve|kill|launch/.test(name), `forbidden tool surface: ${name}`);
  }
});

for (const name of MISSION_TOOLS) {
  test(`${name} rejects missing tenant context`, async () => {
    const res = await toolByName.get(name)!.handler({ missionId: 1, name: "x", hypothesis: "h", idealCustomer: "i", offer: "o" }, {} as any);
    assert.match(String((res as any).error), /Tenant context required/);
  });
  test(`${name} rejects non-owner tenant`, async () => {
    const res = await toolByName.get(name)!.handler({ missionId: 1, name: "x", hypothesis: "h", idealCustomer: "i", offer: "o" }, { tenantId: 2 } as any);
    assert.match(String((res as any).error), /owner-only/);
  });
}

test("revenue_mission_status rejects bad missionId before any query", async () => {
  const res = await toolByName.get("revenue_mission_status")!.handler({ missionId: 0 }, { tenantId: 1 } as any);
  assert.match(String((res as any).error), /positive integer missionId/);
});

test("revenue_mission_draft_experiment rejects bad missionId before any query", async () => {
  const res = await toolByName.get("revenue_mission_draft_experiment")!.handler({ missionId: -3 }, { tenantId: 1 } as any);
  assert.match(String((res as any).error), /positive integer missionId/);
});

test("revenue_mission_create rejects empty required fields before any query", async () => {
  const res = await toolByName.get("revenue_mission_create")!.handler({ name: " ", hypothesis: "", idealCustomer: "x", offer: "y" }, { tenantId: 1 } as any);
  assert.match(String((res as any).error), /non-empty/);
});

// Architect nit (S5a review): pin fail-closed behavior on MALFORMED ctx tenant
// values — strict !== 1 means a string "1" or object never passes the gate.
for (const bad of ["1", { id: 1 }, true, 1.5] as any[]) {
  test(`owner gate fails closed on malformed ctx.tenantId ${JSON.stringify(bad)}`, async () => {
    const res = await toolByName.get("revenue_mission_list")!.handler({}, { tenantId: bad } as any);
    assert.ok(/owner-only|Tenant context required/.test(String((res as any).error)), `expected fail-closed, got ${JSON.stringify(res)}`);
  });
}

// ── S5c autonomy ladder (pure fns, no DB) ────────────────────────────────────
import { parseAutonomyLevel, autonomyAllows, computeReinvestment, ACTION_MIN_LEVEL, REINVEST_RULES, AUTONOMY_MAX } from "../../server/lib/mission-autonomy";

test("parseAutonomyLevel accepts only integers 0-6; junk fails closed", () => {
  assert.equal(parseAutonomyLevel(0), 0);
  assert.equal(parseAutonomyLevel(6), 6);
  assert.equal(parseAutonomyLevel("3"), 3);
  for (const bad of [-1, 7, 1.5, "1.5", "x", "", null, undefined, {}, [], true, NaN]) {
    assert.equal(parseAutonomyLevel(bad as any), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("autonomyAllows fails closed: killed stage, malformed level, missing mission", () => {
  assert.equal(autonomyAllows(null, "propose"), false);
  assert.equal(autonomyAllows({ autonomy_level: 6, stage: "killed" }, "propose"), false);
  for (const badLvl of ["3", 1.5, -1, 7, null, undefined]) {
    assert.equal(autonomyAllows({ autonomy_level: badLvl, stage: "live" } as any, "propose"), false, `lvl ${JSON.stringify(badLvl)}`);
  }
});

test("autonomyAllows enforces the ladder minimums; level 6 has no scale action", () => {
  for (const [action, min] of Object.entries(ACTION_MIN_LEVEL)) {
    assert.equal(autonomyAllows({ autonomy_level: min, stage: "validation" }, action as any), true, `${action} at ${min}`);
    if (min > 0) assert.equal(autonomyAllows({ autonomy_level: min - 1, stage: "validation" }, action as any), false, `${action} below ${min}`);
  }
  assert.ok(!("scale_spend" in ACTION_MIN_LEVEL) && !("launch_new_product" in ACTION_MIN_LEVEL), "level-6 scale actions must never be autonomous");
  assert.equal(AUTONOMY_MAX, 6);
});

test("computeReinvestment: only verified realized profit, 10% fraction, $250 ceiling", () => {
  // margin = 20000 - 2000 - 3000 = 15000c ⇒ 10% = $15 reinvest
  const r = computeReinvestment({ revenue_usd_cents: 20000, refunds_usd_cents: 2000, spend_usd_cents: 3000, max_cash_at_risk_usd: 25 });
  assert.deepEqual(r, { newBudgetUsd: 40, reinvestedUsd: 15 });
  // ceiling clamp
  const c = computeReinvestment({ revenue_usd_cents: 10000000, refunds_usd_cents: 0, spend_usd_cents: 0, max_cash_at_risk_usd: 240 });
  assert.deepEqual(c, { newBudgetUsd: REINVEST_RULES.maxBudgetUsd, reinvestedUsd: 10 });
  // at ceiling already ⇒ null
  assert.equal(computeReinvestment({ revenue_usd_cents: 10000000, refunds_usd_cents: 0, spend_usd_cents: 0, max_cash_at_risk_usd: 250 }), null);
});

test("computeReinvestment fails closed on no-profit and malformed inputs", () => {
  assert.equal(computeReinvestment({ revenue_usd_cents: 100, refunds_usd_cents: 0, spend_usd_cents: 100, max_cash_at_risk_usd: 25 }), null);
  assert.equal(computeReinvestment({ revenue_usd_cents: 0, refunds_usd_cents: 0, spend_usd_cents: 0, max_cash_at_risk_usd: 25 }), null);
  for (const bad of [{ revenue_usd_cents: "x" }, { revenue_usd_cents: -5, refunds_usd_cents: 0, spend_usd_cents: 0, max_cash_at_risk_usd: 25 }, {}]) {
    assert.equal(computeReinvestment(bad as any), null, JSON.stringify(bad));
  }
  // tiny margin where 10% floors to $0 ⇒ null
  assert.equal(computeReinvestment({ revenue_usd_cents: 500, refunds_usd_cents: 0, spend_usd_cents: 0, max_cash_at_risk_usd: 25 }), null);
});

// ── S5d capital allocator (pure fns, no DB) ──────────────────────────────────
import { assessMission, summarizePortfolio, PORTFOLIO_RULES } from "../../server/lib/mission-capital-allocator";

test("assessMission verdicts are deterministic and evidence-derived", () => {
  assert.equal(assessMission({ id: 1, stage: "killed" }).verdict, "killed");
  assert.equal(assessMission({ id: 2, stage: "validation", leads_contacted: 10, positive_replies: 0 }).verdict, "kill_recommended");
  assert.equal(assessMission({ id: 3, stage: "validation", leads_contacted: 25, positive_replies: 5, revenue_usd_cents: 0 }).verdict, "kill_recommended");
  assert.equal(assessMission({ id: 4, stage: "live", revenue_usd_cents: 5000, refunds_usd_cents: 0, spend_usd_cents: 1000 }).verdict, "scale_candidate");
  assert.equal(assessMission({ id: 5, stage: "live", revenue_usd_cents: 1000, refunds_usd_cents: 0, spend_usd_cents: 2000 }).verdict, "healthy");
  assert.equal(assessMission({ id: 6, stage: "hypothesis" }).verdict, "unproven");
});

test("summarizePortfolio flags over-capacity above maxActiveUnproven and excludes killed", () => {
  const un = (id: number) => assessMission({ id, stage: "hypothesis" });
  const ok2 = summarizePortfolio([un(1), un(2)]);
  assert.equal(ok2.overCapacity, false);
  const over = summarizePortfolio([un(1), un(2), un(3)]);
  assert.equal(over.overCapacity, true);
  assert.equal(over.activeUnproven, 3);
  const withKilled = summarizePortfolio([un(1), un(2), assessMission({ id: 9, stage: "killed" })]);
  assert.equal(withKilled.overCapacity, false, "killed missions never count toward capacity");
  assert.equal(PORTFOLIO_RULES.maxActiveUnproven, 2);
});

test("summarizePortfolio recommendations name kill/scale candidates as OWNER decisions", () => {
  const kill = assessMission({ id: 7, name: "dead", stage: "validation", leads_contacted: 12, positive_replies: 0 });
  const scale = assessMission({ id: 8, name: "winner", stage: "live", revenue_usd_cents: 9000, refunds_usd_cents: 0, spend_usd_cents: 100 });
  const p = summarizePortfolio([kill, scale]);
  assert.ok(p.recommendations.some(r => /KILL/.test(r) && /owner decision/.test(r)));
  assert.ok(p.recommendations.some(r => /first-dollar proven/.test(r) && /owner decision/.test(r)));
});

// ── S5e evidence-gated rubric (pure fn, no DB) ───────────────────────────────
import { evidenceGateScore, computeComposite, tierFor, EVIDENCE_GATE, type Score } from "../../server/lib/ideabrowser-score";

function mkScore(market: number, monet: number): Score {
  const base = { id: 1, vc_fit: 5, market_signal: market, monetization: monet, build_complexity: 1, strategic_bonus: 3, rationale: "r", buyer_hypothesis: "b", build_cost_estimate: "S" };
  const composite = computeComposite(base as any);
  return { ...base, composite, tier: tierFor(composite) } as Score;
}

test("evidenceGateScore clamps market/monetization to 3 without evidence and recomputes composite/tier", () => {
  const gated = evidenceGateScore(mkScore(5, 5), 0);
  assert.equal(gated.market_signal, EVIDENCE_GATE.maxUngated);
  assert.equal(gated.monetization, EVIDENCE_GATE.maxUngated);
  assert.equal(gated.composite, computeComposite(gated as any));
  assert.equal(gated.tier, tierFor(gated.composite));
  assert.match(gated.rationale, /evidence-gated/);
});

test("evidenceGateScore leaves scores untouched with evidence, or when already ≤3; junk counts gate (fail closed)", () => {
  const s = mkScore(5, 5);
  assert.equal(evidenceGateScore(s, 2), s);
  const low = mkScore(2, 3);
  assert.equal(evidenceGateScore(low, 0), low);
  for (const junk of [null, undefined, "x", -1, NaN]) {
    assert.equal(evidenceGateScore(mkScore(5, 5), junk).market_signal, EVIDENCE_GATE.maxUngated, `junk ${String(junk)}`);
  }
});

test("concurrency ceiling: active statuses set is exact and the draft guard sits above the INSERT", () => {
  assert.deepEqual([...ACTIVE_EXPERIMENT_STATUSES], ["awaiting_approval", "approved", "launching", "live"]);
  const src = fs.readFileSync("server/lib/revenue-missions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function createExperimentDraft"));
  const guardIdx = fn.indexOf("countActiveExperiments");
  const insertIdx = fn.indexOf("INSERT INTO mission_experiments");
  assert.ok(guardIdx > -1 && insertIdx > -1 && guardIdx < insertIdx, "concurrency guard must precede the INSERT");
  assert.match(fn.slice(guardIdx, insertIdx), /activeCount >= HARD_CAPS.maxConcurrentExperiments/);
});

// Architect finding (72h review): ownerGate must honor OWNER_TENANT_ID (single
// source of truth shared with the route layer), not a hardcoded tenant 1.
test("owner gate honors OWNER_TENANT_ID: tenant 1 is DENIED when owner is 7", async () => {
  const prev = process.env.OWNER_TENANT_ID;
  process.env.OWNER_TENANT_ID = "7";
  try {
    const res = await toolByName.get("revenue_mission_list")!.handler({}, { tenantId: 1 } as any);
    assert.match(String((res as any).error), /owner-only/);
  } finally {
    if (prev === undefined) delete process.env.OWNER_TENANT_ID; else process.env.OWNER_TENANT_ID = prev;
  }
});

test("owner gate honors OWNER_TENANT_ID: tenant 7 PASSES the gate when owner is 7 (fails later on params, not authz)", async () => {
  const prev = process.env.OWNER_TENANT_ID;
  process.env.OWNER_TENANT_ID = "7";
  try {
    // missionId 0 fails param validation AFTER the gate — proves the gate passed
    // without ever reaching a DB query (keeps the test pool-free).
    const res = await toolByName.get("revenue_mission_status")!.handler({ missionId: 0 }, { tenantId: 7 } as any);
    assert.match(String((res as any).error), /positive integer missionId/);
  } finally {
    if (prev === undefined) delete process.env.OWNER_TENANT_ID; else process.env.OWNER_TENANT_ID = prev;
  }
});

// ── S6b: pre-spawn budget gate (pure, query-free) ───────────────────────────
import { budgetHeadroomUsdCents, assertBudgetHeadroom } from "../../server/lib/revenue-missions";

test("budgetHeadroomUsdCents: clean numbers compute remaining", () => {
  assert.equal(budgetHeadroomUsdCents(1000, 5000), 4000);
  assert.equal(budgetHeadroomUsdCents(0, 5000), 5000);
  assert.equal(budgetHeadroomUsdCents(5000, 5000), 0);
  assert.equal(budgetHeadroomUsdCents(9000, 5000), 0, "over-spend clamps to 0");
  assert.equal(budgetHeadroomUsdCents(-50, 5000), 5000, "negative spend clamps to 0 spend");
});

test("budgetHeadroomUsdCents fails CLOSED on every non-clean-number shape", () => {
  for (const bad of [NaN, Infinity, -Infinity, "abc", {}, [1, 2], undefined, null && "x"]) {
    assert.equal(budgetHeadroomUsdCents(bad as any, 5000), 0, `spend=${String(bad)}`);
    assert.equal(budgetHeadroomUsdCents(100, bad as any), 0, `cap=${String(bad)}`);
  }
});

test("assertBudgetHeadroom throws on null/undefined spend (launch callsite passes raw DB value)", () => {
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: null, spendCapUsdCents: 5000 }),
    /unreadable/,
  );
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: undefined, spendCapUsdCents: 5000 }),
    /unreadable/,
  );
});

test("assertBudgetHeadroom throws on unreadable spend (fail closed)", () => {
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: "garbage", spendCapUsdCents: 5000 }),
    /unreadable/,
  );
});

test("assertBudgetHeadroom throws when cap reached", () => {
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: 5000, spendCapUsdCents: 5000, stepLabel: "outreach launch" }),
    /spend cap reached.*outreach launch/,
  );
});

test("assertBudgetHeadroom throws when estimate exceeds headroom (refuses, not truncates)", () => {
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: 4000, spendCapUsdCents: 5000, estimatedStepCostUsdCents: 1500 }),
    /insufficient budget headroom/,
  );
});

test("assertBudgetHeadroom throws on unreadable/negative estimate", () => {
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: 0, spendCapUsdCents: 5000, estimatedStepCostUsdCents: NaN }),
    /estimated cost.*unreadable/,
  );
  assert.throws(
    () => assertBudgetHeadroom({ spendSoFarUsdCents: 0, spendCapUsdCents: 5000, estimatedStepCostUsdCents: -1 }),
    /estimated cost.*unreadable/,
  );
});

test("assertBudgetHeadroom passes with headroom and returns remaining", () => {
  const r = assertBudgetHeadroom({ spendSoFarUsdCents: 1000, spendCapUsdCents: 5000, estimatedStepCostUsdCents: 2000 });
  assert.equal(r.remainingUsdCents, 4000);
});

// ── S6a: retrospective scoring (pure, query-free) ───────────────────────────
import { scoreMission, buildRetrospective } from "../../server/lib/mission-retrospective";
import { assessMission } from "../../server/lib/mission-capital-allocator";

function missionRow(over: any = {}) {
  return {
    stage: "killed", max_cash_at_risk_usd: 250, spend_usd_cents: 0,
    leads_contacted: 0, positive_replies: 0,
    revenue_usd_cents: 0, refunds_usd_cents: 0, ...over,
  };
}

test("scoreMission: zero-evidence mission scores 0", () => {
  assert.equal(scoreMission(assessMission(missionRow())), 0);
});

test("scoreMission: proven mission with margin scores high", () => {
  const a = assessMission(missionRow({ leads_contacted: 20, positive_replies: 5, revenue_usd_cents: 49700, spend_usd_cents: 1000 }));
  const s = scoreMission(a);
  assert.ok(s >= 60 && s <= 100, `expected high score, got ${s}`);
});

test("scoreMission is bounded 0..100 on hostile shapes", () => {
  const a = assessMission(missionRow({ leads_contacted: 1, positive_replies: 999, revenue_usd_cents: 10_000_000, spend_usd_cents: 1 }));
  const s = scoreMission(a);
  assert.ok(s >= 0 && s <= 100, `score out of bounds: ${s}`);
});

test("buildRetrospective: no-outreach mission gets the never-tested lesson, null ratios", () => {
  const r = buildRetrospective(missionRow(), "killed");
  assert.equal(r.terminalStage, "killed");
  assert.equal(r.roiPct, null);
  assert.equal(r.costPerPositiveReplyUsdCents, null);
  assert.equal(r.replyConversionPct, null);
  assert.match(r.lessons[0], /never demand-tested/);
  assert.match(r.nextActions[0], /Killed/);
});

test("buildRetrospective: interest-without-conversion lesson + demand re-run action", () => {
  const r = buildRetrospective(missionRow({ leads_contacted: 30, positive_replies: 4, spend_usd_cents: 500 }), "killed");
  assert.match(r.lessons[0], /Interest without conversion/);
  assert.ok(r.nextActions.some(a => /Demand existed/.test(a)));
  assert.equal(r.replyConversionPct, 13);
  assert.equal(r.costPerPositiveReplyUsdCents, 125);
});

test("buildRetrospective: scale_ready mission gets scale actions", () => {
  const r = buildRetrospective(missionRow({ stage: "scale_ready", leads_contacted: 20, positive_replies: 5, revenue_usd_cents: 49700, spend_usd_cents: 1000 }), "scale_ready");
  assert.match(r.nextActions[0], /Scale candidate/);
  assert.equal(r.roiPct, Math.round(((49700 - 0 - 1000) / 1000) * 100));
});

// ── S6c: opportunity-scanner packet builder (pure, query-free) ──────────────
import { buildMissionPacket, AUTO_PROPOSED_MARKER } from "../../server/lib/mission-opportunity-scanner";

const goodProject = {
  id: 42, name: "AI Trust Audit", description: "Audit local SMB AI readiness",
  metadata: { tier: "S", composite: 87, buyer_hypothesis: "Local SMB owners will pay $497 for an audit", rationale: "High urgency, low competition" },
};

test("buildMissionPacket: S-tier with full evidence yields packet with price + marker", () => {
  const p = buildMissionPacket(goodProject);
  assert.ok(p, "packet expected");
  assert.equal(p!.projectId, 42);
  assert.equal(p!.priceUsd, 497);
  assert.ok(p!.notes.includes(AUTO_PROPOSED_MARKER));
  assert.match(p!.hypothesis, /tier-S/);
});

test("buildMissionPacket: non-S/A tier returns null (fail toward not proposing)", () => {
  for (const tier of ["B", "C", "", undefined]) {
    assert.equal(buildMissionPacket({ ...goodProject, metadata: { ...goodProject.metadata, tier } }), null, `tier=${String(tier)}`);
  }
});

test("buildMissionPacket: thin evidence returns null", () => {
  assert.equal(buildMissionPacket({ ...goodProject, metadata: { ...goodProject.metadata, buyer_hypothesis: "  " } }), null);
  assert.equal(buildMissionPacket({ ...goodProject, metadata: { ...goodProject.metadata, rationale: undefined } }), null);
  assert.equal(buildMissionPacket({ ...goodProject, name: "" }), null);
  assert.equal(buildMissionPacket({ ...goodProject, metadata: null }), null);
});

test("buildMissionPacket: no $ figure leaves priceUsd unset", () => {
  const p = buildMissionPacket({ ...goodProject, metadata: { ...goodProject.metadata, buyer_hypothesis: "Owners will pay for an audit" } });
  assert.ok(p);
  assert.equal(p!.priceUsd, undefined);
});

test("scanAndProposeMission rejects invalid tenantId before any query", async () => {
  const { scanAndProposeMission } = await import("../../server/lib/mission-opportunity-scanner");
  await assert.rejects(() => scanAndProposeMission(0), /invalid tenantId/);
});

// ── S7 (DeepSeek gaps): validation gate + capital pool + retro feedback ─────
import { validateMission, VALIDATION_LAUNCH_THRESHOLD, assertMissionValidated, recordValidation } from "../../server/lib/mission-validation";
import { riskCeilingForPool, applyMarginToPool, POOL_RISK_FRACTION, seedPool, settleMissionCapital, getPool } from "../../server/lib/agent-capital";
import { retroAdjustment, type RetroSignal } from "../../server/lib/mission-opportunity-scanner";

const strongMission = {
  hypothesis: "SMBs with no llms.txt will pay for an AI trust audit because buyers now check it",
  ideal_customer: "Local service SMB owners with 5-50 staff and an existing website",
  offer: "Fixed-scope AI Trust Audit deliverable with prioritized fixes",
  pain_statement: "They are invisible to AI answer engines and losing leads",
  success_criteria: "3 positive replies from 10 contacts within 14 days",
  kill_criteria: "10 contacts with zero positive replies",
  price_usd: 497,
  max_cash_at_risk_usd: 25,
};

test("validateMission: strong packet passes threshold", () => {
  const v = validateMission(strongMission, { evidenceCount: 3, poolRiskCeilingUsdCents: null });
  assert.ok(v.score >= VALIDATION_LAUNCH_THRESHOLD, `score ${v.score}`);
  assert.equal(v.passed, true);
});

test("validateMission: missing kill criteria + no price + no evidence fails", () => {
  const v = validateMission({ ...strongMission, kill_criteria: null, price_usd: 0 }, { evidenceCount: 0, poolRiskCeilingUsdCents: null });
  assert.equal(v.passed, false);
});

test("validateMission: empty mission scores near zero and fails", () => {
  const v = validateMission({}, { evidenceCount: 0, poolRiskCeilingUsdCents: null });
  assert.ok(v.score <= 30, `score ${v.score}`);
  assert.equal(v.passed, false);
});

test("validateMission: seeded pool ceiling blocks over-risk cash", () => {
  // 25 USD at risk = 2500 cents > 1000-cent ceiling → economics points lost.
  const capped = validateMission(strongMission, { evidenceCount: 3, poolRiskCeilingUsdCents: 1000 });
  const uncapped = validateMission(strongMission, { evidenceCount: 3, poolRiskCeilingUsdCents: null });
  assert.ok(capped.score < uncapped.score, `${capped.score} !< ${uncapped.score}`);
});

test("validateMission: unseeded pool (null ceiling) imposes no constraint", () => {
  const v = validateMission(strongMission, { evidenceCount: 0, poolRiskCeilingUsdCents: null });
  const econ = v.checks.find((c) => c.name === "economics_sanity")!;
  assert.equal(econ.points, 30);
});

for (const bad of badTenants) {
  test(`recordValidation rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(() => recordValidation(bad, 1), /invalid tenantId/);
  });
  test(`assertMissionValidated rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(() => assertMissionValidated(bad, 1), /invalid tenantId/);
  });
  test(`seedPool rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(() => seedPool(bad, 1000, "test"), /invalid tenantId/);
  });
  test(`settleMissionCapital rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(() => settleMissionCapital(bad, 1), /invalid tenantId/);
  });
  test(`getPool rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(() => getPool(bad), /invalid tenantId/);
  });
}

test("seedPool rejects negative / unreadable amounts (fail closed)", async () => {
  for (const amt of [-1, NaN, Infinity, "x" as any]) {
    await assert.rejects(() => seedPool(1, amt, "test"), /invalid seed amount|invalid tenantId/);
  }
});

test("riskCeilingForPool: unseeded or absent pool → null (no constraint)", () => {
  assert.equal(riskCeilingForPool(null), null);
  assert.equal(riskCeilingForPool({ balanceUsdCents: 100000, seeded: false }), null);
});

test("riskCeilingForPool: seeded pool → 25% of balance, floored", () => {
  assert.equal(riskCeilingForPool({ balanceUsdCents: 10000, seeded: true }), Math.floor(10000 * POOL_RISK_FRACTION));
  assert.equal(riskCeilingForPool({ balanceUsdCents: 0, seeded: true }), 0);
  assert.equal(riskCeilingForPool({ balanceUsdCents: -50, seeded: true }), 0);
});

test("applyMarginToPool: positive margin adds to balance and earned", () => {
  const p = applyMarginToPool({ balanceUsdCents: 100, totalEarnedUsdCents: 0, totalSpentUsdCents: 0 }, 250);
  assert.deepEqual(p, { balanceUsdCents: 350, totalEarnedUsdCents: 250, totalSpentUsdCents: 0 });
});

test("applyMarginToPool: loss floors balance at 0 and records spend", () => {
  const p = applyMarginToPool({ balanceUsdCents: 100, totalEarnedUsdCents: 0, totalSpentUsdCents: 0 }, -250);
  assert.deepEqual(p, { balanceUsdCents: 0, totalEarnedUsdCents: 0, totalSpentUsdCents: 250 });
});

test("applyMarginToPool: unreadable margin is a no-op (never corrupts the ledger)", () => {
  const before = { balanceUsdCents: 100, totalEarnedUsdCents: 5, totalSpentUsdCents: 7 };
  assert.deepEqual(applyMarginToPool(before, NaN), before);
  assert.deepEqual(applyMarginToPool(before, Infinity), before);
});

const killedSignal: RetroSignal = { terminalStage: "killed", score: 10, priceUsd: 500, realizedMarginUsdCents: -2000 };
const provenSignal: RetroSignal = { terminalStage: "scale_ready", score: 85, priceUsd: 500, realizedMarginUsdCents: 5000 };

test("retroAdjustment: killed low-score price band penalizes", () => {
  assert.equal(retroAdjustment(497, [killedSignal]), -15);
});

test("retroAdjustment: proven scale_ready price band boosts", () => {
  assert.equal(retroAdjustment(497, [provenSignal]), 10);
});

test("retroAdjustment: out-of-band price is untouched", () => {
  assert.equal(retroAdjustment(5000, [killedSignal, provenSignal]), 0);
});

test("retroAdjustment: clamped to ±30", () => {
  assert.equal(retroAdjustment(497, Array(10).fill(killedSignal)), -30);
  assert.equal(retroAdjustment(497, Array(10).fill(provenSignal)), 30);
});

test("retroAdjustment: no price / junk signals → 0", () => {
  assert.equal(retroAdjustment(undefined, [killedSignal]), 0);
  assert.equal(retroAdjustment(0, [killedSignal]), 0);
  assert.equal(retroAdjustment(497, [{ ...killedSignal, priceUsd: NaN }]), 0);
  assert.equal(retroAdjustment(497, null as any), 0);
});

test("retroAdjustment: killed HIGH-score mission does not penalize (only disproven patterns)", () => {
  assert.equal(retroAdjustment(497, [{ ...killedSignal, score: 60 }]), 0);
});

// ── Launch wedge guards (72h review R125+137.82) ────────────────────────────
// Static source guards: the rollback path in mission-experiment-run.ts must
// never swallow a rollback failure (.catch(() => {})) — that wedges an
// approved experiment in 'launching' + sequence_id NULL forever — and the
// launch CAS must carry the stale-claim recovery clause that self-heals it.
test("mission-experiment-run: rollback failure is never silently swallowed", () => {
  const src = fs.readFileSync("server/lib/mission-experiment-run.ts", "utf8");
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(noComments), "found a silent .catch(() => {}) in mission-experiment-run.ts");
  assert.ok(/ROLLBACK FAILED/.test(src), "rollback-failure path must log loudly");
});

test("mission-experiment-run: launch CAS includes stale-claim recovery", () => {
  const src = fs.readFileSync("server/lib/mission-experiment-run.ts", "utf8");
  // Pin the whole CAS block: recovery clause AND its sequence_id IS NULL /
  // approved_by_owner_at guards must live in the SAME UPDATE statement.
  const cas = src.match(/UPDATE mission_experiments\s+SET status = 'launching'[\s\S]*?RETURNING id/);
  assert.ok(cas, "launch CAS UPDATE not found");
  assert.ok(/status = 'launching' AND updated_at </.test(cas![0]), "stale 'launching' claims must be reclaimable in the CAS");
  assert.ok(/sequence_id IS NULL/.test(cas![0]), "CAS recovery must be gated on sequence_id IS NULL (no double-send)");
  assert.ok(/approved_by_owner_at IS NOT NULL/.test(cas![0]), "CAS must still require owner approval");
});

test("mission-experiment-run: sequence_id persists BEFORE any enrollment (no dup-send window)", () => {
  const src = fs.readFileSync("server/lib/mission-experiment-run.ts", "utf8");
  // The immediate persist (SET sequence_id ... WHERE ... sequence_id IS NULL)
  // must appear in source BEFORE the enrollInSequence call loop, so a crash
  // mid-enrollment leaves the row reclaim-proof (stale-claim CAS requires
  // sequence_id IS NULL) and the retry resumes the SAME sequence.
  const persistIdx = src.indexOf("SET sequence_id = ");
  const enrollIdx = src.indexOf("await enrollInSequence(");
  assert.ok(persistIdx > 0, "immediate sequence_id persist not found");
  assert.ok(enrollIdx > 0, "enroll loop not found");
  assert.ok(persistIdx < enrollIdx, "sequence_id must be persisted before enrollment begins");
  // And the final 'live' update must NOT re-set sequence_id (single writer).
  const liveBlock = src.match(/SET status = 'live'[\s\S]*?WHERE/);
  assert.ok(liveBlock && !/sequence_id =/.test(liveBlock[0]), "final live update must not re-write sequence_id");
});

test("isStaleLaunchClaim: only stale, sequence-less 'launching' rows qualify", () => {
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const fresh = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  assert.equal(isStaleLaunchClaim({ status: "launching", sequence_id: null, updated_at: old }), true);
  assert.equal(isStaleLaunchClaim({ status: "launching", sequence_id: null, updated_at: fresh }), false, "fresh claim not reclaimable");
  assert.equal(isStaleLaunchClaim({ status: "launching", sequence_id: 7, updated_at: old }), false, "sequence exists ⇒ never reclaim");
  assert.equal(isStaleLaunchClaim({ status: "approved", sequence_id: null, updated_at: old }), false);
  assert.equal(isStaleLaunchClaim({ status: "launching", sequence_id: null, updated_at: "junk" }), false, "unparseable timestamp fails closed");
  assert.equal(isStaleLaunchClaim(null), false);
});

test("assertSendAllowed: stale wedged 'launching' row may retry (self-heal reachable)", () => {
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  assert.doesNotThrow(() =>
    assertSendAllowed({ status: "launching", sequence_id: null, updated_at: old, approved_by_owner_at: "2026-07-22" }),
  );
  assert.throws(
    () => assertSendAllowed({ status: "launching", sequence_id: null, updated_at: old, approved_by_owner_at: null }),
    /not owner-approved/,
    "stale claim without owner approval still fails closed",
  );
  assert.throws(
    () => assertSendAllowed({ status: "launching", sequence_id: 9, updated_at: old, approved_by_owner_at: "2026-07-22" }),
    /only 'approved'/,
    "stale claim WITH a sequence never retries (send may have happened)",
  );
});

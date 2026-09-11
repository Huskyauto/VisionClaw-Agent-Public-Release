// Query-free unit tests for mission economics (true contribution margin —
// CPT 5.6 priority 4). Only pure functions are exercised plus static
// source-scan assertions that settlement/reinvestment actually use the new
// figure (node-test DB-pool hang rule: no live queries).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeContributionMarginUsdCents,
  paymentFeeItemFromBalanceTransaction,
  requireNonNegInt,
} from "../../server/lib/mission-economics";
import { computeReinvestment } from "../../server/lib/mission-autonomy";

describe("computeContributionMarginUsdCents (pure, fail closed)", () => {
  const base = {
    revenueUsdCents: 20000,
    refundsUsdCents: 2000,
    spendUsdCents: 3000,
    paymentFeesUsdCents: 610,
    variableApiCostUsdCents: 42,
  };
  test("subtracts every cost component", () => {
    assert.equal(computeContributionMarginUsdCents(base), 20000 - 2000 - 3000 - 610 - 42);
  });
  test("margin can be negative (honest, never clamped)", () => {
    assert.equal(
      computeContributionMarginUsdCents({ ...base, revenueUsdCents: 1000 }),
      1000 - 2000 - 3000 - 610 - 42,
    );
  });
  test("all-zero parts give zero", () => {
    assert.equal(
      computeContributionMarginUsdCents({
        revenueUsdCents: 0, refundsUsdCents: 0, spendUsdCents: 0,
        paymentFeesUsdCents: 0, variableApiCostUsdCents: 0,
      }),
      0,
    );
  });
  test("fails closed (null) on every malformed part shape", () => {
    const bads: unknown[] = [null, undefined, NaN, Infinity, -1, "junk", true, {}, [1, 2]];
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      for (const bad of bads) {
        assert.equal(
          computeContributionMarginUsdCents({ ...base, [key]: bad } as any),
          null,
          `${key}=${String(bad)} must fail closed`,
        );
      }
    }
  });
  test("numeric strings are coerced (DB rows arrive as strings)", () => {
    assert.equal(
      computeContributionMarginUsdCents({
        revenueUsdCents: "20000", refundsUsdCents: "0", spendUsdCents: "0",
        paymentFeesUsdCents: "610", variableApiCostUsdCents: "42",
      } as any),
      20000 - 610 - 42,
    );
  });
});

describe("paymentFeeItemFromBalanceTransaction (pure, fail closed)", () => {
  test("extracts txn id + integer fee", () => {
    assert.deepEqual(
      paymentFeeItemFromBalanceTransaction({ id: "txn_123", fee: 610, net: 19390 }),
      { externalRef: "txn_123", feeUsdCents: 610 },
    );
  });
  test("zero fee is valid (free payment methods exist)", () => {
    assert.deepEqual(
      paymentFeeItemFromBalanceTransaction({ id: "txn_z", fee: 0 }),
      { externalRef: "txn_z", feeUsdCents: 0 },
    );
  });
  test("fails closed on junk", () => {
    for (const bad of [
      null, undefined, "txn_123", 42,
      { id: "txn_1" },                         // missing fee
      { id: "txn_1", fee: -1 },                // negative fee
      { id: "txn_1", fee: 1.5 },               // non-integer
      { id: "txn_1", fee: "610" },             // Number("610") is fine? NO — see below
      { id: "ch_123", fee: 610 },              // wrong id family
      { id: "", fee: 610 },
      { fee: 610 },
    ]) {
      const r = paymentFeeItemFromBalanceTransaction(bad);
      if (bad && (bad as any).fee === "610") {
        // Stripe SDK returns numbers; string coercion via Number() is accepted.
        assert.deepEqual(r, { externalRef: "txn_1", feeUsdCents: 610 });
      } else {
        assert.equal(r, null, JSON.stringify(bad));
      }
    }
  });
});

describe("computeReinvestment honours extra costs (contribution margin)", () => {
  const mission = { revenue_usd_cents: 20000, refunds_usd_cents: 2000, spend_usd_cents: 3000, max_cash_at_risk_usd: 25 };
  test("extra costs shrink the reinvestable margin", () => {
    const withZero = computeReinvestment(mission, 0)!;
    const withCosts = computeReinvestment(mission, 5000)!;
    assert.ok(withZero.reinvestedUsd > withCosts.reinvestedUsd);
    // margin 15000c → 10000c ⇒ 10% ⇒ $10
    assert.equal(withCosts.reinvestedUsd, 10);
  });
  test("extra costs can eliminate reinvestment entirely", () => {
    assert.equal(computeReinvestment(mission, 15000), null);
    assert.equal(computeReinvestment(mission, 14001), null); // 999c margin ⇒ $0 reinvest
  });
  test("default (no arg) behaves as before", () => {
    assert.deepEqual(computeReinvestment(mission), computeReinvestment(mission, 0));
  });
  test("fails closed on malformed extra costs — never treated as $0", () => {
    for (const bad of [NaN, Infinity, -1, "junk", null, undefined, {}, true]) {
      if (bad === undefined) continue; // undefined = default 0 by signature
      assert.equal(computeReinvestment(mission, bad), null, String(bad));
    }
  });
});

describe("requireNonNegInt (rollup guard, fail closed)", () => {
  test("passes clean non-negative integers (numbers and DB string rows)", () => {
    assert.equal(requireNonNegInt(0, "x", 1), 0);
    assert.equal(requireNonNegInt(20000, "x", 1), 20000);
    assert.equal(requireNonNegInt("20000", "x", 1), 20000);
  });
  test("throws on every corrupt shape — never coerces to $0", () => {
    for (const bad of [null, undefined, NaN, Infinity, -1, 1.5, "junk", "", true, false, {}, []]) {
      assert.throws(() => requireNonNegInt(bad, "x", 1), /fail closed/, String(bad));
    }
  });
});

describe("settlement + reinvestment are wired to the honest figure (source scan)", () => {
  test("settleMissionCapital subtracts fees and api cost inside the txn", () => {
    const src = readFileSync("server/lib/agent-capital.ts", "utf8");
    assert.match(src, /payment_fee/, "settlement must sum payment-fee evidence");
    assert.match(src, /agent_cost_ledger[\s\S]*mission_id/, "settlement must sum mission-attributed ledger cost");
    assert.match(src, /-\s*fees\s*-\s*apiCost/, "margin must subtract fees + apiCost");
    assert.match(src, /throw new Error\(`agent-capital: mission \$\{missionId\} economics unreadable/, "unreadable economics must abort settlement (fail closed)");
  });
  test("webhook reinvestment passes extra costs and refuses on unreadable economics", () => {
    const src = readFileSync("server/webhookHandlers.ts", "utf8");
    assert.match(src, /sumPaymentFeesUsdCents/, "reinvestment must read fee sum");
    assert.match(src, /sumVariableApiCostUsdCents/, "reinvestment must read api-cost sum");
    assert.match(src, /extraCostsUsdCents == null \? null : computeReinvestment\(mission, extraCostsUsdCents\)/, "unreadable economics must refuse reinvestment");
  });
  test("mission drafting LLM call is attributed (sample harvest)", () => {
    const src = readFileSync("server/lib/mission-sample-harvest.ts", "utf8");
    assert.match(src, /withMissionCostAttribution\(\s*args\.missionId/, "icpFilterAndDraft must run under mission cost attribution");
  });
  test("deployment DDL exists for agent_cost_ledger.mission_id (boot-time migration)", () => {
    const src = readFileSync("server/seed.ts", "utf8");
    assert.match(src, /ALTER TABLE agent_cost_ledger ADD COLUMN IF NOT EXISTS mission_id integer/, "prod boot must add the mission_id column");
    assert.match(src, /CREATE INDEX IF NOT EXISTS idx_agent_cost_ledger_tenant_mission ON agent_cost_ledger \(tenant_id, mission_id\)/, "prod boot must add the rollup index");
  });
  test("payment-fee idempotency: committed unique index matches addEvidence's ON CONFLICT", () => {
    const seedSrc = readFileSync("server/seed.ts", "utf8");
    assert.match(
      seedSrc,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_evidence_tenant_source_ref ON mission_evidence \(tenant_id, source, external_ref\) WHERE external_ref IS NOT NULL/,
      "the evidence dedupe unique index must be committed deployment DDL",
    );
    const rmSrc = readFileSync("server/lib/revenue-missions.ts", "utf8");
    assert.match(
      rmSrc,
      /ON CONFLICT \(tenant_id, source, external_ref\) WHERE external_ref IS NOT NULL DO NOTHING/,
      "addEvidence conflict target must match the committed index exactly",
    );
    // Fee rows flow through addEvidence with the txn_ id as externalRef, so a
    // retried payment_intent.succeeded dedupes to ONE fee row.
    const whSrc = readFileSync("server/webhookHandlers.ts", "utf8");
    assert.match(whSrc, /externalRef: item\.externalRef,[\s\S]{0,220}raw: \{ kind: 'payment_fee'/, "recordMissionPaymentFee must dedupe on the balance-transaction id via addEvidence");
  });
  test("recordCost stamps the ALS mission id", () => {
    const src = readFileSync("server/agentic/cost-ledger.ts", "utf8");
    // The ambient mission id must be snapshotted SYNCHRONOUSLY at recordCost
    // entry (before any await) and that snapshot must be what the insert stamps.
    assert.match(src, /const missionIdSnapshot = currentMissionCostId\(\);/, "recordCost must snapshot the ambient mission id synchronously at entry");
    assert.match(src, /missionId: missionIdSnapshot/, "every ledger row must carry the snapshotted ambient mission id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #154 — LIVE end-to-end proof that mission costs land in the ledger.
//
// What it proves, against the REAL dev database and the REAL provider stack:
//   1. An LLM call made inside withMissionCostAttribution(missionId, ...)
//      produces an agent_cost_ledger row stamped with that mission_id
//      (free modelfarm lane → ~$0 spend, but a genuine recordCost path).
//   2. A Stripe payment webhook (constructed event, same production code path
//      via WebhookHandlers.recordMissionEvidence) records revenue AND a
//      payment_fee evidence row (type='other', raw.kind='payment_fee').
//   3. settleMissionCapital's settled margin EXACTLY equals
//      getMissionEconomics(...).contributionMarginUsdCents computed beforehand.
//
// Run:  npx tsx scripts/mission-cost-live-check.ts
// Exit: 0 = all checks pass; 1 = any check fails (fail closed, loud).
// Cleanup: everything is created under a dedicated throwaway tenant and
// deleted at the end (best-effort; failures reported).
// ─────────────────────────────────────────────────────────────────────────────
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import { createMission, setStage } from "../server/lib/revenue-missions";
import { withMissionCostAttribution } from "../server/agentic/cost-ledger";
import { getMissionEconomics } from "../server/lib/mission-economics";
import { settleMissionCapital } from "../server/lib/agent-capital";
import { WebhookHandlers } from "../server/webhookHandlers";
import { replitOpenai } from "../server/providers";
import { withTenantContext } from "../server/lib/tenant-context";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

const RUN = `lc${Date.now().toString(36)}`;
const PAYMENT_CENTS = 4900;
const FEE_CENTS = 143;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  let tenantId = 0;
  let missionId = 0;
  const savedOwnerTenant = process.env.OWNER_TENANT_ID;

  try {
    // ── setup: throwaway tenant + mission ────────────────────────────────
    const t = rows(await db.execute(sql`
      INSERT INTO tenants (email, name, plan)
      VALUES (${`${RUN}@cost-live-check.test`}, ${"Mission Cost Live Check"}, 'trial')
      RETURNING id
    `));
    tenantId = Number(t[0].id);
    if (!(tenantId > 0)) throw new Error("failed to create test tenant");
    process.env.OWNER_TENANT_ID = String(tenantId);

    const m = await createMission({
      tenantId,
      name: `Cost Live Check ${RUN}`,
      hypothesis: "Live check: mission costs are attributed to the ledger end to end.",
      idealCustomer: "n/a (internal verification)",
      offer: "n/a — this mission exists only to verify cost attribution.",
      painStatement: "Silent cost-attribution regressions would corrupt mission economics.",
      priceUsd: 49,
      successCriteria: "ledger row, fee evidence, and settle==economics all verified",
      killCriteria: "always killed at end of check",
    });
    missionId = Number(m.id);
    console.log(`[live-check] tenant=${tenantId} mission=${missionId}`);

    // ── 1. real LLM call inside withMissionCostAttribution ──────────────
    console.log("[live-check] 1. attributed LLM call → agent_cost_ledger");
    let resp: any = null;
    try {
      // Both ALS contexts, exactly like production: tenant context (billing
      // attribution — without it recordCost bills ADMIN) + mission context.
      resp = await withTenantContext({ tenantId, source: "explicit" }, () =>
        withMissionCostAttribution(missionId, () =>
          replitOpenai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: "Reply with the single word: ok" }],
            // Reasoning models burn "thinking" tokens against this ceiling; a tiny
            // cap 400s with "output limit reached" before any content is emitted.
            max_completion_tokens: 1024,
          }),
        ),
      );
    } catch (e: any) {
      console.error("    LLM call threw:", e?.message ?? e);
    }
    check("LLM call returned a completion", Boolean(resp?.choices?.[0]?.message));

    // recordCost fires post-response but is awaited inside the wrapper's ALS
    // scope; give any fire-and-forget tail a moment, then poll briefly.
    let ledger: any[] = [];
    for (let i = 0; i < 10 && ledger.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      ledger = rows(await db.execute(sql`
        SELECT id, tool_name, model, cost_usd, tokens_in, tokens_out
        FROM agent_cost_ledger
        WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
      `));
    }
    check("agent_cost_ledger row exists with mission_id", ledger.length >= 1,
      `found ${ledger.length} rows`);
    if (ledger[0]) {
      console.log(`    ledger: tool=${ledger[0].tool_name} model=${ledger[0].model} cost=$${ledger[0].cost_usd} in=${ledger[0].tokens_in} out=${ledger[0].tokens_out}`);
      check("ledger cost_usd is a parseable number", Number.isFinite(Number(ledger[0].cost_usd)));
    }

    // ── 2. fake Stripe payment webhook → revenue + payment_fee evidence ─
    console.log("[live-check] 2. Stripe payment webhook → revenue + fee evidence");
    // Payments are only accepted for post-approval missions (provenance guard),
    // so walk the legal stage chain up to experiment_live first.
    for (const stage of ["offer_defined", "experiment_draft", "experiment_awaiting_approval", "experiment_live"] as const) {
      await setStage(tenantId, missionId, stage);
    }
    const paymentIntent = {
      id: `pi_${RUN}`,
      object: "payment_intent",
      amount_received: PAYMENT_CENTS,
      currency: "usd",
      livemode: false,
      metadata: { mission_id: String(missionId) },
      latest_charge: {
        id: `ch_${RUN}`,
        balance_transaction: { id: `txn_${RUN}`, fee: FEE_CENTS },
      },
    };
    await WebhookHandlers.recordMissionEvidence("payment", paymentIntent);

    const mrow = rows(await db.execute(sql`
      SELECT revenue_usd_cents FROM revenue_missions
      WHERE tenant_id = ${tenantId} AND id = ${missionId}
    `))[0];
    check(`revenue counted (${PAYMENT_CENTS}c)`, Number(mrow?.revenue_usd_cents) === PAYMENT_CENTS,
      `got ${mrow?.revenue_usd_cents}`);

    const fee = rows(await db.execute(sql`
      SELECT amount_usd_cents, external_ref, raw->>'kind' AS kind
      FROM mission_evidence
      WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
        AND type = 'other' AND raw->>'kind' = 'payment_fee'
    `));
    check(`payment_fee evidence row (${FEE_CENTS}c, txn ref)`,
      fee.length === 1 && Number(fee[0].amount_usd_cents) === FEE_CENTS && fee[0].external_ref === `txn_${RUN}`,
      JSON.stringify(fee));

    // ── 3. economics == settlement ───────────────────────────────────────
    console.log("[live-check] 3. settleMissionCapital margin == getMissionEconomics");
    const econ = await getMissionEconomics(tenantId, missionId);
    console.log(`    economics: revenue=${econ.revenueUsdCents}c refunds=${econ.refundsUsdCents}c spend=${econ.spendUsdCents}c fees=${econ.paymentFeesUsdCents}c apiCost=${econ.variableApiCostUsdCents}c margin=${econ.contributionMarginUsdCents}c`);
    check("contributionMarginUsdCents is a number", Number.isInteger(econ.contributionMarginUsdCents));

    await setStage(tenantId, missionId, "killed", "live-check complete");
    const settle = await settleMissionCapital(tenantId, missionId);
    check("capital settled", settle.settled === true);
    check("settled margin equals economics contribution margin",
      settle.marginUsdCents === econ.contributionMarginUsdCents,
      `settle=${settle.marginUsdCents} econ=${econ.contributionMarginUsdCents}`);

    const replay = await settleMissionCapital(tenantId, missionId);
    check("settlement replay is a no-op", replay.settled === false);
  } finally {
    // ── cleanup ──────────────────────────────────────────────────────────
    if (savedOwnerTenant === undefined) delete process.env.OWNER_TENANT_ID;
    else process.env.OWNER_TENANT_ID = savedOwnerTenant;
    if (tenantId > 0) {
      try {
        await db.execute(sql`DELETE FROM mission_evidence WHERE tenant_id = ${tenantId}`);
        await db.execute(sql`DELETE FROM agent_wake_schedules WHERE tenant_id = ${tenantId}`);
        await db.execute(sql`DELETE FROM agent_capital WHERE tenant_id = ${tenantId}`);
        await db.execute(sql`DELETE FROM agent_cost_ledger WHERE tenant_id = ${tenantId}`);
        await db.execute(sql`DELETE FROM revenue_missions WHERE tenant_id = ${tenantId}`);
        await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`);
        console.log("[live-check] cleanup complete");
      } catch (e: any) {
        console.warn("[live-check] cleanup failed:", e?.message ?? e);
      }
    }
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`[live-check] FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[live-check] PASS — all checks green");
  process.exit(0);
}

main().catch((e) => {
  console.error("[live-check] fatal:", e?.stack || e);
  process.exit(1);
});

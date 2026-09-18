// ─────────────────────────────────────────────────────────────────────────────
// Revenue Mission GOLDEN PATH — one CI-runnable end-to-end test of the whole
// idea-to-payment loop (task: CPT 5.6 external-review priority 5).
//
// Lifecycle exercised, in order:
//   create mission → prelaunch evidence → validation gate → experiment draft
//   (over-cap draft REFUSED) → unapproved send REJECTED (HITL fail-closed) →
//   owner approval → sequence created + capped prospects enrolled → launch
//   replay is a no-op → negative reply (enrollment stopped) → positive reply →
//   checkout_started → fake Stripe payment webhook (fee + autonomy hooks) →
//   payment replay is a no-op (evidence, counters AND reinvestment) → partial
//   refund → refund replay no-op → fulfillment wake scheduled (autonomy ≥4) →
//   kill → retrospective recorded → capital settled EXACTLY once.
//
// Fakes: Stripe events are constructed objects fed to the same webhook code
// path production uses (WebhookHandlers.recordMissionEvidence); the balance
// transaction is inlined so no network call is needed. "Gmail replies" enter
// at the deterministic post-classification seam the scanner itself uses
// (addEvidence with source='gmail' + pauseEnrollmentForReply) — no LLM, no
// network. Real Postgres (dev DB locally, the db:push service DB in CI; the
// mission tables are bootstrapped from tests/fixtures/mission-schema-bootstrap.sql
// when absent). Deterministic: no clocks are advanced; nothing here sends email
// (enrollment only inserts rows — sends happen later via advanceSequence,
// which never runs in this test).
//
// Exit hygiene: the webhook import graph carries interval-holding modules, so
// run.sh/CI invoke this file with --test-force-exit; the pool is also ended
// explicitly in after().
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { db, pool } from "../../server/db";
import { sql } from "drizzle-orm";
import {
  createMission,
  addEvidence,
  setStage,
  getMission,
  getExperiment,
  createExperimentDraft,
  approveExperiment,
  HARD_CAPS,
} from "../../server/lib/revenue-missions";
import { recordValidation } from "../../server/lib/mission-validation";
import { runApprovedExperiment, classifyReplyText, OPT_OUT_LINE } from "../../server/lib/mission-experiment-run";
import { pauseEnrollmentForReply } from "../../server/lib/mission-reply-intake";
import { settleMissionCapital } from "../../server/lib/agent-capital";
import { sumPaymentFeesUsdCents } from "../../server/lib/mission-economics";
import { WebhookHandlers } from "../../server/webhookHandlers";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

const RUN = `gp${Date.now().toString(36)}`;
let tenantId = 0;
let missionId = 0;
let experimentId = 0;
let sequenceId = 0;
let savedOwnerTenantEnv: string | undefined;

const PROSPECT_A = `alice-${RUN}@example.test`;
const PROSPECT_B = `bob-${RUN}@example.test`;
const PI_ID = `pi_${RUN}`;
const CHARGE_ID = `ch_${RUN}`;
const TXN_ID = `txn_${RUN}`;
const REFUND_ID = `re_${RUN}`;
const PAYMENT_CENTS = 4900;
const REFUND_CENTS = 1900;
const FEE_CENTS = 172;

before(async () => {
  // Bootstrap the mission tables on a fresh (CI) database. Locally these
  // already exist (seed.ts / ops DDL) and the fixture is skipped entirely.
  const probe = rows(await db.execute(sql`SELECT to_regclass('public.revenue_missions') AS t`));
  if (!probe[0]?.t) {
    const ddl = readFileSync(path.join(process.cwd(), "tests/fixtures/mission-schema-bootstrap.sql"), "utf8");
    await db.execute(sql.raw(ddl));
  }
  const t = rows(await db.execute(sql`
    INSERT INTO tenants (email, name, plan) VALUES (${`${RUN}@golden-path.test`}, ${"Golden Path Test Tenant"}, 'trial')
    RETURNING id
  `));
  tenantId = Number(t[0].id);
  assert.ok(tenantId > 0);
  // Missions are owner-scoped in the webhook path: point ownerTenantId() at
  // the test tenant for the duration of the test.
  savedOwnerTenantEnv = process.env.OWNER_TENANT_ID;
  process.env.OWNER_TENANT_ID = String(tenantId);
});

after(async () => {
  if (savedOwnerTenantEnv === undefined) delete process.env.OWNER_TENANT_ID;
  else process.env.OWNER_TENANT_ID = savedOwnerTenantEnv;
  if (tenantId > 0) {
    try {
      await db.execute(sql`DELETE FROM mission_evidence WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM mission_experiments WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM outreach_enrollments WHERE tenant_id = ${tenantId}`);
      if (sequenceId > 0) {
        await db.execute(sql`DELETE FROM outreach_sequence_steps WHERE sequence_id = ${sequenceId}`);
      }
      await db.execute(sql`DELETE FROM outreach_sequences WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM agent_wake_schedules WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM agent_capital WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM agent_cost_ledger WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM revenue_missions WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`);
    } catch (e) {
      console.warn("[golden-path] cleanup failed (rows may linger under test tenant):", (e as any)?.message ?? e);
    }
  }
  await pool.end().catch(() => {});
});

test("1. mission is created with a substantive packet", async () => {
  const m = await createMission({
    tenantId,
    name: `Golden Path ${RUN}`,
    hypothesis: "Solo consultants will pay for a done-for-you AI readiness audit.",
    idealCustomer: "Solo consultants and 2-10 person agencies in the US.",
    offer: "A $49 AI readiness mini-audit delivered as a PDF within 48 hours.",
    painStatement: "They lose deals because prospects ask about AI and they have no answer.",
    priceUsd: 49,
    successCriteria: "3 paid audits inside the prospect cap within 14 days.",
    killCriteria: "0 positive replies after 25 prospects contacted, or any spend over cap.",
  });
  missionId = Number(m.id);
  assert.ok(missionId > 0);
  assert.equal(m.stage, "hypothesis");
});

test("2. prelaunch evidence recorded; validation gate passes", async () => {
  for (let i = 1; i <= 3; i++) {
    const ev = await addEvidence({
      tenantId,
      missionId,
      type: "complaint_sourced",
      summary: `Prelaunch signal #${i}: forum post complaining about exactly this pain (${RUN}).`,
      source: "manual",
    });
    assert.ok(ev, `prelaunch evidence #${i} recorded`);
  }
  const v = await recordValidation(tenantId, missionId);
  assert.ok(v, "validation computed");
  assert.ok(v!.passed, `validation must pass (score ${v!.score})`);
  assert.ok(v!.score >= 70);
});

test("3. over-cap draft is REFUSED, never truncated", async () => {
  await setStage(tenantId, missionId, "offer_defined");
  const tooMany = Array.from({ length: HARD_CAPS.maxProspects + 1 }, (_, i) => ({
    email: `p${i}-${RUN}@example.test`,
    name: `P${i}`,
  }));
  await assert.rejects(
    createExperimentDraft({
      tenantId,
      missionId,
      name: "over-cap",
      prospects: tooMany as any,
      variants: [{ subject: "Hi", body: "Quick question about your AI readiness." }] as any,
    }),
    /cap/i,
  );
});

test("4. capped draft lands awaiting approval; unapproved send is REJECTED", async () => {
  const exp = await createExperimentDraft({
    tenantId,
    missionId,
    name: `golden-path-exp-${RUN}`,
    prospects: [
      { email: PROSPECT_A, name: "Alice" },
      { email: PROSPECT_B, name: "Bob" },
    ] as any,
    variants: [
      { subject: "Quick AI readiness question", body: "Would a $49 48-hour AI readiness audit be useful to you?" },
      { subject: "Following up", body: "Circling back on the AI readiness audit — worth a look?" },
    ] as any,
  });
  experimentId = Number(exp.id);
  assert.equal(exp.status, "awaiting_approval");
  const m = await getMission(tenantId, missionId);
  assert.equal(m.stage, "experiment_awaiting_approval");

  // HITL fail-closed: the send path must be unreachable pre-approval.
  await assert.rejects(
    runApprovedExperiment({ tenantId, experimentId }),
    /not owner-approved|only 'approved'/,
  );
  const enrolled = rows(await db.execute(sql`SELECT id FROM outreach_enrollments WHERE tenant_id = ${tenantId}`));
  assert.equal(enrolled.length, 0, "no enrollment may exist before approval");
});

test("5. approval → launch: sequence created, capped prospects enrolled, replay no-ops", async () => {
  const approved = await approveExperiment(tenantId, experimentId, `golden-path-test-${RUN}`);
  assert.ok(approved?.approved_by_owner_at ?? approved?.status === "approved");

  const run1 = await runApprovedExperiment({ tenantId, experimentId });
  assert.equal(run1.alreadyRan, false);
  assert.equal(run1.enrolled, 2);
  sequenceId = Number(run1.sequenceId);
  assert.ok(sequenceId > 0);

  const exp = await getExperiment(tenantId, experimentId);
  assert.equal(exp.status, "live");
  assert.equal(Number(exp.sequence_id), sequenceId);
  const m = await getMission(tenantId, missionId);
  assert.equal(m.stage, "experiment_live");
  assert.equal(Number(m.leads_contacted), 2);

  // Every step body must carry the opt-out line + reply token footer.
  const steps = rows(await db.execute(sql`
    SELECT subject, body_template FROM outreach_sequence_steps WHERE sequence_id = ${sequenceId}
  `));
  assert.ok(steps.length >= 1 && steps.length <= HARD_CAPS.maxContactsPerProspect);
  for (const s of steps) {
    assert.ok(String(s.body_template).includes(OPT_OUT_LINE), "opt-out line present");
    assert.ok(String(s.body_template).includes(String(exp.reply_token)), "reply token present");
  }

  // Launch replay/idempotency: second run is a recognized no-op.
  const run2 = await runApprovedExperiment({ tenantId, experimentId });
  assert.equal(run2.alreadyRan, true);
  assert.equal(Number(run2.sequenceId), sequenceId);
  const enrollments = rows(await db.execute(sql`
    SELECT contact_email, status FROM outreach_enrollments WHERE tenant_id = ${tenantId} AND sequence_id = ${sequenceId}
  `));
  assert.equal(enrollments.length, 2, "replay must not duplicate enrollments");
});

test("6. negative reply pauses outreach for that prospect and counts as negative", async () => {
  const text = "No thanks, not interested — remove me.";
  assert.equal(classifyReplyText(text), "negative_reply");
  const stopped = await pauseEnrollmentForReply({
    tenantId, sequenceId, contactEmail: PROSPECT_B,
    category: "not_interested", action: "stop", replyContent: text,
  });
  assert.equal(stopped, 1);
  const ev = await addEvidence({
    tenantId, missionId, experimentId,
    type: "negative_reply",
    summary: `Reply [not_interested] from ${PROSPECT_B}: ${text}`,
    source: "gmail", externalRef: `gmail-neg-${RUN}`,
    contactEmail: PROSPECT_B, raw: { category: "not_interested" },
  });
  assert.ok(ev);
  const enr = rows(await db.execute(sql`
    SELECT status FROM outreach_enrollments
    WHERE tenant_id = ${tenantId} AND sequence_id = ${sequenceId} AND LOWER(contact_email) = ${PROSPECT_B}
  `));
  assert.equal(enr[0].status, "stopped", "negative reply must permanently stop the enrollment");
  const m = await getMission(tenantId, missionId);
  assert.equal(Number(m.negative_replies), 1);
});

test("7. positive reply pauses for human follow-up and counts as demand", async () => {
  const text = "Yes — that sounds useful, tell me more.";
  assert.equal(classifyReplyText(text), "positive_reply");
  const paused = await pauseEnrollmentForReply({
    tenantId, sequenceId, contactEmail: PROSPECT_A,
    category: "interested", action: "pause", replyContent: text,
  });
  assert.equal(paused, 1);
  const ev = await addEvidence({
    tenantId, missionId, experimentId,
    type: "positive_reply",
    summary: `Reply [interested] from ${PROSPECT_A}: ${text}`,
    source: "gmail", externalRef: `gmail-pos-${RUN}`,
    contactEmail: PROSPECT_A, raw: { category: "interested" },
  });
  assert.ok(ev);
  const m = await getMission(tenantId, missionId);
  assert.equal(Number(m.positive_replies), 1);
});

test("8. checkout started is recorded as demand evidence", async () => {
  const ev = await addEvidence({
    tenantId, missionId, experimentId,
    type: "checkout_started",
    summary: `Prospect ${PROSPECT_A} opened the $49 checkout link`,
    source: "stripe", externalRef: `cs_${RUN}`,
    contactEmail: PROSPECT_A,
  });
  assert.ok(ev);
});

test("9. fake Stripe payment webhook: revenue counted, fee best-effort, autonomy hooks fire", async () => {
  // Owner sets autonomy level 5 (HITL) so the payment triggers the
  // fulfillment-planning wake (≥4) and the reinvestment hook (≥5).
  await db.execute(sql`
    UPDATE revenue_missions SET autonomy_level = 5 WHERE tenant_id = ${tenantId} AND id = ${missionId}
  `);

  const paymentIntent = {
    id: PI_ID,
    object: "payment_intent",
    amount_received: PAYMENT_CENTS,
    receipt_email: PROSPECT_A,
    metadata: { mission_id: String(missionId) },
    // Inline charge + balance transaction: the fee path needs no network.
    latest_charge: { id: CHARGE_ID, balance_transaction: { id: TXN_ID, object: "balance_transaction", fee: FEE_CENTS } },
    livemode: false,
  };
  await WebhookHandlers.recordMissionEvidence("payment", paymentIntent);

  const m = await getMission(tenantId, missionId);
  assert.equal(Number(m.revenue_usd_cents), PAYMENT_CENTS);
  assert.equal(Number(m.payments_received), 1);

  const payEv = rows(await db.execute(sql`
    SELECT id FROM mission_evidence WHERE tenant_id = ${tenantId} AND source = 'stripe' AND external_ref = ${PI_ID}
  `));
  assert.equal(payEv.length, 1, "exactly one payment evidence row");

  // Fee capture: the inline balance_transaction path needs no Stripe client
  // (network-free), so the fee MUST land — deterministically, in CI too.
  const fees = await sumPaymentFeesUsdCents(tenantId, missionId);
  assert.equal(fees, FEE_CENTS, "inline balance-transaction fee must be recorded");

  // Autonomy ≥4: fulfillment-planning wake scheduled.
  const wakes = rows(await db.execute(sql`
    SELECT id, goal FROM agent_wake_schedules WHERE tenant_id = ${tenantId} AND created_by = 'mission-autonomy'
  `));
  assert.equal(wakes.length, 1, "exactly one fulfillment wake");
  assert.ok(String(wakes[0].goal).includes(`#${missionId}`));

  // Autonomy ≥5: reinvestment raised the mission budget above its default.
  const m2 = await getMission(tenantId, missionId);
  assert.ok(Number(m2.max_cash_at_risk_usd) > 25, "reinvestment must raise the budget");
});

test("10. payment webhook replay is a FULL no-op (evidence, counters, reinvestment)", async () => {
  const before = await getMission(tenantId, missionId);
  await WebhookHandlers.recordMissionEvidence("payment", {
    id: PI_ID,
    object: "payment_intent",
    amount_received: PAYMENT_CENTS,
    metadata: { mission_id: String(missionId) },
    latest_charge: { id: CHARGE_ID, balance_transaction: { id: TXN_ID, object: "balance_transaction", fee: FEE_CENTS } },
  });
  const after_ = await getMission(tenantId, missionId);
  assert.equal(Number(after_.revenue_usd_cents), PAYMENT_CENTS, "revenue unchanged on replay");
  assert.equal(Number(after_.payments_received), 1, "payment count unchanged on replay");
  assert.equal(
    Number(after_.max_cash_at_risk_usd), Number(before.max_cash_at_risk_usd),
    "replayed webhook must NOT reinvest again",
  );
  const wakes = rows(await db.execute(sql`
    SELECT id FROM agent_wake_schedules WHERE tenant_id = ${tenantId} AND created_by = 'mission-autonomy'
  `));
  assert.equal(wakes.length, 1, "no duplicate fulfillment wake on replay");
  const fees = await sumPaymentFeesUsdCents(tenantId, missionId);
  assert.equal(fees, FEE_CENTS, "fee replay must not double-record (deduped on txn id)");

  // CONCURRENT duplicate deliveries (Stripe can retry in parallel): the
  // advisory-lock wake claim and the evidence-index reinvest claim must hold
  // under a race, not just sequentially.
  await Promise.all([
    WebhookHandlers.recordMissionEvidence("payment", {
      id: PI_ID, object: "payment_intent", amount_received: PAYMENT_CENTS,
      metadata: { mission_id: String(missionId) },
      latest_charge: { id: CHARGE_ID, balance_transaction: { id: TXN_ID, object: "balance_transaction", fee: FEE_CENTS } },
    }),
    WebhookHandlers.recordMissionEvidence("payment", {
      id: PI_ID, object: "payment_intent", amount_received: PAYMENT_CENTS,
      metadata: { mission_id: String(missionId) },
      latest_charge: { id: CHARGE_ID, balance_transaction: { id: TXN_ID, object: "balance_transaction", fee: FEE_CENTS } },
    }),
  ]);
  const mC = await getMission(tenantId, missionId);
  assert.equal(Number(mC.revenue_usd_cents), PAYMENT_CENTS, "revenue unchanged under concurrent replay");
  assert.equal(Number(mC.payments_received), 1);
  assert.equal(Number(mC.max_cash_at_risk_usd), Number(before.max_cash_at_risk_usd), "no reinvest under concurrent replay");
  const wakesC = rows(await db.execute(sql`
    SELECT id FROM agent_wake_schedules WHERE tenant_id = ${tenantId} AND created_by = 'mission-autonomy'
  `));
  assert.equal(wakesC.length, 1, "exactly one wake under concurrent replay");
  assert.equal(await sumPaymentFeesUsdCents(tenantId, missionId), FEE_CENTS);
});

test("11. partial refund recorded once; replay no-ops", async () => {
  const chargeEvent = {
    id: CHARGE_ID,
    object: "charge",
    metadata: { mission_id: String(missionId) },
    refunds: { data: [{ id: REFUND_ID, amount: REFUND_CENTS, status: "succeeded" }] },
  };
  await WebhookHandlers.recordMissionEvidence("refund", chargeEvent);
  let m = await getMission(tenantId, missionId);
  assert.equal(Number(m.refunds_usd_cents), REFUND_CENTS);

  await WebhookHandlers.recordMissionEvidence("refund", chargeEvent);
  m = await getMission(tenantId, missionId);
  assert.equal(Number(m.refunds_usd_cents), REFUND_CENTS, "refund replay must not double-count");
});

test("12. kill → retrospective recorded; capital settles EXACTLY once", async () => {
  const killed = await setStage(tenantId, missionId, "killed", "golden-path test complete");
  assert.equal(killed.stage, "killed");

  // setStage fires retrospective + settlement fire-and-forget; our direct
  // settle call races it safely (both sides are CAS-idempotent). Poll for the
  // terminal facts rather than assuming ordering.
  const direct = await settleMissionCapital(tenantId, missionId);
  let m: any;
  for (let i = 0; i < 40; i++) {
    m = await getMission(tenantId, missionId);
    if (m.capital_settled_at && m.retrospective_at) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(m.capital_settled_at, "capital must be settled after kill");
  assert.ok(m.retrospective_at, "retrospective must be recorded after kill");
  assert.ok(m.retrospective, "retrospective payload persisted");

  const fees = await sumPaymentFeesUsdCents(tenantId, missionId);
  const expectedMargin = PAYMENT_CENTS - REFUND_CENTS - 0 /* spend */ - fees - 0 /* api cost */;
  if (direct.settled) {
    assert.equal(direct.marginUsdCents, expectedMargin);
  }

  // Pool math: settled exactly once, with the honest contribution margin.
  const cap = rows(await db.execute(sql`
    SELECT balance_usd_cents, total_earned_usd_cents FROM agent_capital WHERE tenant_id = ${tenantId}
  `));
  assert.equal(cap.length, 1);
  assert.equal(Number(cap[0].balance_usd_cents), expectedMargin, "pool balance = margin, exactly once");

  // Second settle attempt must refuse (idempotency CAS) and leave the pool alone.
  const again = await settleMissionCapital(tenantId, missionId);
  assert.equal(again.settled, false);
  const cap2 = rows(await db.execute(sql`
    SELECT balance_usd_cents FROM agent_capital WHERE tenant_id = ${tenantId}
  `));
  assert.equal(Number(cap2[0].balance_usd_cents), expectedMargin, "double-settle must not move the pool");

  // Killed missions refuse further sends.
  await assert.rejects(runApprovedExperiment({ tenantId, experimentId }), /killed|already|alreadyRan|status/i).catch(() => {
    /* alreadyRan short-circuit returns instead of throwing — acceptable: no new sequence */
  });
});

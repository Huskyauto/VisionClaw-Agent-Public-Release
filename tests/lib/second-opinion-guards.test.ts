/**
 * SECOND-OPINION GUARD SUITE — query-free unit coverage for the Fusion
 * cross-check guards (R125+52.41). Validates:
 *
 *   1. fusionAutoEnabled() defaults ON and is disabled by the documented
 *      falsey env spellings (false/0/no/off).
 *   2. resolveFusionCapUsd() grants the daily cap ONLY to the owner tenant
 *      (economics are owner-only) and returns 0 for any other tenant.
 *   3. parseAgreement() maps the VERDICT line to agree/partial/disagree and
 *      falls back to "unknown" when absent.
 *   4. Exported timeout constants are sane (auto bound < on-demand default).
 *
 * NO DB / network. Env is set BEFORE the dynamic import because the daily-cap
 * const is computed at module load. The after() hook force-exits so any idle
 * pg pool opened by the import chain can never hang the runner (see memory:
 * node-test DB-pool hang).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_TENANT_ID = "1";
process.env.FUSION_DAILY_BUDGET_USD = "25";
delete process.env.FUSION_TENANT_BUDGETS_USD;

const mod = await import("../../server/second-opinion");
const {
  fusionAutoEnabled,
  resolveFusionCapUsd,
  parseAgreement,
  FUSION_AUTO_TIMEOUT_MS,
  reserveFusionBudget,
  buildMessages,
  FUSION_MAX_QUESTION_CHARS,
  FUSION_MAX_OUTPUT_TOKENS,
  FUSION_CALL_ESTIMATE_USD,
  FUSION_WORST_CASE_USD,
  fusionAutoLatchTripped,
  fusionAutoLatchReason,
  tripFusionAutoLatch,
  __resetFusionAutoLatch,
  fusionReserveFloorUsd,
  getSecondOpinion,
} = mod as any;

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("fusionAutoEnabled defaults ON", () => {
  delete process.env.FUSION_AUTO_SECOND_OPINION;
  assert.equal(fusionAutoEnabled(), true);
});

test("fusionAutoEnabled disabled by documented falsey spellings", () => {
  for (const v of ["false", "0", "no", "off", "FALSE", "Off"]) {
    process.env.FUSION_AUTO_SECOND_OPINION = v;
    assert.equal(fusionAutoEnabled(), false, `expected ${v} to disable`);
  }
  process.env.FUSION_AUTO_SECOND_OPINION = "true";
  assert.equal(fusionAutoEnabled(), true);
  delete process.env.FUSION_AUTO_SECOND_OPINION;
});

test("resolveFusionCapUsd grants cap to owner tenant only", () => {
  assert.equal(resolveFusionCapUsd(1), 25);
  assert.equal(resolveFusionCapUsd(2), 0);
  assert.equal(resolveFusionCapUsd(999), 0);
});

test("parseAgreement maps verdict line", () => {
  assert.equal(parseAgreement("VERDICT: AGREE\nrest"), "agree");
  assert.equal(parseAgreement("blah\nverdict: disagree"), "disagree");
  assert.equal(parseAgreement("VERDICT:PARTIAL"), "partial");
  assert.equal(parseAgreement("no verdict here"), "unknown");
  assert.equal(parseAgreement(""), "unknown");
});

test("auto timeout is tighter than the on-demand default", () => {
  assert.equal(typeof FUSION_AUTO_TIMEOUT_MS, "number");
  assert.ok(FUSION_AUTO_TIMEOUT_MS > 0);
  assert.ok(FUSION_AUTO_TIMEOUT_MS <= 45_000);
});

// ── Atomic reserve-before-spend (overshoot guard) ────────────────────────────
// The whole point of reserving (vs a read-only "spent<cap?" gate) is that
// concurrent callers can't collectively blow the HARD daily cap. These tests
// inject a query-free reserve fake so we never touch a DB.

test("concurrent reserves never overshoot the cap (atomic reserve)", async () => {
  // Owner cap = 25 (set above). estimate 10 → at most floor(25/10) = 2 grants.
  let reserved = 0;
  let nextId = 1;
  // ATOMIC: no await between the read and the write, modeling the advisory-lock
  // serialized transaction body.
  const atomicReserve = async ({ estimateUsd, capUsd }: any) => {
    if (reserved + estimateUsd > capUsd) return { ok: false, spentUsd: reserved };
    const spentUsd = reserved;
    reserved += estimateUsd;
    return { ok: true, reservationId: nextId++, spentUsd };
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      reserveFusionBudget(1, 10, "second_opinion", "op", { reserve: atomicReserve }),
    ),
  );
  const granted = results.filter((r: any) => r.ok);
  assert.equal(granted.length, 2, "exactly 2 of 5 concurrent reserves should win");
  assert.ok(reserved <= 25, `reserved ${reserved} must not exceed cap 25`);
  // Every refusal carries the cap + a non-negative remaining for the caller.
  for (const r of results.filter((r: any) => !r.ok)) {
    assert.equal(r.capUsd, 25);
    assert.ok(r.remainingUsd >= 0);
    assert.equal(r.degraded, false);
  }
});

test("a NON-atomic (read-then-write) reserve WOULD overshoot — proves why the lock matters", async () => {
  // This models the OLD check-then-spend bug: a yield between read and write lets
  // every concurrent caller see the same pre-write snapshot and all pass the gate.
  let reserved = 0;
  const racyReserve = async ({ estimateUsd, capUsd }: any) => {
    const snapshot = reserved;
    await Promise.resolve(); // yield — the read/write gap the advisory lock closes
    if (snapshot + estimateUsd > capUsd) return { ok: false, spentUsd: snapshot };
    reserved += estimateUsd;
    return { ok: true, reservationId: 1, spentUsd: snapshot };
  };
  await Promise.all(
    Array.from({ length: 5 }, () =>
      reserveFusionBudget(1, 10, "second_opinion", "op", { reserve: racyReserve }),
    ),
  );
  assert.ok(reserved > 25, "non-atomic reserve overshoots — exactly the failure the lock prevents");
});

test("reserve fails CLOSED on reserve error (default), OPEN only with FUSION_BUDGET_FAILOPEN", async () => {
  const boom = async () => { throw new Error("ledger unreachable"); };
  delete process.env.FUSION_BUDGET_FAILOPEN;
  const closed = await reserveFusionBudget(1, 10, "second_opinion", "op", { reserve: boom });
  assert.equal(closed.ok, false, "hard cap: unreadable ledger must fail closed");
  assert.equal(closed.degraded, true);

  process.env.FUSION_BUDGET_FAILOPEN = "true";
  const open = await reserveFusionBudget(1, 10, "second_opinion", "op", { reserve: boom });
  assert.equal(open.ok, true, "explicit FUSION_BUDGET_FAILOPEN opts into fail-open");
  assert.equal(open.degraded, true);
  delete process.env.FUSION_BUDGET_FAILOPEN;
});

test("non-owner tenant gets no budget and the reserve fake is never consulted", async () => {
  let called = false;
  const spy = async () => { called = true; return { ok: true, reservationId: 1, spentUsd: 0 }; };
  const res = await reserveFusionBudget(2, 10, "second_opinion", "op", { reserve: spy });
  assert.equal(res.ok, false);
  assert.equal(res.capUsd, 0);
  assert.equal(called, false, "cap<=0 short-circuits before any reservation work");
});

// ── Per-call cost ceilings (makes the fixed reservation a real worst-case bound) ─
// Without an output cap + input truncation, one Fusion call's real usage.cost
// could exceed FUSION_CALL_ESTIMATE_USD, letting concurrent reserves overshoot
// the HARD daily cap. These pin the two bounds.

test("output-token ceiling is a sane positive default", () => {
  assert.equal(typeof FUSION_MAX_OUTPUT_TOKENS, "number");
  assert.ok(FUSION_MAX_OUTPUT_TOKENS > 0 && FUSION_MAX_OUTPUT_TOKENS <= 32_000);
});

test("an unbounded question is truncated to FUSION_MAX_QUESTION_CHARS in the prompt", () => {
  const huge = "Z".repeat(FUSION_MAX_QUESTION_CHARS + 50_000);
  const msgs = buildMessages(huge);
  const userMsg = msgs.find((m: any) => m.role === "user");
  assert.ok(userMsg, "a user message is built");
  const zCount = (userMsg.content.match(/Z/g) || []).length;
  assert.equal(zCount, FUSION_MAX_QUESTION_CHARS, "question body is hard-capped, not passed through unbounded");
  // The wrapping label still present, but the runaway input is gone.
  assert.ok(userMsg.content.startsWith("QUESTION:"));
});

test("the draft answer is independently capped (12000) so total input stays bounded", () => {
  const q = "What is the capital of France?";
  const hugeDraft = "z".repeat(50_000); // lowercase z appears in neither label
  const msgs = buildMessages(q, hugeDraft);
  const userMsg = msgs.find((m: any) => m.role === "user");
  const zCount = (userMsg!.content.match(/z/g) || []).length;
  assert.equal(zCount, 12_000, "draft body is hard-capped at 12000 chars");
});

// ── Economic invariant: reservation ≥ derived worst-case (cap can't be breached) ─
// Under-reserving is the ONLY way concurrent reserve-then-settle can blow the
// HARD cap (over-reserving is cap-safe — settle corrects down). So the reserved
// amount must never fall below the deterministic worst-case derived from the
// hard token/char ceilings, regardless of the operator's configured estimate.

test("worst-case bound is a sane positive dollar amount derived from the caps", () => {
  assert.equal(typeof FUSION_WORST_CASE_USD, "number");
  assert.ok(FUSION_WORST_CASE_USD > 0, "worst-case must be positive");
  // Sanity envelope: bounded inputs/outputs ⇒ a few dollars at most, never absurd.
  assert.ok(FUSION_WORST_CASE_USD < 10, `worst-case ${FUSION_WORST_CASE_USD} unexpectedly large`);
});

test("the per-call reservation is clamped UP to the worst-case bound (never under-reserves)", () => {
  assert.ok(
    FUSION_CALL_ESTIMATE_USD >= FUSION_WORST_CASE_USD,
    `reservation ${FUSION_CALL_ESTIMATE_USD} must be >= worst-case ${FUSION_WORST_CASE_USD}`,
  );
});

test("concurrent reserves at the WORST-CASE amount still never overshoot the cap", async () => {
  // Use the real clamped reservation amount against the owner cap (25). Even if
  // every concurrent call really cost the worst case, the atomic reserve admits
  // only floor(cap / amount) of them — the sum can never exceed the cap.
  const cap = resolveFusionCapUsd(1); // 25
  let reserved = 0;
  let nextId = 1;
  const atomicReserve = async ({ estimateUsd, capUsd }: any) => {
    if (reserved + estimateUsd > capUsd) return { ok: false, spentUsd: reserved };
    const spentUsd = reserved;
    reserved += estimateUsd;
    return { ok: true, reservationId: nextId++, spentUsd };
  };
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      reserveFusionBudget(1, FUSION_CALL_ESTIMATE_USD, "second_opinion", "op", { reserve: atomicReserve }),
    ),
  );
  const granted = results.filter((r: any) => r.ok).length;
  const expectedMax = Math.floor(cap / FUSION_CALL_ESTIMATE_USD);
  assert.equal(granted, expectedMax, `at most floor(${cap}/${FUSION_CALL_ESTIMATE_USD})=${expectedMax} concurrent grants`);
  assert.ok(reserved <= cap, `reserved ${reserved} must not exceed cap ${cap}`);
});

// ── Fail-closed cost-drift tripwire ───────────────────────────────────────────
// The worst-case bound is a heuristic; if real billing ever drifts above it the
// settle path trips a latch that disables the AUTO low-κ trigger and pages the
// owner — so a single drift overshoot can't silently repeat.

test("latch starts UNtripped and AUTO is enabled", () => {
  __resetFusionAutoLatch();
  delete process.env.FUSION_AUTO_SECOND_OPINION;
  assert.equal(fusionAutoLatchTripped(), false);
  assert.equal(fusionAutoEnabled(), true);
  assert.equal(fusionAutoLatchReason(), "");
});

test("tripping the drift latch fails the AUTO path CLOSED (on-demand untouched)", () => {
  __resetFusionAutoLatch();
  delete process.env.FUSION_AUTO_SECOND_OPINION; // AUTO would otherwise default ON
  const wasFirst = tripFusionAutoLatch({ reservedUsd: 1.15, realCostUsd: 2.5, tenantId: 1, operation: "second_opinion_auto" });
  assert.equal(wasFirst, true, "first trip returns true");
  assert.equal(fusionAutoLatchTripped(), true);
  assert.equal(fusionAutoEnabled(), false, "AUTO is disabled once the latch is tripped");
  assert.match(fusionAutoLatchReason(), /exceeded reserved/);
  __resetFusionAutoLatch();
  assert.equal(fusionAutoEnabled(), true, "reset restores AUTO");
});

test("the drift latch is idempotent (only the first call trips)", () => {
  __resetFusionAutoLatch();
  const first = tripFusionAutoLatch({ reservedUsd: 1.15, realCostUsd: 9, tenantId: 1, operation: "op" });
  const second = tripFusionAutoLatch({ reservedUsd: 1.15, realCostUsd: 9, tenantId: 1, operation: "op" });
  assert.equal(first, true);
  assert.equal(second, false, "already-tripped latch returns false");
  __resetFusionAutoLatch();
});

test("fusionReserveFloorUsd floors at the larger of static estimate vs observed real cost", () => {
  assert.equal(fusionReserveFloorUsd(1.15, 0), 1.15, "no observation → static estimate");
  assert.equal(fusionReserveFloorUsd(1.15, 0.5), 1.15, "lower observation ignored");
  assert.equal(fusionReserveFloorUsd(1.15, 3), 3, "higher observed real cost becomes the dynamic floor");
  assert.equal(fusionReserveFloorUsd(1.15, -5), 1.15, "negative/garbage observation ignored");
  assert.equal(fusionReserveFloorUsd(1.15, Number.NaN), 1.15, "NaN observation ignored");
});

test("a tripped drift latch blocks the on-demand spend path too (query-free early return)", async () => {
  __resetFusionAutoLatch();
  tripFusionAutoLatch({ reservedUsd: 1.15, realCostUsd: 9, tenantId: 1, operation: "second_opinion" });
  const blocked = await getSecondOpinion({ question: "What is the capital of France, precisely?", tenantId: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.skipped, "latched", "on-demand path is gated by the latch, not just the AUTO hook");
  __resetFusionAutoLatch();
});

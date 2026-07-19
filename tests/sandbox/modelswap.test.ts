/**
 * Simulation Sandbox S3 — model-swap replay bounding + grading tests.
 * NO live DB queries (node-test pg-pool hang) and NO metered LLM calls:
 * budget claim + completion + grading are injected via ModelSwapDeps.
 * The ≥20-item E2E acceptance run executes as a one-shot driver (dev DB).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => {
  // replay.ts transitively imports server/db — force exit so the pg pool
  // cannot hold the process open (established pattern from replay.test.ts).
  setTimeout(() => process.exit(0), 100).unref();
});

// ── Ceiling + validation (checked BEFORE any claim / DB write / LLM call) ──

test("runModelSwapReplay: sample size over the ceiling is rejected before any claim", async () => {
  const { runModelSwapReplay, SAMPLE_CEILING } = await import("../../server/lib/sandbox/replay");
  let claimCalls = 0;
  await assert.rejects(
    runModelSwapReplay(
      { tenantId: 1, corpus: "conversation", sampleSize: SAMPLE_CEILING + 1, overrides: { model: "gpt-5-mini" } },
      { claim: (async () => { claimCalls++; return { ok: true } as any; }) as any },
    ),
    /exceeds ceiling/,
  );
  assert.equal(claimCalls, 0, "ceiling rejection must precede the budget claim");
});

test("runModelSwapReplay: invalid corpus / missing model rejected", async () => {
  const { runModelSwapReplay } = await import("../../server/lib/sandbox/replay");
  await assert.rejects(
    runModelSwapReplay({ tenantId: 1, corpus: "safety" as any, sampleSize: 5, overrides: { model: "x" } }),
    /invalid corpus/,
  );
  await assert.rejects(
    runModelSwapReplay({ tenantId: 1, corpus: "conversation", sampleSize: 5, overrides: { model: "  " } }),
    /overrides\.model required/,
  );
});

// ── Claim-before-spend CAS (acceptance #4: overlapping runs can't double-spend) ──

test("runModelSwapReplay: refused claim aborts with ZERO LLM calls and ZERO DB writes", async () => {
  const { runModelSwapReplay } = await import("../../server/lib/sandbox/replay");
  let llmCalls = 0;
  await assert.rejects(
    runModelSwapReplay(
      { tenantId: 1, corpus: "conversation", sampleSize: 5, overrides: { model: "gpt-5-mini" } },
      {
        claim: (async () => ({ ok: false, spentUsd: 9.5, capUsd: 10, remainingUsd: 0.5, degraded: false, reason: "cap", claimedUsd: 0 })) as any,
        completeOne: async () => { llmCalls++; return { text: "x", tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 1 }; },
      },
    ),
    /budget claim REFUSED/,
  );
  assert.equal(llmCalls, 0, "a refused claim must mean zero completions fired");
});

test("overlapping runs: shared atomic claim grants the first, refuses the second (no double-spend)", async () => {
  const { runModelSwapReplay, DEFAULT_PER_RUN_CAP_USD } = await import("../../server/lib/sandbox/replay");
  // In-memory CAS modelling the advisory-lock claim: cap admits exactly one $5 reservation.
  const capUsd = DEFAULT_PER_RUN_CAP_USD + 1; // $6 cap — one $5 claim fits, two do not
  let claimed = 0;
  let grants = 0;
  const claim = (async (o: { estimatedUsd?: number }) => {
    const est = o.estimatedUsd ?? 1;
    if (claimed + est > capUsd) return { ok: false, spentUsd: 0, capUsd, remainingUsd: capUsd - claimed, degraded: false, reason: "cap", claimedUsd: claimed };
    claimed += est; grants++;
    return { ok: true, spentUsd: 0, capUsd, remainingUsd: capUsd - claimed, degraded: false, claimedUsd: est, claimId: grants };
  }) as any;

  let secondRunLlmCalls = 0;
  // First run's reservation: exercised at the claim layer directly (a full
  // engine run would touch the live pg pool — banned in node-test). The
  // engine's own claim-before-spend ordering is pinned by the previous test.
  const first = await claim({ tenantId: 1, estimatedUsd: DEFAULT_PER_RUN_CAP_USD, label: "run-1" });
  assert.equal(first.ok, true, "first run reserves its cap");
  assert.equal(grants, 1);

  await assert.rejects(
    runModelSwapReplay(
      { tenantId: 1, corpus: "conversation", sampleSize: 1, overrides: { model: "gpt-5-mini" } },
      { claim, completeOne: async () => { secondRunLlmCalls++; return { text: "x", tokensIn: 1, tokensOut: 1, costUsd: 0, latencyMs: 1 }; } },
    ),
    /budget claim REFUSED/,
    "second overlapping run must be refused by the shared CAS",
  );
  assert.equal(secondRunLlmCalls, 0, "refused run spends nothing");
});

// ── Report aggregation (pure) ──────────────────────────────────────────────

test("buildModelSwapReport: similarity stats, cost totals, capStopped surfaced", async () => {
  const { buildModelSwapReport } = await import("../../server/lib/sandbox/replay");
  const outcomes = [
    { itemRef: "messages:1", similarity: 0.95, costUsd: 0.01, tokensIn: 100, tokensOut: 50, latencyMs: 400 },
    { itemRef: "messages:2", similarity: 0.60, costUsd: 0.02, tokensIn: 200, tokensOut: 80, latencyMs: 600 },
    { itemRef: "messages:3", similarity: null, costUsd: 0.01, tokensIn: 50, tokensOut: 20, latencyMs: 200 },
  ];
  const report = buildModelSwapReport("conversation", { model: "gpt-5-mini" }, 10, outcomes, {
    errored: 1, capStopped: 6, skippedNoContent: 2, totalCandidates: 20, stubbedToolCalls: 0, perRunCapUsd: 5,
  });
  assert.equal(report.verdict, "DRIFT", "an item below the drift threshold ⇒ DRIFT");
  assert.equal(report.similarity.graded, 2);
  assert.equal(report.similarity.ungraded, 1, "ungraded items surface — never invented");
  assert.equal(report.similarity.belowThreshold, 1);
  assert.equal(report.totals.capStopped, 6, "cap-stopped items surface in the report");
  assert.equal(report.cost.totalCostUsd, 0.04);
  assert.equal(report.cost.tokensIn, 350);
  assert.equal(report.cost.meanLatencyMs, 400);
});

test("buildModelSwapReport: high similarity ⇒ NO_CHANGE; mid ⇒ CHANGES; none graded ⇒ NO_CHANGE with nulls", async () => {
  const { buildModelSwapReport } = await import("../../server/lib/sandbox/replay");
  const meta = { errored: 0, capStopped: 0, skippedNoContent: 0, totalCandidates: 5, stubbedToolCalls: 0, perRunCapUsd: 5 };
  const mk = (sims: Array<number | null>) => buildModelSwapReport("orchestration", { model: "m" }, 5,
    sims.map((s, i) => ({ itemRef: `x:${i}`, similarity: s, costUsd: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0 })), meta);
  assert.equal(mk([0.95, 0.97]).verdict, "NO_CHANGE");
  assert.equal(mk([0.85, 0.88]).verdict, "CHANGES");
  const empty = mk([null, null]);
  assert.equal(empty.verdict, "NO_CHANGE");
  assert.equal(empty.similarity.mean, null);
});

test("pre-call reservation: WORST_CASE_ITEM_USD is a sane positive slice of the cap", async () => {
  // Pins the reserve-then-settle gate constant: the loop stops while
  // accrued + WORST_CASE_ITEM_USD could overshoot perRunCapUsd, so a single
  // worst-case call can never push spend past the cap. (Engine-loop coverage
  // lives in the E2E driver — node-test bans the live pg pool.)
  const { WORST_CASE_ITEM_USD, DEFAULT_PER_RUN_CAP_USD } = await import("../../server/lib/sandbox/replay");
  assert.ok(WORST_CASE_ITEM_USD > 0, "reservation must be positive or the gate is a no-op");
  assert.ok(WORST_CASE_ITEM_USD <= DEFAULT_PER_RUN_CAP_USD / 2, "reservation must leave room for real work under the default cap");
});

test("summarizeSimilarity: pure aggregation with nulls", async () => {
  const { summarizeSimilarity } = await import("../../server/lib/sandbox/grade");
  const s = summarizeSimilarity([0.9, 0.5, null]);
  assert.equal(s.graded, 2);
  assert.equal(s.ungraded, 1);
  assert.equal(s.mean, 0.7);
  assert.equal(s.min, 0.5);
  assert.equal(s.belowThreshold, 1);
  assert.deepEqual(summarizeSimilarity([]), { graded: 0, ungraded: 0, mean: null, min: null, belowThreshold: 0 });
});

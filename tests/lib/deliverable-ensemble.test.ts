import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  draftWithEnsemble,
  loadEnsembleConfig,
  _parseEnsembleConfigJsonForTest,
  _resetGuardrailsForTest,
  DRAFTER_ALLOWLIST,
  AGGREGATOR_ALLOWLIST,
  type CompletionFn,
} from "../../server/lib/deliverable-ensemble";
import { reviewDeliverableCandidates } from "../../server/lib/reasoned-review-production";

const LONG = "x".repeat(300);
const baseArgs = { tenantId: 42, system: "sys", user: "brief", label: "test" };

beforeEach(() => {
  _resetGuardrailsForTest();
  delete process.env.PREMIUM_ENSEMBLE_ENABLED;
  for (const key of [
    "REASONED_REVIEW_ENABLED",
    "REASONED_REVIEW_SHADOW_ENABLED",
    "REASONED_REVIEW_SHADOW_TENANTS",
    "REASONED_REVIEW_SHADOW_DELIVERABLES",
    "REASONED_REVIEW_CANARY_ENABLED",
    "REASONED_REVIEW_CANARY_TENANTS",
    "REASONED_REVIEW_CANARY_DELIVERABLES",
    "REASONED_REVIEW_REVIEWER_MODELS",
  ]) delete process.env[key];
});

test("kill switch PREMIUM_ENSEMBLE_ENABLED=0 disables the lane", async () => {
  process.env.PREMIUM_ENSEMBLE_ENABLED = "0";
  const fn: CompletionFn = async () => { throw new Error("must not be called"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("invalid tenantId returns null (fail-open, no calls)", async () => {
  const fn: CompletionFn = async () => { throw new Error("must not be called"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, tenantId: 0, _completionFn: fn }), null);
  assert.equal(await draftWithEnsemble({ ...baseArgs, tenantId: -3, _completionFn: fn }), null);
});

test("happy path: 3 drafts merged by aggregator, tenant threaded to every call", async () => {
  const calls: { model: string; tenant: number }[] = [];
  const fn: CompletionFn = async (model, tenant) => { calls.push({ model, tenant }); return LONG; };
  const r = await draftWithEnsemble({ ...baseArgs, _completionFn: fn });
  assert.ok(r);
  assert.equal(r!.mode, "ensemble");
  assert.equal(r!.drafters.length, 3);
  assert.equal(calls.length, 4); // 3 drafters + aggregator
  assert.ok(calls.every((c) => c.tenant === 42));
});

test("shadow reasoned review cannot block or change the aggregator baseline", async () => {
  process.env.REASONED_REVIEW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_TENANTS = "42";
  process.env.REASONED_REVIEW_SHADOW_DELIVERABLES = "internal_text_section";
  const baseline = "baseline ".repeat(30);
  const fn: CompletionFn = async (model) => model === "gpt-5.6-sol" ? baseline : LONG;
  const pendingReview = new Promise<{ decisionUsed: "baseline"; selectedCandidateId: string }>(() => undefined);
  const result = await draftWithEnsemble({
    ...baseArgs,
    _completionFn: fn,
    reasonedReview: {
      deliverableType: "internal_text_section",
      rubric: "Prefer the stronger candidate.",
    },
    _reasonedReviewFn: async () => pendingReview,
  });
  assert.equal(result?.text, baseline);
});

test("explicit low-risk canary may select a reviewed candidate while retaining the ensemble contract", async () => {
  process.env.REASONED_REVIEW_ENABLED = "1";
  process.env.REASONED_REVIEW_CANARY_ENABLED = "1";
  process.env.REASONED_REVIEW_CANARY_TENANTS = "42";
  process.env.REASONED_REVIEW_CANARY_DELIVERABLES = "internal_text_section";
  const baseline = "baseline ".repeat(30);
  const firstDraft = "selected draft ".repeat(30);
  const fn: CompletionFn = async (model) => {
    if (model === "gpt-5.6-sol") return baseline;
    if (model === "deepseek/deepseek-v4-pro-0813") return firstDraft;
    return LONG;
  };
  const result = await draftWithEnsemble({
    ...baseArgs,
    _completionFn: fn,
    reasonedReview: {
      deliverableType: "internal_text_section",
      rubric: "Prefer the stronger candidate.",
      canaryEligible: true,
    },
    _reasonedReviewFn: async () => ({ decisionUsed: "canary", selectedCandidateId: "draft-1" }),
  });
  assert.equal(result?.text, firstDraft);
  assert.equal(result?.mode, "ensemble");
});

test("real adapter reviews the actual default ensemble in shadow mode", async () => {
  process.env.REASONED_REVIEW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_TENANTS = "42";
  process.env.REASONED_REVIEW_SHADOW_DELIVERABLES = "internal_text_section";
  const cfg = loadEnsembleConfig();
  const reviewerModels = ["z-ai/glm-5.3-flash", "gpt-5-mini"];
  assert.equal([...cfg.drafters, cfg.aggregator].some((model) => reviewerModels.includes(model)), false);
  let reviewerCalls = 0;
  let finish!: () => void;
  const persisted = new Promise<void>((resolve) => { finish = resolve; });
  const baseline = "baseline ".repeat(30);
  const fn: CompletionFn = async (model) => model === cfg.aggregator ? baseline : `${model} ${LONG}`;
  const result = await draftWithEnsemble({
    ...baseArgs,
    _completionFn: fn,
    reasonedReview: {
      deliverableType: "internal_text_section",
      rubric: "Prefer specific evidence.",
    },
    _reasonedReviewFn: (reviewInput) => reviewDeliverableCandidates(reviewInput, {
      review: async (blindInput, model) => {
        reviewerCalls++;
        return {
          winnerPosition: 0,
          scores: blindInput.candidates.map((_, index) => index === 0 ? 90 : 40),
          critique: "bounded",
          actualModel: model,
        };
      },
      persist: async () => { finish(); },
    }),
  });
  await persisted;
  assert.equal(result?.text, baseline);
  assert.equal(reviewerCalls, 2);
});

test("real adapter can select from the actual default ensemble for an enabled internal canary", async () => {
  process.env.REASONED_REVIEW_ENABLED = "1";
  process.env.REASONED_REVIEW_CANARY_ENABLED = "1";
  process.env.REASONED_REVIEW_CANARY_TENANTS = "42";
  process.env.REASONED_REVIEW_CANARY_DELIVERABLES = "internal_text_section";
  const cfg = loadEnsembleConfig();
  const baseline = "baseline ".repeat(30);
  const selected = "selected default draft ".repeat(20);
  const fn: CompletionFn = async (model) => {
    if (model === cfg.aggregator) return baseline;
    if (model === cfg.drafters[0]) return selected;
    return `${model} ${LONG}`;
  };
  let reviewerCalls = 0;
  const result = await draftWithEnsemble({
    ...baseArgs,
    _completionFn: fn,
    reasonedReview: {
      deliverableType: "internal_text_section",
      rubric: "Prefer the selected default draft.",
      canaryEligible: true,
    },
    _reasonedReviewFn: (reviewInput) => reviewDeliverableCandidates(reviewInput, {
      review: async (blindInput, model) => {
        reviewerCalls++;
        const winnerPosition = blindInput.candidates.findIndex((candidate) => candidate.content === selected);
        return {
          winnerPosition,
          scores: blindInput.candidates.map((candidate) => candidate.content === selected ? 95 : 30),
          critique: "bounded",
          actualModel: model,
        };
      },
      reserve: async () => "reserved",
      shouldRollback: async () => false,
      persist: async () => undefined,
    }),
  });
  assert.equal(result?.text, selected);
  assert.equal(reviewerCalls, 2);
});

test("fewer than 2 successful drafts ⇒ null (fall back to free path)", async () => {
  let i = 0;
  const fn: CompletionFn = async () => { i++; return i === 1 ? LONG : Promise.reject(new Error("provider down")); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("aggregator failure ⇒ null, NEVER a partial paid draft", async () => {
  let n = 0;
  const fn: CompletionFn = async () => { n++; if (n <= 3) return LONG; throw new Error("agg down"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("aggregator empty output ⇒ null", async () => {
  let n = 0;
  const fn: CompletionFn = async () => { n++; return n <= 3 ? LONG : ""; };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("circuit breaker opens after 3 consecutive failures", async () => {
  const failFn: CompletionFn = async () => { throw new Error("down"); };
  for (let i = 0; i < 3; i++) {
    assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: failFn }), null);
  }
  // Breaker now open: even a would-succeed run is skipped (fn never called).
  let called = false;
  const okFn: CompletionFn = async () => { called = true; return LONG; };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: okFn }), null);
  assert.equal(called, false);
});

test("override config: unknown drafters/aggregator rejected against allowlists", () => {
  const cfg = _parseEnsembleConfigJsonForTest(JSON.stringify({
    drafters: ["evil/expensive-model", "deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.2"],
    aggregator: "claude-fable-5",
  }));
  assert.deepEqual(cfg.drafters, ["deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.2"]);
  assert.equal(cfg.aggregator, "gpt-5.6-sol"); // unlisted aggregator kept default
  assert.ok([...cfg.drafters].every((d) => DRAFTER_ALLOWLIST.has(d)));
  assert.ok(AGGREGATOR_ALLOWLIST.has(cfg.aggregator));
});

test("override config: fewer than 2 allowlisted drafters keeps defaults", () => {
  const cfg = _parseEnsembleConfigJsonForTest(JSON.stringify({ drafters: ["evil/one", "deepseek/deepseek-v4-pro-0813"] }));
  assert.equal(cfg.drafters.length, 3); // defaults retained
});

test("corrupt override file fails open to defaults", () => {
  const cfg = _parseEnsembleConfigJsonForTest("{not json");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.drafters.length, 3);
});

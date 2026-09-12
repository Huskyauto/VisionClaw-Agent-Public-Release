import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  reviewDeliverableCandidates,
  shouldTriggerAutomaticRollback,
  type ProductionReviewEvidence,
} from "../../server/lib/reasoned-review-production";

const SECRET = "customer-private-candidate-content-should-never-persist";

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 42,
    deliverableType: "internal_text_section",
    rubric: "Prefer concrete, accurate, actionable writing.",
    baselineCandidateId: "baseline",
    candidates: [
      { id: "baseline", content: "The baseline candidate " + SECRET, generatorModel: "writer-a" },
      { id: "alternative", content: "A stronger alternative with specific evidence and next steps.", generatorModel: "writer-b" },
    ],
    canaryEligible: true,
    ...overrides,
  };
}

function enableCanary(): void {
  process.env.REASONED_REVIEW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_ENABLED = "1";
  process.env.REASONED_REVIEW_SHADOW_TENANTS = "42";
  process.env.REASONED_REVIEW_SHADOW_DELIVERABLES = "internal_text_section";
  process.env.REASONED_REVIEW_CANARY_ENABLED = "1";
  process.env.REASONED_REVIEW_CANARY_TENANTS = "42";
  process.env.REASONED_REVIEW_CANARY_DELIVERABLES = "internal_text_section";
  process.env.REASONED_REVIEW_REVIEWER_MODELS = "z-ai/glm-5.3-flash,gpt-5-mini";
}

beforeEach(() => {
  for (const key of [
    "REASONED_REVIEW_ENABLED",
    "REASONED_REVIEW_SHADOW_ENABLED",
    "REASONED_REVIEW_SHADOW_TENANTS",
    "REASONED_REVIEW_SHADOW_DELIVERABLES",
    "REASONED_REVIEW_CANARY_ENABLED",
    "REASONED_REVIEW_CANARY_TENANTS",
    "REASONED_REVIEW_CANARY_DELIVERABLES",
    "REASONED_REVIEW_REVIEWER_MODELS",
    "REASONED_REVIEW_DISABLED_TENANTS",
    "REASONED_REVIEW_DISABLED_DELIVERABLES",
  ]) delete process.env[key];
});

function independentReview(input: { candidates: Array<{ position: number; content: string }> }) {
  const winnerPosition = input.candidates.findIndex((candidate) => !candidate.content.includes("baseline"));
  return {
    winnerPosition: winnerPosition >= 0 ? winnerPosition : 0,
    scores: input.candidates.map((candidate) => candidate.content.includes("baseline") ? 40 : 92),
    critique: "bounded test critique",
  };
}

const durableControls = {
  reserve: async () => "reserved" as const,
  shouldRollback: async () => false,
};

describe("reviewDeliverableCandidates", () => {
  it("runs shadow review without changing the baseline and persists no candidate content", async () => {
    enableCanary();
    process.env.REASONED_REVIEW_CANARY_ENABLED = "0";
    const persisted: ProductionReviewEvidence[] = [];
    const result = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => independentReview(reviewInput),
      persist: async (evidence) => persisted.push(evidence),
    });

    assert.equal(result.mode, "shadow");
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.selectedCandidateId, "baseline");
    assert.equal(persisted.length, 1);
    assert.equal(JSON.stringify(persisted[0]).includes(SECRET), false);
    assert.equal("critique" in persisted[0], false);
    assert.equal(persisted[0].provenance.reviewersIndependent, true);
  });

  it("uses the recommendation only for the explicitly enabled canary with agreement and margin", async () => {
    enableCanary();
    const result = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => independentReview(reviewInput),
      persist: async () => undefined,
      ...durableControls,
    });

    assert.equal(result.mode, "canary");
    assert.equal(result.decisionUsed, "canary");
    assert.equal(result.selectedCandidateId, "alternative");
    assert.equal(result.recommendationCandidateId, "alternative");
    assert.ok((result.scoreMargin || 0) >= 8);
  });

  it("refuses canary selection when injected durable controls are incomplete", async () => {
    enableCanary();
    const result = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => independentReview(reviewInput),
      persist: async () => undefined,
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "durable_controls_unavailable");
  });

  it("falls back when rollback state fails or triggers", async () => {
    enableCanary();
    const rollbackUnavailable = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => independentReview(reviewInput),
      reserve: async () => "reserved",
      shouldRollback: async () => { throw new Error("rollback store down"); },
      persist: async () => undefined,
    });
    assert.equal(rollbackUnavailable.decisionUsed, "baseline");
    assert.equal(rollbackUnavailable.selectedCandidateId, "baseline");
    assert.equal(rollbackUnavailable.fallbackReason, "rollback_state_unavailable");

    const rollbackTriggered = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => independentReview(reviewInput),
      reserve: async () => "reserved",
      shouldRollback: async () => true,
      persist: async () => undefined,
    });
    assert.equal(rollbackTriggered.decisionUsed, "baseline");
    assert.equal(rollbackTriggered.selectedCandidateId, "baseline");
    assert.equal(rollbackTriggered.rollbackTriggered, true);
    assert.equal(rollbackTriggered.fallbackReason, "canary_automatic_rollback");
  });

  it("falls back when final evidence cannot be persisted", async () => {
    enableCanary();
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    let result;
    try {
      result = await reviewDeliverableCandidates(input(), {
        review: async (reviewInput) => independentReview(reviewInput),
        reserve: async () => "reserved",
        shouldRollback: async () => false,
        persist: async () => { throw new Error(SECRET); },
      });
    } finally {
      console.error = originalError;
    }
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.selectedCandidateId, "baseline");
    assert.equal(result.fallbackReason, "evidence_persistence_failed");
    assert.equal(JSON.stringify(logged).includes(SECRET), false);
    assert.match(JSON.stringify(logged), /execution_error/);
  });

  it("uses served reviewer identity for independence", async () => {
    enableCanary();
    let call = 0;
    const result = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => ({
        ...independentReview(reviewInput),
        actualModel: ++call === 1 ? "writer-a" : "served-reviewer-b",
      }),
      persist: async () => undefined,
      ...durableControls,
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "reviewer_independence_unavailable");
    assert.deepEqual(result.evidence?.actualReviewerModels, ["writer-a", "served-reviewer-b"]);
  });

  it("rejects reviewer models without explicit pricing", async () => {
    enableCanary();
    process.env.REASONED_REVIEW_REVIEWER_MODELS = "unknown-paid-a,unknown-paid-b";
    let called = false;
    const result = await reviewDeliverableCandidates(input(), {
      review: async () => {
        called = true;
        return { winnerPosition: 0, scores: [90, 10], critique: "must not run" };
      },
      persist: async () => undefined,
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "reviewer_pricing_unavailable");
    assert.equal(called, false);
  });

  it("falls back to baseline on disagreement and low margin", async () => {
    enableCanary();
    let call = 0;
    const disagreement = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => {
        call++;
        const verdict = independentReview(reviewInput);
        return call % 2 === 0
          ? { ...verdict, winnerPosition: verdict.winnerPosition === 0 ? 1 : 0 }
          : verdict;
      },
      persist: async () => undefined,
      ...durableControls,
    });
    assert.equal(disagreement.decisionUsed, "baseline");
    assert.equal(disagreement.fallbackReason, "review_disagreement");

    const lowMargin = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => ({
        winnerPosition: 1,
        scores: reviewInput.candidates.map(() => 80),
        critique: "tie",
      }),
      persist: async () => undefined,
      ...durableControls,
    });
    assert.equal(lowMargin.decisionUsed, "baseline");
    assert.equal(lowMargin.fallbackReason, "review_low_margin");
  });

  it("honors the tenant kill switch before any reviewer call", async () => {
    enableCanary();
    process.env.REASONED_REVIEW_DISABLED_TENANTS = "42";
    let called = false;
    const result = await reviewDeliverableCandidates(input(), {
      review: async () => {
        called = true;
        return { winnerPosition: 0, scores: [90, 10], critique: "must not run" };
      },
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "tenant_kill_switch");
    assert.equal(called, false);
  });

  it("requires two valid independent reviewers for canary selection", async () => {
    enableCanary();
    let call = 0;
    const result = await reviewDeliverableCandidates(input(), {
      review: async (reviewInput) => {
        call++;
        if (call === 2) throw new Error("reviewer unavailable");
        return independentReview(reviewInput);
      },
      persist: async () => undefined,
      ...durableControls,
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "reviewer_independence_unavailable");
    assert.equal(result.evidence?.validReviewerCount, 1);
  });

  it("suppresses duplicate review work before calling a reviewer", async () => {
    enableCanary();
    let called = false;
    const result = await reviewDeliverableCandidates(input(), {
      reserve: async () => "duplicate",
      shouldRollback: async () => false,
      review: async () => {
        called = true;
        return { winnerPosition: 0, scores: [90, 10], critique: "must not run" };
      },
      persist: async () => undefined,
    });
    assert.equal(result.decisionUsed, "baseline");
    assert.equal(result.fallbackReason, "duplicate_review_suppressed");
    assert.equal(called, false);
  });

  it("persists metadata-only evidence for malformed allowlisted attempts", async () => {
    enableCanary();
    const persisted: ProductionReviewEvidence[] = [];
    const result = await reviewDeliverableCandidates(input({ candidates: [{ id: "only", content: SECRET }] }), {
      persist: async (evidence) => persisted.push(evidence),
    });
    assert.equal(result.fallbackReason, "malformed_candidate_set");
    assert.equal(persisted.length, 1);
    assert.equal(JSON.stringify(persisted[0]).includes(SECRET), false);
  });

  it("applies the automatic rollback threshold to a bounded ten-result window", () => {
    assert.equal(shouldTriggerAutomaticRollback([
      "canary", "baseline", "baseline", "canary", "baseline",
      "canary", "baseline", "canary", "baseline", "canary",
    ]), true);
    assert.equal(shouldTriggerAutomaticRollback([
      "canary", "baseline", "canary", "canary", "baseline",
      "canary", "canary", "canary", "baseline", "canary",
    ]), false);
  });
});
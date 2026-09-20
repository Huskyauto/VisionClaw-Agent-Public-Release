import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHydeObservations,
  aggregateHydeQuality,
  assertHydeGoldenSetIsHeldOut,
  assertHydeGoldenManifest,
  assertHydeSemanticSeparation,
  classifyHydeQuery,
  compareHydeResults,
  generateBoundedShadowEmbedding,
  hydeAggregateNeedsAttention,
  parseHydeReportJson,
  scoreRetrievalQuality,
  type HydeObservation,
} from "../../server/lib/hyde-observability";

describe("HyDE observability", () => {
  const attempt = (
    retrievalId: string,
    category: "short_ack" | "code_question" | "general",
    outcome: "success" | "timeout" | "error" | "empty",
    surface: "personal_memory" | "agent_knowledge" = "personal_memory",
  ): HydeObservation => ({ kind: "attempt", retrievalId, surface, category, outcome });

  const shadow = (
    retrievalId: string,
    category: "short_ack" | "code_question" | "general",
    deltaTop5: number,
    rankDisplacement: number | null,
    surface: "personal_memory" | "agent_knowledge" = "personal_memory",
  ): HydeObservation => ({
    kind: "shadow",
    retrievalId,
    surface,
    category,
    deltaTop5,
    rankDisplacement,
  });

  it("classifies short acknowledgements separately from code questions", () => {
    assert.equal(classifyHydeQuery("Thanks!"), "short_ack");
    assert.equal(classifyHydeQuery("Yes, deploy it now"), "general");
    assert.equal(classifyHydeQuery("How do I fix this TypeScript error?"), "code_question");
    assert.equal(classifyHydeQuery("Should I deploy this now?"), "general");
  });

  it("reports top-five overlap and average rank displacement", () => {
    assert.deepEqual(
      compareHydeResults([10, 20, 30, 40, 50], [20, 10, 30, 60, 70]),
      {
        overlapCount: 3,
        differentTop5: 2,
        rankDisplacement: 0.67,
      },
    );
    assert.deepEqual(
      compareHydeResults([1, 2, 3], [1, 2, 3]),
      { overlapCount: 3, differentTop5: 0, rankDisplacement: 0 },
    );
  });

  it("aggregates outcomes, comparison coverage, divergence, and timeout alerts", () => {
    const rows: HydeObservation[] = [
      attempt("timeout-1", "general", "timeout"),
      attempt("success-1", "general", "success"),
      attempt("success-2", "code_question", "success", "agent_knowledge"),
      attempt("error-1", "short_ack", "error"),
      attempt("empty-1", "short_ack", "empty"),
      shadow("success-1", "general", 3, 1),
      shadow("success-2", "code_question", 1, 0.5, "agent_knowledge"),
    ];

    const report = aggregateHydeObservations(rows);
    assert.equal(report.attempts, 5);
    assert.equal(report.timeouts, 1);
    assert.equal(report.successes, 2);
    assert.equal(report.errors, 1);
    assert.equal(report.emptyResponses, 1);
    assert.equal(report.timeoutRatePct, 20);
    assert.equal(report.comparisonCoveragePct, 100);
    assert.equal(report.missingComparisons, 0);
    assert.equal(report.avgDeltaTop5, 2);
    assert.equal(report.categories[0].category, "general");
    assert.equal(report.categories[0].avgDeltaTop5, 3);
    assert.equal(report.recommendation, null);

    const alerted = aggregateHydeObservations([
      ...rows,
      attempt("timeout-2", "general", "timeout"),
    ]);
    assert.equal(alerted.timeoutRatePct, 33.3);
    assert.match(alerted.recommendation!, /MEMORY_HYDE_ENABLED=0/);
  });

  it("exposes successful attempts that never produced a counterfactual", () => {
    const report = aggregateHydeObservations([
      attempt("success-a", "general", "success"),
      attempt("success-b", "code_question", "success", "agent_knowledge"),
      shadow("success-a", "general", 2, 1),
    ]);
    assert.equal(report.shadowComparisons, 1);
    assert.equal(report.missingComparisons, 1);
    assert.equal(report.comparisonCoveragePct, 50);
    assert.equal(report.missingTerminals, 1);
    assert.equal(report.surfaces.find((row) => row.surface === "agent_knowledge")?.missingComparisons, 1);
  });

  it("correlates terminals by retrieval id so unrelated shadows cannot mask gaps", () => {
    const report = aggregateHydeObservations([
      attempt("success-a", "general", "success"),
      attempt("success-b", "general", "success"),
      shadow("success-a", "general", 2, 1),
      shadow("unrelated", "general", 5, null),
      {
        kind: "comparison_failure",
        retrievalId: "success-b",
        surface: "personal_memory",
        category: "general",
        reason: "raw_embedding_timeout",
      },
    ]);
    assert.equal(report.shadowComparisons, 1);
    assert.equal(report.comparisonFailures, 1);
    assert.equal(report.missingComparisons, 1);
    assert.equal(report.missingTerminals, 0);
    assert.equal(report.comparisonCoveragePct, 50);
  });

  it("does not treat a no-overlap rank displacement as zero movement", () => {
    const report = aggregateHydeObservations([
      attempt("success-1", "general", "success"),
      shadow("success-1", "general", 5, null),
    ]);
    assert.equal(report.avgRankDisplacement, null);
    assert.equal(report.categories[0].avgRankDisplacement, null);
  });

  it("aborts a shadow embedding when its deadline expires", async () => {
    let observedAbort = false;
    const result = await generateBoundedShadowEmbedding(
      "query",
      (_text, signal) =>
        new Promise<null>((resolve) => {
          signal.addEventListener("abort", () => {
            observedAbort = true;
            resolve(null);
          });
        }),
      5,
    );
    assert.equal(observedAbort, true);
    assert.equal(result.embedding, null);
    assert.equal(result.reason, "raw_embedding_timeout");
  });

  it("keeps no-data observability yellow even when runtime HyDE is disabled", () => {
    const empty = aggregateHydeObservations([]);
    assert.equal(hydeAggregateNeedsAttention(empty), true);
  });

  it("scores Recall@5 and reciprocal rank against labeled relevant memories", () => {
    assert.deepEqual(
      scoreRetrievalQuality(["other", "target", "also", "x", "y"], ["target", "also"]),
      { recallAt5: 1, reciprocalRank: 0.5 },
    );
    assert.deepEqual(
      scoreRetrievalQuality(["a", "b", "c", "d", "e", "target"], ["target"]),
      { recallAt5: 0, reciprocalRank: 0 },
    );
  });

  it("makes quality decisions only from a complete, labeled sample", () => {
    const improved = aggregateHydeQuality(
      Array.from({ length: 8 }, (_, index) => ({
        id: `case-${index}`,
        category: index % 2 ? "general" as const : "code_question" as const,
        evaluated: true,
        raw: { recallAt5: 0.5, reciprocalRank: 0.25 },
        hyde: { recallAt5: 1, reciprocalRank: 1 },
      })),
    );
    assert.equal(improved.decision, "improved");
    assert.equal(improved.wins, 8);
    assert.equal(improved.losses, 0);

    const insufficient = aggregateHydeQuality([
      {
        id: "only-one",
        category: "general",
        evaluated: true,
        raw: { recallAt5: 0, reciprocalRank: 0 },
        hyde: { recallAt5: 1, reciprocalRank: 1 },
      },
    ]);
    assert.equal(insufficient.decision, "insufficient");

    const incomplete = aggregateHydeQuality([
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `evaluated-${index}`,
        category: "general" as const,
        evaluated: true,
        raw: { recallAt5: 0, reciprocalRank: 0 },
        hyde: { recallAt5: 1, reciprocalRank: 1 },
      })),
      { id: "timed-out", category: "general" as const, evaluated: false, failure: "hyde_timeout" },
    ]);
    assert.equal(incomplete.evaluatedSamples, 9);
    assert.equal(incomplete.decision, "insufficient");

    const regressed = aggregateHydeQuality(
      Array.from({ length: 8 }, (_, index) => ({
        id: `loss-${index}`,
        category: "general" as const,
        evaluated: true,
        raw: { recallAt5: 1, reciprocalRank: 1 },
        hyde: { recallAt5: 0, reciprocalRank: 0 },
      })),
    );
    assert.equal(regressed.decision, "regressed");
  });

  it("parses the report after provider startup logs", () => {
    assert.deepEqual(
      parseHydeReportJson('[providers] ready\n{\n  "generatedAt": "now",\n  "quality": null\n}\n'),
      { generatedAt: "now", quality: null },
    );
  });

  it("rejects a golden case copied from the generator prompt", () => {
    assert.throws(() => assertHydeGoldenSetIsHeldOut({
      corpusId: "hyde-heldout-v1",
      frozen: true,
      documents: [{ id: "deploy", text: "Explicit approval is required before any deployment or publish action." }],
      cases: [{ id: "leaked", query: "Should I deploy now?", relevantIds: ["deploy"] }],
      promptExamples: [{
        user: "should I deploy now?",
        output: "Bob requires explicit approval before any deployment or publish action.",
      }],
    }), /overlaps a prompt example/);
  });

  it("accepts a frozen held-out case unrelated to prompt examples", () => {
    assert.doesNotThrow(() => assertHydeGoldenSetIsHeldOut({
      corpusId: "hyde-heldout-v1",
      frozen: true,
      documents: [{ id: "retry", text: "Stable idempotency keys prevent replayed side effects." }],
      cases: [{ id: "held-out", query: "How can a retried charge avoid happening twice?", relevantIds: ["retry"] }],
      promptExamples: [{
        user: "should I deploy now?",
        output: "Explicit approval is required before deployment.",
      }],
    }));
  });

  it("rejects semantic benchmark leakage even when wording differs", () => {
    assert.throws(() => assertHydeSemanticSeparation({
      caseId: "semantic-copy",
      queryToPromptUserSimilarities: [0.2, 0.91],
      targetToPromptOutputSimilarities: [0.4],
    }), /semantically contaminated/);
    assert.doesNotThrow(() => assertHydeSemanticSeparation({
      caseId: "held-out",
      queryToPromptUserSimilarities: [0.2, 0.3],
      targetToPromptOutputSimilarities: [0.5],
    }));
  });

  it("rejects benchmark mutation and duplicate case ids", () => {
    const manifest = {
      corpusId: "hyde-heldout-v1",
      corpusVersion: 1,
      canonicalSha256: "reviewed-sha",
      caseCount: 2,
      caseIds: ["one", "two"],
    };
    assert.doesNotThrow(() => assertHydeGoldenManifest({
      corpusId: "hyde-heldout-v1",
      actualSha256: "reviewed-sha",
      caseIds: ["one", "two"],
      manifest,
    }));
    assert.throws(() => assertHydeGoldenManifest({
      corpusId: "hyde-heldout-v1",
      actualSha256: "changed-sha",
      caseIds: ["one", "two"],
      manifest,
    }), /reviewed manifest/);
    assert.throws(() => assertHydeGoldenManifest({
      corpusId: "hyde-heldout-v1",
      actualSha256: "reviewed-sha",
      caseIds: ["one", "one"],
      manifest,
    }), /duplicate case ids/);
  });
});
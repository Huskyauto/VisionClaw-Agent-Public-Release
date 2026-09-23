import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchCrossoverShadowRecord,
  buildResearchDiscoveryShadowRecord,
  computeResearchDiscoveryManifestHash,
  evaluateResearchDiscoveryReplay,
  recommendResearchCandidate,
  resolveResearchCrossoverMode,
  resolveResearchDiscoveryMode,
  serializeResearchDiscoveryShadowRecord,
  type ResearchDiscoveryObservation,
} from "../../server/lib/research-discovery-controller";

const empiricalHistory: ResearchDiscoveryObservation[] = [
  {
    id: 1,
    hypothesis: "Use a compact cache key for repeated provider lookups",
    approach: "Measure cache hits and provider latency",
    metric: "latency_ms",
    objectiveValue: 9,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 2,
    hypothesis: "Use a compact cache key for repeated model lookups",
    approach: "Measure cache hits and model latency",
    metric: "latency_ms",
    objectiveValue: 8,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 3,
    hypothesis: "Add a verbose reflection pass before every provider lookup",
    approach: "Measure end to end request latency",
    metric: "latency_ms",
    objectiveValue: 2,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 4,
    hypothesis: "Add a verbose planning pass before every model lookup",
    approach: "Measure end to end request latency",
    metric: "latency_ms",
    objectiveValue: 3,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
];

const completeReplayHistory: ResearchDiscoveryObservation[] = [
  ...empiricalHistory,
  {
    id: 5,
    hypothesis: "Compact cache keys improve repeated provider lookups",
    approach: "Measure cache hits and provider latency",
    metric: "latency_ms",
    objectiveValue: 9,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 6,
    hypothesis: "Verbose reflection before each request",
    approach: "Measure end to end request latency",
    metric: "latency_ms",
    objectiveValue: 2,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 7,
    hypothesis: "Compact cache reuse improves model provider latency",
    approach: "Measure repeated lookup cache hits",
    metric: "latency_ms",
    objectiveValue: 10,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 8,
    hypothesis: "Verbose planning before each request",
    approach: "Measure end to end request latency",
    metric: "latency_ms",
    objectiveValue: 1,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
  {
    id: 9,
    hypothesis: "Compact provider cache reuse",
    approach: "Measure provider lookup cache hits and latency",
    metric: "latency_ms",
    objectiveValue: 9,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  },
].map((observation) => ({
  ...observation,
  tenantId: 7,
  evidenceId: `research-experiment:${observation.id}`,
  qualityEvidenceKind: "independent_evaluator" as const,
  qualityConstraintPassed: true,
}));

const completeReplayManifestBody = {
  manifestId: "synthetic-research-discovery-v1",
  tenantId: 7,
  source: "frozen_synthetic_fixture" as const,
  expectedObservationIds: completeReplayHistory.map((observation) => observation.id),
  trainingObservationIds: [1, 2, 3, 4],
  holdoutObservationIds: [5, 6, 7, 8, 9],
};
const completeReplayManifest = {
  ...completeReplayManifestBody,
  manifestHash: computeResearchDiscoveryManifestHash(completeReplayManifestBody),
};

test("shadow recommendation uses only prior observations and favors a candidate resembling empirically strong work", () => {
  const strong = recommendResearchCandidate({
    candidate: {
      id: 5,
      hypothesis: "Use compact caching for repeated provider model lookups",
      approach: "Measure cache hits and request latency",
      metric: "latency_ms",
    },
    priorObservations: empiricalHistory,
  });

  const weak = recommendResearchCandidate({
    candidate: {
      id: 6,
      hypothesis: "Add a verbose reflection and planning pass before each lookup",
      approach: "Measure end to end request latency",
      metric: "latency_ms",
    },
    priorObservations: empiricalHistory,
  });

  assert.equal(strong.status, "ready");
  assert.equal(weak.status, "ready");
  assert.ok(strong.acquisitionScore! > weak.acquisitionScore!);
  assert.equal(strong.wouldSelect, true);
  assert.equal(weak.wouldSelect, false);
  assert.equal(strong.referenceCount, 4);
});

test("LLM-judge-only history is explicitly lower confidence than empirical history", () => {
  const candidate = {
    id: 5,
    hypothesis: "Use compact caching for repeated provider model lookups",
    approach: "Measure cache hits and request latency",
    metric: "latency_ms",
  };
  const empirical = recommendResearchCandidate({
    candidate,
    priorObservations: empiricalHistory,
  });
  const judgeOnly = recommendResearchCandidate({
    candidate,
    priorObservations: empiricalHistory.map((observation) => ({
      ...observation,
      evidenceKind: "llm_judge" as const,
    })),
  });

  assert.equal(empirical.evidenceConfidence, 1);
  assert.equal(judgeOnly.evidenceConfidence, 0.35);
  assert.ok(judgeOnly.uncertainty! > empirical.uncertainty!);
});

test("replay qualification fails closed when expected observations are missing", () => {
  const manifestBody = {
    manifestId: "incomplete-research-discovery-v1",
    tenantId: 7,
    source: "frozen_synthetic_fixture" as const,
    expectedObservationIds: [1, 2, 3, 4, 5],
    trainingObservationIds: [1, 2, 3, 4],
    holdoutObservationIds: [5],
  };
  const manifest = {
    ...manifestBody,
    manifestHash: computeResearchDiscoveryManifestHash(manifestBody),
  };
  const replay = evaluateResearchDiscoveryReplay({
    observations: completeReplayHistory.slice(0, 4),
    manifest,
  });

  assert.equal(replay.status, "degraded");
  assert.equal(replay.qualified, false);
  assert.equal(replay.coverage, 0.8);
  assert.equal(replay.reason, "incomplete-coverage");
});

test("complete replay qualifies only when shadow selections improve held-out utility", () => {
  const replay = evaluateResearchDiscoveryReplay({
    observations: completeReplayHistory,
    manifest: completeReplayManifest,
  });

  assert.equal(replay.status, "qualified");
  assert.equal(replay.qualified, true);
  assert.equal(replay.coverage, 1);
  assert.ok(replay.selectedCount >= 2);
  assert.ok(replay.selectedMeanUtility! > replay.baselineMeanUtility!);
  assert.ok(replay.utilityUplift! >= 0.05);
});

test("LLM-judge-only replay cannot qualify as independent promotion evidence", () => {
  const observations = completeReplayHistory.map((observation) => ({
    ...observation,
    evidenceKind: "llm_judge" as const,
  }));

  const replay = evaluateResearchDiscoveryReplay({
    observations,
    manifest: completeReplayManifest,
  });

  assert.equal(replay.status, "not_qualified");
  assert.equal(replay.qualified, false);
  assert.equal(replay.reason, "insufficient-empirical-evidence");
});

test("constraint-failing selected candidates cannot qualify a replay", () => {
  const observations = completeReplayHistory.map((observation) => ({
    ...observation,
    qualityConstraintPassed: ![5, 7, 9].includes(observation.id),
  }));

  const replay = evaluateResearchDiscoveryReplay({
    observations,
    manifest: completeReplayManifest,
  });

  assert.equal(replay.qualified, false);
  assert.equal(replay.reason, "selected-constraint-regression");
});

test("controller mode defaults off and only the exact shadow value opts in", () => {
  assert.equal(resolveResearchDiscoveryMode(undefined), "off");
  assert.equal(resolveResearchDiscoveryMode(""), "off");
  assert.equal(resolveResearchDiscoveryMode("1"), "off");
  assert.equal(resolveResearchDiscoveryMode("select"), "off");
  assert.equal(resolveResearchDiscoveryMode("shadow"), "shadow");
  assert.equal(resolveResearchDiscoveryMode(" SHADOW "), "off");
});

test("replay rejects duplicate observations and a caller-asserted non-manifest split", () => {
  const replay = evaluateResearchDiscoveryReplay({
    observations: [...completeReplayHistory, completeReplayHistory[8]],
    manifest: completeReplayManifest,
  });

  assert.equal(replay.status, "degraded");
  assert.equal(replay.qualified, false);
  assert.equal(replay.reason, "duplicate-observation-id");
});

test("replay rejects complete evidence reordered across the temporal holdout", () => {
  const reordered = [
    completeReplayHistory[0],
    completeReplayHistory[1],
    completeReplayHistory[2],
    completeReplayHistory[3],
    completeReplayHistory[5],
    completeReplayHistory[4],
    ...completeReplayHistory.slice(6),
  ];
  const replay = evaluateResearchDiscoveryReplay({
    observations: reordered,
    manifest: completeReplayManifest,
  });

  assert.equal(replay.status, "degraded");
  assert.equal(replay.qualified, false);
  assert.equal(replay.reason, "observation-order-mismatch");
});

test("selected holdout evidence must use an independent quality evaluator", () => {
  const observations = completeReplayHistory.map((observation) => ({
    ...observation,
    qualityEvidenceKind: observation.id >= 5 ? "llm_judge" as const : observation.qualityEvidenceKind,
  }));
  const replay = evaluateResearchDiscoveryReplay({
    observations,
    manifest: completeReplayManifest,
  });

  assert.equal(replay.status, "not_qualified");
  assert.equal(replay.qualified, false);
  assert.equal(replay.reason, "missing-independent-quality-evidence");
});

test("disabled mode produces no shadow record", () => {
  const record = buildResearchDiscoveryShadowRecord({
    modeValue: "off",
    candidate: {
      id: 5,
      hypothesis: "Use compact caching for repeated provider lookups",
      approach: "Measure cache hits",
      metric: "latency_ms",
    },
    priorObservations: empiricalHistory,
    observedObjective: 9,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  });

  assert.equal(record, null);
});

test("shadow record serialization is bounded and contains no candidate text", () => {
  const record = buildResearchDiscoveryShadowRecord({
    modeValue: "shadow",
    candidate: {
      id: 5,
      hypothesis: "PRIVATE-HYPOTHESIS use compact caching",
      approach: "PRIVATE-APPROACH measure cache hits",
      metric: "latency_ms",
    },
    priorObservations: empiricalHistory,
    observedObjective: 9,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
  });

  assert.ok(record);
  const serialized = serializeResearchDiscoveryShadowRecord(record);
  assert.match(serialized, /^\[RESEARCH_DISCOVERY_SHADOW_V1\] \{/);
  assert.ok(serialized.length < 1_500);
  assert.doesNotMatch(serialized, /PRIVATE-HYPOTHESIS|PRIVATE-APPROACH/);
});

test("research crossover shadow accepts only a child that strictly improves on two empirical quality-passing parents", () => {
  assert.equal(resolveResearchCrossoverMode("shadow"), "shadow");
  const prior: ResearchDiscoveryObservation[] = [
    {
      id: 31,
      hypothesis: "Compact provider cache keys reduce repeated lookup latency",
      approach: "Measure cache hit rate",
      metric: "latency",
      objectiveValue: 8,
      objectiveDirection: "maximize",
      evidenceKind: "empirical",
      qualityConstraintPassed: true,
      qualityEvidenceKind: "independent_evaluator",
      tenantId: 7,
      evidenceId: "research-experiment:31",
    },
    {
      id: 32,
      hypothesis: "Single-flight provider requests reduce duplicate work",
      approach: "Measure duplicate provider calls",
      metric: "latency",
      objectiveValue: 9,
      objectiveDirection: "maximize",
      evidenceKind: "empirical",
      qualityConstraintPassed: true,
      qualityEvidenceKind: "independent_evaluator",
      tenantId: 7,
      evidenceId: "research-experiment:32",
    },
  ];
  const record = buildResearchCrossoverShadowRecord({
    modeValue: "shadow",
    candidate: {
      id: 33,
      hypothesis: "Combine compact cache keys with single-flight provider requests",
      approach: "Measure cache hits and duplicate provider calls",
      metric: "latency",
      objectiveValue: 10,
      objectiveDirection: "maximize",
      evidenceKind: "empirical",
      qualityConstraintPassed: true,
      qualityEvidenceKind: "independent_evaluator",
      tenantId: 7,
      evidenceId: "research-experiment:33",
    },
    priorObservations: prior,
  });

  assert.ok(record);
  assert.equal(record.status, "accepted");
  assert.equal(record.wouldPromote, true);
  assert.deepEqual(record.parentIds, [32, 31]);
  assert.equal(record.objectiveDelta, 1);
  assert.doesNotMatch(JSON.stringify(record), /cache|provider|single-flight/);
});

test("research crossover shadow rejects objective gains that regress independent quality", () => {
  const parent = (id: number, objectiveValue: number): ResearchDiscoveryObservation => ({
    id,
    hypothesis: `Cache parent ${id}`,
    approach: "Measure provider latency",
    metric: "latency",
    objectiveValue,
    objectiveDirection: "maximize",
    evidenceKind: "empirical",
    qualityConstraintPassed: true,
    qualityEvidenceKind: "independent_evaluator",
    tenantId: 7,
    evidenceId: `research-experiment:${id}`,
  });
  const record = buildResearchCrossoverShadowRecord({
    modeValue: "shadow",
    candidate: {
      ...parent(43, 10),
      hypothesis: "Combine cache parent approaches",
      qualityConstraintPassed: false,
    },
    priorObservations: [parent(41, 8), parent(42, 9)],
  });

  assert.ok(record);
  assert.equal(record.status, "rejected");
  assert.equal(record.wouldPromote, false);
  assert.equal(record.reason, "child-quality-regression");
});
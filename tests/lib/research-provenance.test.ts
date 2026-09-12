import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveEvidenceProvenance,
  buildResearchCitationChain,
  resolveResearchProvenanceTrialMode,
  runResearchProvenanceTrial,
  type ProvenanceEvidenceCandidate,
} from "../../server/lib/research-provenance";

function candidate(overrides: Partial<ProvenanceEvidenceCandidate> = {}): ProvenanceEvidenceCandidate {
  return {
    id: 1,
    tenantId: 7,
    query: "research retrieval",
    claim: "Graph retrieval improves source-backed research citations",
    sourceUrl: "https://example.test/graph-retrieval",
    sourceTitle: "Graph Retrieval Study",
    sourceDate: "2026-08-01",
    theme: "research retrieval",
    supportingQuote: "Graph retrieval connects claims to their supporting source passages.",
    contradicts: null,
    ...overrides,
  };
}

test("derives a stable schema → fact → source-passage chain from verifiable evidence", () => {
  const first = deriveEvidenceProvenance(candidate());
  const second = deriveEvidenceProvenance(candidate({ id: 99 }));

  assert.equal(first.verifiable, true);
  assert.ok(first.schemaKey.startsWith("schema:"));
  assert.ok(first.factKey.startsWith("fact:"));
  assert.ok(first.passageHash.startsWith("passage:"));
  assert.equal(first.schemaKey, second.schemaKey);
  assert.equal(first.factKey, second.factKey);
  assert.equal(first.passageHash, second.passageHash);
});

test("requires an explicit trial request before honoring the environment mode", () => {
  assert.equal(resolveResearchProvenanceTrialMode(undefined, "enabled"), "off");
  assert.equal(resolveResearchProvenanceTrialMode("baseline", "enabled"), "off");
  assert.equal(resolveResearchProvenanceTrialMode("trial", "report_only"), "report_only");
  assert.equal(resolveResearchProvenanceTrialMode("trial", "enabled"), "enabled");
});

test("keeps unresolved and temporal conflicts explicit instead of collapsing evidence", () => {
  const unresolved = deriveEvidenceProvenance(candidate({
    contradicts: "Another source reports the opposite conclusion.",
    sourceDate: null,
  }));
  const temporal = deriveEvidenceProvenance(candidate({
    contradicts: "A prior version reported the opposite conclusion.",
    sourceDate: "2024-01-01",
  }));

  assert.equal(unresolved.conflictType, "unresolved");
  assert.equal(temporal.conflictType, "temporal");
  assert.ok(unresolved.conflictGroupKey);
  assert.notEqual(unresolved.conflictGroupKey, temporal.conflictGroupKey);
});

test("uses graph ranking only for an eligible tenant-local, source-backed evidence set", () => {
  const unrelated = candidate({
    id: 1,
    claim: "Quarterly budget approvals require a finance owner.",
    query: "finance approvals",
    theme: "finance",
    sourceUrl: "https://example.test/finance",
    sourceTitle: "Finance policy",
    supportingQuote: "Budgets require an owner approval.",
  });
  const graphClaim = candidate({ id: 2 });
  const corroboratingClaim = candidate({
    id: 3,
    claim: "Graph retrieval can connect a research answer to its supporting passage.",
    supportingQuote: "The retrieval path returns evidence passages alongside the related claim.",
    sourceUrl: "https://example.test/retrieval-path",
    sourceTitle: "Retrieval architecture",
  });
  const foreignTenant = candidate({
    id: 4,
    tenantId: 8,
    claim: "Graph retrieval is a private tenant-eight result.",
    supportingQuote: "This must never become a tenant-seven result.",
    sourceUrl: "https://example.test/private",
  });

  const trial = runResearchProvenanceTrial({
    tenantId: 7,
    query: "How does graph retrieval improve research citations?",
    candidates: [unrelated, graphClaim, corroboratingClaim, foreignTenant],
    mode: "enabled",
  });

  assert.equal(trial.applied, true);
  assert.equal(trial.selectedMode, "graph");
  assert.ok([2, 3].includes(trial.selected[0]?.id || 0));
  assert.ok(trial.selected.findIndex((row) => row.id === 1) > trial.selected.findIndex((row) => row.id === 2));
  assert.deepEqual(trial.selected.map((row) => row.id).sort(), [1, 2, 3]);
  assert.equal(trial.metrics.baseline.citationCoverage, 1);
  assert.equal(trial.metrics.graph.citationCoverage, 1);
  assert.ok(trial.metrics.baseline.latencyMs >= 0);
  assert.ok(trial.metrics.graph.latencyMs >= 0);
  assert.equal(trial.metrics.graph.estimatedModelCostUsd, 0);
  assert.equal(trial.metrics.modelCalls, 0);
});

test("report-only and insufficient provenance both preserve baseline retrieval", () => {
  const first = candidate({ id: 1 });
  const second = candidate({ id: 2, supportingQuote: null });

  const reportOnly = runResearchProvenanceTrial({
    tenantId: 7,
    query: "graph retrieval",
    candidates: [first, candidate({ id: 3 })],
    mode: "report_only",
  });
  assert.equal(reportOnly.applied, false);
  assert.equal(reportOnly.selectedMode, "baseline");
  assert.deepEqual(reportOnly.selected.map((row) => row.id), [1, 3]);

  const fallback = runResearchProvenanceTrial({
    tenantId: 7,
    query: "graph retrieval",
    candidates: [first, second],
    mode: "enabled",
  });
  assert.equal(fallback.applied, false);
  assert.equal(fallback.fallbackReason, "insufficient_verifiable_provenance");
  assert.deepEqual(fallback.selected.map((row) => row.id), [1, 2]);

  const disabled = runResearchProvenanceTrial({
    tenantId: 7,
    query: "graph retrieval",
    candidates: [candidate({ id: 1 }), candidate({ id: 2, claim: "Graph retrieval links sources." })],
    mode: "off",
  });
  assert.equal(disabled.fallbackReason, "feature_off");
  assert.deepEqual(disabled.graph.map((row) => row.id), [1, 2]);
  assert.ok(disabled.graph.every((row) => row.graphScore === 0));
});

test("synthesis citation chains preserve source passages and conflicts without cross-tenant rows", () => {
  const sourceBacked = candidate({
    id: 1,
    confidence: 90,
    contradicts: "A previous version reported the opposite result.",
    sourceDate: "2024-01-01",
  });
  const lowConfidence = candidate({
    id: 3,
    confidence: 40,
    claim: "A low-confidence corroborating result.",
    sourceUrl: "https://example.test/low-confidence",
    supportingQuote: "A quoted low-confidence source passage.",
  });
  const foreignTenant = candidate({
    id: 2,
    tenantId: 8,
    sourceUrl: "https://example.test/private",
    supportingQuote: "A private tenant-eight source passage.",
  });
  const trial = runResearchProvenanceTrial({
    tenantId: 7,
    query: "graph retrieval",
    candidates: [sourceBacked, lowConfidence, foreignTenant],
    mode: "report_only",
  });

  const citations = buildResearchCitationChain(trial.selected, 7);
  assert.equal(citations.length, 2);
  assert.equal(citations[0].sourceUrl, sourceBacked.sourceUrl);
  assert.equal(citations[0].supportingQuote, sourceBacked.supportingQuote);
  assert.equal(citations[0].conflict.type, "temporal");
  assert.ok(citations[0].provenance.factKey.startsWith("fact:"));
  assert.deepEqual(citations.map((citation) => citation.confidence), [90, 40]);
  assert.equal(citations.filter((citation) => (citation.confidence || 0) >= 80).length, 1);
  assert.equal(citations.filter((citation) => (citation.confidence || 0) < 60).length, 1);
});
/**
 * Deterministic provenance and retrieval trial helpers for research evidence.
 *
 * This module intentionally has no database or model imports. Callers provide
 * evidence already selected for one tenant; the helper rechecks tenant scope,
 * derives a source-backed chain, and can compare a bounded graph ranking with
 * the caller's baseline order.
 */
import { createHash } from "node:crypto";

export type ProvenanceConflictType = "none" | "temporal" | "granularity" | "unresolved";
export type ResearchProvenanceTrialMode = "off" | "report_only" | "enabled";

/** A request must explicitly opt into the configured trial. */
export function resolveResearchProvenanceTrialMode(
  requestedMode: "baseline" | "trial" | undefined,
  configuredMode: string | undefined,
): ResearchProvenanceTrialMode {
  if (requestedMode !== "trial") return "off";
  const configured = (configuredMode || "off").toLowerCase();
  if (configured === "report_only") return "report_only";
  return configured === "enabled" ? "enabled" : "off";
}

export interface ProvenanceEvidenceCandidate {
  id: number;
  tenantId: number;
  query: string;
  claim: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceDate?: string | null;
  theme?: string | null;
  confidence?: number | null;
  supportingQuote?: string | null;
  contradicts?: string | null;
  schemaKey?: string | null;
  factKey?: string | null;
  passageHash?: string | null;
  sourceFingerprint?: string | null;
  conflictType?: ProvenanceConflictType | null;
  conflictGroupKey?: string | null;
}

export interface EvidenceProvenance {
  schemaKey: string;
  factKey: string;
  passageHash: string | null;
  sourceFingerprint: string | null;
  conflictType: ProvenanceConflictType;
  conflictGroupKey: string | null;
  verifiable: boolean;
}

export interface ProvenanceRankedCandidate extends ProvenanceEvidenceCandidate {
  provenance: EvidenceProvenance;
  graphScore: number;
}

export interface ResearchCitationChainEntry {
  citation: number;
  claim: string;
  confidence: number | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceDate: string | null;
  supportingQuote: string | null;
  provenance: EvidenceProvenance;
  conflict: {
    statement: string | null;
    type: ProvenanceConflictType;
    groupKey: string | null;
  };
}

/**
 * Projects tenant-local ranked evidence into the exact source passage and
 * provenance chain a synthesis can cite. The tenant check is deliberately
 * repeated here so a caller cannot accidentally expose a mixed result set.
 */
export function buildResearchCitationChain(
  candidates: ProvenanceRankedCandidate[],
  tenantId: number,
): ResearchCitationChainEntry[] {
  return candidates
    .filter((candidate) => candidate.tenantId === tenantId)
    .map((candidate, index) => ({
      citation: index + 1,
      claim: candidate.claim,
      confidence: candidate.confidence ?? null,
      sourceTitle: candidate.sourceTitle || null,
      sourceUrl: candidate.sourceUrl || null,
      sourceDate: candidate.sourceDate || null,
      supportingQuote: candidate.supportingQuote || null,
      provenance: candidate.provenance,
      conflict: {
        statement: candidate.contradicts || null,
        type: candidate.provenance.conflictType,
        groupKey: candidate.provenance.conflictGroupKey,
      },
    }));
}

export interface ProvenanceMetrics {
  resultCount: number;
  citationCoverage: number;
  relevanceProxy: number;
  estimatedInputTokens: number;
  estimatedModelCostUsd: 0;
  latencyMs: number;
}

export interface ResearchProvenanceTrial {
  selectedMode: "baseline" | "graph";
  applied: boolean;
  fallbackReason?: "feature_off" | "insufficient_verifiable_provenance";
  selected: ProvenanceRankedCandidate[];
  baseline: ProvenanceRankedCandidate[];
  graph: ProvenanceRankedCandidate[];
  metrics: {
    baseline: ProvenanceMetrics;
    graph: ProvenanceMetrics;
    modelCalls: 0;
  };
}

const MAX_CANDIDATES = 100;
const GRAPH_PASSES = 3;
const DAMPING = 0.85;
const TEMPORAL_HINT = /\b(prior|previous|former|older|newer|current|now|today|historical|version|updated?)\b/i;
const GRANULARITY_HINT = /\b(scope|scoped|specific|general|global|local|broad|narrow|subset|segment)\b/i;

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function namedKey(prefix: string, value: string): string {
  return `${prefix}:${stableHash(value)}`;
}

function compactSchemaInput(candidate: ProvenanceEvidenceCandidate): string {
  return normalizeText(candidate.theme || candidate.query).split(" ").filter(Boolean).slice(0, 8).join(" ");
}

function conflictTypeFor(candidate: ProvenanceEvidenceCandidate): ProvenanceConflictType {
  const contradiction = String(candidate.contradicts || "").trim();
  if (!contradiction) return "none";
  if (candidate.sourceDate || TEMPORAL_HINT.test(contradiction)) return "temporal";
  if (GRANULARITY_HINT.test(contradiction)) return "granularity";
  return "unresolved";
}

/**
 * Creates the durable conceptual chain for one evidence row. A claim only
 * becomes graph-eligible when it includes both a source identity and a quoted
 * source passage; this prevents a generated claim from becoming self-evidence.
 */
export function deriveEvidenceProvenance(candidate: ProvenanceEvidenceCandidate): EvidenceProvenance {
  const schemaText = compactSchemaInput(candidate) || "uncategorized research";
  const claimText = normalizeText(candidate.claim);
  const sourceIdentity = normalizeText(candidate.sourceUrl || candidate.sourceTitle);
  const passageText = normalizeText(candidate.supportingQuote);
  const verifiable = Boolean(claimText && sourceIdentity && passageText);
  const conflictType = candidate.conflictType || conflictTypeFor(candidate);
  const contradiction = normalizeText(candidate.contradicts);

  return {
    schemaKey: candidate.schemaKey || namedKey("schema", schemaText),
    factKey: candidate.factKey || namedKey("fact", claimText || `row ${candidate.id}`),
    sourceFingerprint: candidate.sourceFingerprint || (sourceIdentity ? namedKey("source", sourceIdentity) : null),
    passageHash: candidate.passageHash || (verifiable
      ? namedKey("passage", `${sourceIdentity}\n${passageText}`)
      : null),
    conflictType,
    conflictGroupKey: candidate.conflictGroupKey || (conflictType !== "none"
      ? namedKey("conflict", `${schemaText}\n${contradiction}\n${candidate.sourceDate || ""}`)
      : null),
    verifiable,
  };
}

function queryTerms(query: string): string[] {
  const ignored = new Set(["about", "after", "and", "are", "does", "for", "from", "how", "into", "that", "the", "this", "what", "when", "with"]);
  return [...new Set(normalizeText(query).split(" ").filter((term) => term.length >= 3 && !ignored.has(term)))];
}

function relevance(query: string, candidate: ProvenanceRankedCandidate): number {
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  const haystack = normalizeText([
    candidate.query,
    candidate.claim,
    candidate.theme,
    candidate.sourceTitle,
    candidate.supportingQuote,
  ].filter(Boolean).join(" "));
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

function edgeWeight(left: ProvenanceRankedCandidate, right: ProvenanceRankedCandidate): number {
  let weight = 0;
  if (left.provenance.factKey === right.provenance.factKey) weight += 1;
  if (left.provenance.schemaKey === right.provenance.schemaKey) weight += 0.35;
  if (
    left.provenance.conflictGroupKey
    && left.provenance.conflictGroupKey === right.provenance.conflictGroupKey
  ) weight += 0.15;
  return weight;
}

function graphRank(query: string, sourceBacked: ProvenanceRankedCandidate[]): ProvenanceRankedCandidate[] {
  const seeded = sourceBacked.map((candidate, index) => ({
    candidate,
    index,
    seed: Math.max(0.01, relevance(query, candidate)),
  }));
  let scores = seeded.map(({ seed }) => seed);

  for (let pass = 0; pass < GRAPH_PASSES; pass++) {
    scores = seeded.map(({ seed }, target) => {
      let incoming = 0;
      let totalWeight = 0;
      for (let source = 0; source < seeded.length; source++) {
        if (source === target) continue;
        const weight = edgeWeight(seeded[source].candidate, seeded[target].candidate);
        if (weight <= 0) continue;
        const outgoing = seeded.reduce((sum, peer, peerIndex) => (
          peerIndex === source ? sum : sum + edgeWeight(seeded[source].candidate, peer.candidate)
        ), 0);
        if (outgoing > 0) {
          incoming += scores[source] * (weight / outgoing);
          totalWeight += weight;
        }
      }
      // An isolated evidence node retains its direct query relevance. This is
      // important for a small trial corpus where a useful source may have no
      // peer yet.
      const propagated = totalWeight > 0 ? incoming : seed;
      return (1 - DAMPING) * seed + DAMPING * propagated;
    });
  }

  return seeded
    .map(({ candidate, index }, i) => ({ ...candidate, graphScore: scores[i], _index: index }))
    .sort((a, b) => b.graphScore - a.graphScore || a._index - b._index)
    .map(({ _index, ...candidate }) => candidate);
}

function metrics(query: string, candidates: ProvenanceRankedCandidate[], latencyMs: number): ProvenanceMetrics {
  const coverage = candidates.length
    ? candidates.filter((candidate) => candidate.provenance.verifiable).length / candidates.length
    : 0;
  const rankWeightTotal = candidates.reduce((sum, _candidate, index) => sum + 1 / (index + 1), 0);
  const relevanceProxy = rankWeightTotal
    ? candidates.reduce((sum, candidate, index) => sum + relevance(query, candidate) / (index + 1), 0) / rankWeightTotal
    : 0;
  const chars = candidates.reduce((sum, candidate) => sum + [
    candidate.claim,
    candidate.supportingQuote,
    candidate.sourceTitle,
  ].filter(Boolean).join("\n").length, 0);
  return {
    resultCount: candidates.length,
    citationCoverage: Number(coverage.toFixed(4)),
    relevanceProxy: Number(relevanceProxy.toFixed(4)),
    estimatedInputTokens: Math.ceil(chars / 4),
    estimatedModelCostUsd: 0,
    latencyMs: Math.max(0, latencyMs),
  };
}

/**
 * Runs a bounded, deterministic comparison against the caller's baseline
 * candidate order. Even if a caller accidentally passes mixed-tenant data, it
 * is discarded before scoring. `report_only` calculates the graph candidate
 * but preserves the baseline selection; `enabled` applies it only when at
 * least two source-backed records can form a meaningful graph.
 */
export function runResearchProvenanceTrial(params: {
  tenantId: number;
  query: string;
  candidates: ProvenanceEvidenceCandidate[];
  mode: ResearchProvenanceTrialMode;
}): ResearchProvenanceTrial {
  const baselineStartedAt = Date.now();
  const baseline = params.candidates
    .filter((candidate) => candidate.tenantId === params.tenantId)
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => ({
      ...candidate,
      provenance: deriveEvidenceProvenance(candidate),
      graphScore: 0,
    }));
  const sourceBacked = baseline.filter((candidate) => candidate.provenance.verifiable);
  const baselineLatencyMs = Date.now() - baselineStartedAt;
  const graphStartedAt = Date.now();
  const canEvaluateGraph = params.mode !== "off" && sourceBacked.length >= 2;
  const graphSourceBacked = canEvaluateGraph
    ? graphRank(params.query, sourceBacked)
    : sourceBacked;
  const graphIds = new Set(graphSourceBacked.map((candidate) => candidate.id));
  const graph = canEvaluateGraph
    ? [...graphSourceBacked, ...baseline.filter((candidate) => !graphIds.has(candidate.id))]
    : baseline;
  const graphLatencyMs = Date.now() - graphStartedAt;
  const fallbackReason = params.mode === "off"
    ? "feature_off"
    : sourceBacked.length < 2
      ? "insufficient_verifiable_provenance"
      : undefined;
  const applied = params.mode === "enabled" && !fallbackReason;

  return {
    selectedMode: applied ? "graph" : "baseline",
    applied,
    fallbackReason,
    selected: applied ? graph : baseline,
    baseline,
    graph,
    metrics: {
      baseline: metrics(params.query, baseline, baselineLatencyMs),
      graph: metrics(params.query, graph, graphLatencyMs),
      modelCalls: 0,
    },
  };
}
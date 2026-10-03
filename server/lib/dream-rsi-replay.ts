export interface DreamCandidateFeatures {
  noveltyHint: number;
  uncertainty: number;
  estimatedCost: number;
  depth: number;
}

export interface DreamHistoricalNode {
  id: string;
  parentId: string | null;
  availableRound: number;
  features: DreamCandidateFeatures;
  outcome: {
    quality: number;
    safetyPassed: boolean;
    safetyEvaluated: boolean;
    independentlyEvaluated: boolean;
  };
}

export interface DreamPolicyContext {
  round: number;
  candidates: Array<{ id: string; parentId: string | null; features: DreamCandidateFeatures }>;
  revealed: Array<{
    id: string;
    parentId: string | null;
    quality: number;
    safetyPassed: boolean;
    safetyEvaluated: boolean;
    independentlyEvaluated: boolean;
  }>;
  batchSize: number;
}

export interface DreamExplorationPolicy {
  id: string;
  version: string;
  select(context: DreamPolicyContext): string[];
}

export interface DreamPolicyResult {
  policyId: string;
  policyVersion: string;
  selectedNodeIds: string[];
  independentlyEvaluatedCount: number;
  safetyEvaluatedCount: number;
  coverage: number;
  meanQuality: number;
  explorationValue: number;
  safetyRegressions: number;
  score: number | null;
  mayPromote: false;
  mayAllocate: false;
}

export interface DreamReplayResult {
  mode: "report_only";
  verdict: "evaluated" | "insufficient_evidence";
  totalNodes: number;
  policyResults: DreamPolicyResult[];
  bestObservedPolicyId: string | null;
}

const MAX_NODES = 500;
const MAX_POLICIES = 8;
const MAX_ROUNDS = 50;
const MAX_BATCH_SIZE = 20;

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function rankPolicy(
  id: string,
  scorer: (features: DreamCandidateFeatures) => number,
): DreamExplorationPolicy {
  return {
    id,
    version: "1",
    select(context) {
      return context.candidates
        .slice()
        .sort((a, b) =>
          scorer(b.features) - scorer(a.features) || a.id.localeCompare(b.id),
        )
        .slice(0, context.batchSize)
        .map((candidate) => candidate.id);
    },
  };
}

export function createDefaultDreamPolicies(): DreamExplorationPolicy[] {
  return [
    rankPolicy("quality-exploit", (features) =>
      1 - clamp(features.uncertainty) - clamp(features.estimatedCost) * 0.25,
    ),
    rankPolicy("novelty-explore", (features) =>
      clamp(features.noveltyHint) + clamp(features.uncertainty) * 0.75,
    ),
    rankPolicy("balanced", (features) =>
      clamp(features.noveltyHint) * 0.45 +
      clamp(features.uncertainty) * 0.35 -
      clamp(features.estimatedCost) * 0.2 -
      Math.min(1, Math.max(0, features.depth / 20)) * 0.05,
    ),
  ];
}

function validateReplay(
  nodes: readonly DreamHistoricalNode[],
  policies: readonly DreamExplorationPolicy[],
  maxRounds: number,
  batchSize: number,
): void {
  if (nodes.length > MAX_NODES) throw new Error(`Dream replay is limited to ${MAX_NODES} nodes`);
  if (policies.length < 1 || policies.length > MAX_POLICIES) {
    throw new Error(`Dream replay requires 1-${MAX_POLICIES} policies`);
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS) {
    throw new Error(`Dream replay maxRounds must be within 1-${MAX_ROUNDS}`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Dream replay batchSize must be within 1-${MAX_BATCH_SIZE}`);
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) throw new Error("Dream replay node IDs must be unique and non-empty");
    if (!Number.isInteger(node.availableRound) || node.availableRound < 0) {
      throw new Error("Dream replay availableRound must be a non-negative integer");
    }
    ids.add(node.id);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      throw new Error(`Dream replay parent ${node.parentId} is missing`);
    }
  }
}

export function runDreamReplay(
  nodes: readonly DreamHistoricalNode[],
  policies: readonly DreamExplorationPolicy[],
  options: { maxRounds: number; batchSize: number },
): DreamReplayResult {
  validateReplay(nodes, policies, options.maxRounds, options.batchSize);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const results: DreamPolicyResult[] = [];

  for (const policy of policies) {
    const selected = new Set<string>();
    const revealed: DreamPolicyContext["revealed"] = [];
    for (let round = 0; round < options.maxRounds; round++) {
      const candidates = nodes
        .filter((node) =>
          node.availableRound <= round &&
          !selected.has(node.id) &&
          (node.parentId === null || selected.has(node.parentId)),
        )
        .map((node) => ({
          id: node.id,
          parentId: node.parentId,
          features: { ...node.features },
        }));
      if (candidates.length === 0) continue;
      const requested = policy.select({
        round,
        candidates,
        revealed: revealed.map((item) => ({ ...item })),
        batchSize: options.batchSize,
      });
      const allowedIds = new Set(candidates.map((candidate) => candidate.id));
      const uniqueRequested = [...new Set(requested)].slice(0, options.batchSize);
      for (const id of uniqueRequested) {
        if (!allowedIds.has(id)) continue;
        const node = byId.get(id)!;
        selected.add(id);
        revealed.push({
          id: node.id,
          parentId: node.parentId,
          quality: clamp(node.outcome.quality),
          safetyPassed: node.outcome.safetyPassed,
          safetyEvaluated: node.outcome.safetyEvaluated,
          independentlyEvaluated: node.outcome.independentlyEvaluated,
        });
      }
    }

    const independent = revealed.filter((item) => item.independentlyEvaluated);
    const safetyRegressions = independent.filter(
      (item) => item.safetyEvaluated && !item.safetyPassed,
    ).length;
    const safetyEvaluatedCount = independent.filter(
      (item) => item.safetyEvaluated,
    ).length;
    const meanQuality = independent.length === 0
      ? 0
      : independent.reduce((sum, item) => sum + item.quality, 0) / independent.length;
    const novelty = independent.length === 0
      ? 0
      : independent.reduce((sum, item) =>
        sum + clamp(byId.get(item.id)!.features.noveltyHint), 0) / independent.length;
    const coverage = nodes.length === 0 ? 0 : independent.length / nodes.length;
    const sufficient =
      independent.length >= 2 &&
      coverage >= 0.5 &&
      safetyEvaluatedCount === independent.length &&
      safetyRegressions === 0;
    results.push({
      policyId: policy.id,
      policyVersion: policy.version,
      selectedNodeIds: [...selected],
      independentlyEvaluatedCount: independent.length,
      safetyEvaluatedCount,
      coverage,
      meanQuality,
      explorationValue: novelty,
      safetyRegressions,
      score: sufficient ? meanQuality * 0.75 + novelty * 0.25 : null,
      mayPromote: false,
      mayAllocate: false,
    });
  }

  const evaluable = results.filter((result) => result.score !== null);
  const best = evaluable
    .slice()
    .sort((a, b) =>
      (b.score! - a.score!) || a.policyId.localeCompare(b.policyId),
    )[0];
  return {
    mode: "report_only",
    verdict: evaluable.length === policies.length ? "evaluated" : "insufficient_evidence",
    totalNodes: nodes.length,
    policyResults: results,
    bestObservedPolicyId: best?.policyId ?? null,
  };
}
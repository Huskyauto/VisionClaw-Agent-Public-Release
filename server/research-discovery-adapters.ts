import {
  persistResearchDiscoveryShadow,
  type ResearchDiscoveryObservation,
} from "./lib/research-discovery-shadow";
import {
  persistResearchMetaNShadow,
  type ResearchMetaNShadowRecord,
} from "./lib/research-meta-n-shadow";
import { emitLoopOutcomeBestEffort } from "./lib/loop-portfolio-adapter";

export interface ResearchDiscoveryAdapterSession {
  sessionId: number;
  tenantId: number;
  experimentCount: number;
  evalType: string;
  model: string;
  explorationStrategy?: string;
  discoveryObservations: ResearchDiscoveryObservation[];
  metaNStrategyLayers: ResearchMetaNShadowRecord[];
  previousResults: Array<{
    experimentId: number;
    hypothesis: string;
    approach: string;
    status: string;
    score: number;
    metric_value: string | null;
    result: string | null;
  }>;
}

export async function persistResearchDiscoveryAdapters(input: {
  session: ResearchDiscoveryAdapterSession;
  experimentId: number;
  hypothesis: string;
  approach: string;
  metric: string;
  score: number;
  numericMetricValue: number | null;
  qualityConstraintPassed: boolean | null;
  qualityEvidenceKind: "independent_evaluator" | "llm_judge";
}): Promise<void> {
  const { session, experimentId } = input;
  await persistResearchDiscoveryShadow(input);
  try {
    await persistResearchMetaNShadow({ session, experimentId });
  } catch (metaNError) {
    console.warn(
      `[research:meta-n] session #${session.sessionId} exp #${experimentId} outer fail-open`,
      metaNError,
    );
  }
  await emitLoopOutcomeBestEffort({
    tenantId: session.tenantId,
    eventKey: `research-experiment:${experimentId}:outcome`,
    loopKind: "research-discovery",
    policyVersion: session.explorationStrategy || "balanced",
    sourceType: "research_experiment",
    sourceId: String(experimentId),
    taskClass: session.evalType,
    mode: "online",
    quality: Math.max(0, Math.min(1, input.score / 10)),
    costUsd: 0,
    latencyMs: 0,
    safetyPassed: input.qualityConstraintPassed !== false,
    safetyEvaluated: false,
    independentlyEvaluated: input.qualityEvidenceKind === "independent_evaluator",
    persistedQuality: null,
    explorationValue: null,
    evidence: {
      sessionId: session.sessionId,
      evidenceKind: input.qualityEvidenceKind,
      status: input.score >= 6 ? "keep" : "discard",
    },
    occurredAt: new Date().toISOString(),
  });
}
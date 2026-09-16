import {
  persistResearchDiscoveryShadow,
  type ResearchDiscoveryObservation,
} from "./lib/research-discovery-shadow";
import {
  persistResearchMetaNShadow,
  type ResearchMetaNShadowRecord,
} from "./lib/research-meta-n-shadow";

export interface ResearchDiscoveryAdapterSession {
  sessionId: number;
  tenantId: number;
  experimentCount: number;
  evalType: string;
  model: string;
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
}
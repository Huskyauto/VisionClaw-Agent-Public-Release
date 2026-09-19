import {
  createDefaultDreamPolicies,
  runDreamReplay,
  type DreamHistoricalNode,
  type DreamReplayResult,
} from "./dream-rsi-replay";
import type { LoopPortfolioQueryable } from "./loop-portfolio-store";

function unitScore(metricValue: unknown, numericMetricValue: unknown): number {
  const metricMatch = String(metricValue ?? "").match(/-?\d+(?:\.\d+)?/);
  const raw = metricMatch ? Number(metricMatch[0]) : Number(numericMetricValue);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, raw > 1 ? raw / 10 : raw));
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value.toLowerCase().match(/[a-z0-9]{3,}/g)?.slice(0, 100) ?? [],
  );
}

function jaccardNovelty(current: string, previous: string[]): number {
  const currentTokens = tokenSet(current);
  if (currentTokens.size === 0 || previous.length === 0) return 0.5;
  let maxSimilarity = 0;
  for (const value of previous) {
    const prior = tokenSet(value);
    const intersection = [...currentTokens].filter((token) => prior.has(token)).length;
    const union = new Set([...currentTokens, ...prior]).size;
    maxSimilarity = Math.max(maxSimilarity, union === 0 ? 0 : intersection / union);
  }
  return 1 - maxSimilarity;
}

export function researchRowsToDreamTree(rows: readonly any[]): DreamHistoricalNode[] {
  const selectedIds = new Set(rows.map((row) => String(row.id)));
  const priorHypotheses: string[] = [];
  const depthById = new Map<string, number>();
  return rows.map((row, index) => {
    const id = String(row.id);
    const rawParent = row.parent_experiment_id ?? row.parentExperimentId ?? null;
    const parentId = rawParent !== null && selectedIds.has(String(rawParent))
      ? String(rawParent)
      : null;
    const depth = parentId === null ? 0 : (depthById.get(parentId) ?? 0) + 1;
    depthById.set(id, depth);
    const hypothesis = String(row.hypothesis ?? "");
    const noveltyHint = jaccardNovelty(hypothesis, priorHypotheses);
    priorHypotheses.push(hypothesis);
    const verificationStatus = String(
      row.verification_status ?? row.verificationStatus ?? "unverified",
    ).toLowerCase();
    const verificationDetails = String(
      row.verification_details ?? row.verificationDetails ?? "",
    ).toLowerCase();
    const safetyEvaluated =
      verificationDetails.includes("safety_passed") ||
      verificationDetails.includes("safety_failed");
    return {
      id,
      parentId,
      availableRound: index,
      features: {
        noveltyHint,
        uncertainty: 1 / (2 + depth),
        estimatedCost: Math.min(
          1,
          (hypothesis.length + String(row.approach ?? "").length) / 2_000,
        ),
        depth,
      },
      outcome: {
        quality: unitScore(
          row.metric_value ?? row.metricValue,
          row.numeric_metric_value ?? row.numericMetricValue,
        ),
        safetyPassed: verificationDetails.includes("safety_passed"),
        safetyEvaluated,
        independentlyEvaluated:
          verificationStatus === "verified" ||
          verificationDetails.includes("independent_evaluator"),
      },
    };
  });
}

export function normalizeDreamReplayOptions(input: {
  maxNodes?: number;
  maxRounds?: number;
  batchSize?: number;
}): { maxNodes: number; maxRounds: number; batchSize: number } {
  const bounded = (name: string, value: number | undefined, fallback: number, max: number) => {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
    return Math.min(max, resolved);
  };
  return {
    maxNodes: Math.max(5, bounded("maxNodes", input.maxNodes, 200, 500)),
    maxRounds: bounded("maxRounds", input.maxRounds, 20, 50),
    batchSize: bounded("batchSize", input.batchSize, 3, 20),
  };
}

export async function runDreamResearchReplay(
  db: LoopPortfolioQueryable,
  input: {
    tenantId: number;
    programId: number;
    maxNodes?: number;
    maxRounds?: number;
    batchSize?: number;
  },
): Promise<{ cohort: DreamHistoricalNode[]; result: DreamReplayResult }> {
  const options = normalizeDreamReplayOptions(input);
  if (!Number.isInteger(input.tenantId) || input.tenantId < 1) {
    throw new Error("tenantId must be a positive integer");
  }
  if (!Number.isInteger(input.programId) || input.programId < 1) {
    throw new Error("programId must be a positive integer");
  }
  const rows = await db.query(
    `SELECT id, parent_experiment_id, hypothesis, approach, metric_value,
            numeric_metric_value, verification_status, verification_details, created_at
     FROM research_experiments
     WHERE tenant_id = $1 AND program_id = $2
       AND status IN ('keep', 'discard')
     ORDER BY created_at ASC, id ASC
     LIMIT $3`,
    [input.tenantId, input.programId, options.maxNodes],
  );
  const cohort = researchRowsToDreamTree(rows.rows);
  return {
    cohort,
    result: runDreamReplay(cohort, createDefaultDreamPolicies(), {
      maxRounds: options.maxRounds,
      batchSize: options.batchSize,
    }),
  };
}
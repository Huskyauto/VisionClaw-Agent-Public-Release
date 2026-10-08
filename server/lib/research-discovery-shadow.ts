import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  buildResearchCrossoverShadowRecord,
  buildResearchDiscoveryFailureRecord,
  buildResearchDiscoveryShadowRecord,
  serializeResearchCrossoverShadowRecord,
  serializeResearchDiscoveryShadowRecord,
  type ResearchDiscoveryObservation,
  type ResearchQualityEvidenceKind,
} from "./research-discovery-controller";

export type { ResearchDiscoveryObservation } from "./research-discovery-controller";

interface DiscoverySessionState {
  sessionId: number;
  tenantId: number;
  experimentCount: number;
  evalType: string;
  discoveryObservations: ResearchDiscoveryObservation[];
}

interface PersistResearchDiscoveryShadowInput {
  session: DiscoverySessionState;
  experimentId: number;
  hypothesis: string;
  approach: string;
  metric: string;
  score: number;
  numericMetricValue: number | null;
  qualityConstraintPassed: boolean | null;
  qualityEvidenceKind: ResearchQualityEvidenceKind;
}

function resultRows(result: unknown): unknown[] {
  const candidate = result && typeof result === "object" && "rows" in result
    ? (result as { rows?: unknown }).rows
    : result;
  return Array.isArray(candidate) ? candidate : [];
}

const stats = {
  attempted: 0,
  persisted: 0,
  ready: 0,
  insufficientEvidence: 0,
  degraded: 0,
  crossoverAttempted: 0,
  crossoverAccepted: 0,
  crossoverRejected: 0,
  failures: 0,
};

export function getResearchDiscoveryControllerStats() {
  return { ...stats };
}

export async function persistResearchDiscoveryShadow(
  input: PersistResearchDiscoveryShadowInput,
): Promise<void> {
  const { session } = input;
  const objectiveValue = input.numericMetricValue ?? input.score;
  const objectiveDirection = input.numericMetricValue !== null && session.evalType === "cost"
    ? "minimize" as const
    : "maximize" as const;
  const evidenceKind = input.numericMetricValue !== null
    ? "empirical" as const
    : "llm_judge" as const;
  const observation: ResearchDiscoveryObservation = {
    id: input.experimentId,
    hypothesis: input.hypothesis,
    approach: input.approach,
    metric: input.metric,
    objectiveValue,
    objectiveDirection,
    evidenceKind,
    qualityConstraintPassed: input.qualityConstraintPassed ?? undefined,
    qualityEvidenceKind: input.qualityEvidenceKind,
    tenantId: session.tenantId,
    evidenceId: `research-experiment:${input.experimentId}`,
  };

  let record;
  let scoringFailed = false;
  try {
    record = buildResearchDiscoveryShadowRecord({
      modeValue: process.env.RESEARCH_DISCOVERY_CONTROLLER_MODE,
      candidate: {
        id: input.experimentId,
        hypothesis: input.hypothesis,
        approach: input.approach,
        metric: input.metric,
      },
      priorObservations: session.discoveryObservations,
      observedObjective: objectiveValue,
      objectiveDirection,
      evidenceKind,
      qualityConstraintPassed: input.qualityConstraintPassed,
      qualityEvidenceKind: input.qualityEvidenceKind,
    });
  } catch (error: unknown) {
    scoringFailed = true;
    stats.failures++;
    console.warn(
      `[research:discovery] session #${session.sessionId} exp #${session.experimentCount} shadow scoring failed open`,
      error,
    );
    record = buildResearchDiscoveryFailureRecord({
      candidateId: input.experimentId,
      observedObjective: objectiveValue,
      objectiveDirection,
      evidenceKind,
      qualityConstraintPassed: input.qualityConstraintPassed,
      qualityEvidenceKind: input.qualityEvidenceKind,
    });
  }
  let crossoverRecord = null;
  try {
    crossoverRecord = buildResearchCrossoverShadowRecord({
      modeValue: process.env.RESEARCH_CROSSOVER_MODE,
      candidate: observation,
      priorObservations: session.discoveryObservations,
    });
  } catch (error: unknown) {
    stats.failures++;
    console.warn(
      `[research:crossover] session #${session.sessionId} exp #${session.experimentCount} shadow scoring failed open`,
      error,
    );
  }
  if (!record && !crossoverRecord) return;

  if (record) {
    stats.attempted++;
    if (record.status === "ready") stats.ready++;
    else if (record.status === "degraded") stats.degraded++;
    else stats.insufficientEvidence++;
  }
  if (crossoverRecord) {
    stats.crossoverAttempted++;
    if (crossoverRecord.status === "accepted") stats.crossoverAccepted++;
    if (crossoverRecord.status === "rejected") stats.crossoverRejected++;
  }

  try {
    const serialized = [
      record ? serializeResearchDiscoveryShadowRecord(record) : "",
      crossoverRecord ? serializeResearchCrossoverShadowRecord(crossoverRecord) : "",
    ].filter(Boolean).join("\n");
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '1500ms'`);
      return tx.execute(sql`
        UPDATE research_experiments SET verification_details =
          CASE
            WHEN verification_details IS NULL OR verification_details = '' THEN ${serialized}
            ELSE verification_details || E'\n' || ${serialized}
          END
        WHERE id = ${input.experimentId} AND tenant_id = ${session.tenantId}
        RETURNING id
      `);
    });
    const rows = resultRows(result);
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("tenant-scoped experiment row was not updated");
    }
    stats.persisted++;
    if (record) {
      console.log(
        `[research:discovery] session #${session.sessionId} exp #${session.experimentCount} ` +
        `status=${record.status} select=${String(record.wouldSelect)} ` +
        `refs=${record.referenceCount} empirical=${record.empiricalReferenceCount}`,
      );
    }
    if (crossoverRecord) {
      console.log(
        `[research:crossover] session #${session.sessionId} exp #${session.experimentCount} ` +
        `status=${crossoverRecord.status} promote=${String(crossoverRecord.wouldPromote)} ` +
        `parents=${crossoverRecord.parentIds.join(",") || "none"}`,
      );
    }
    if (!scoringFailed) {
      session.discoveryObservations.push(observation);
    }
  } catch (error: unknown) {
    stats.failures++;
    console.warn(
      `[research:discovery] session #${session.sessionId} exp #${session.experimentCount} metadata persistence failed open`,
      error,
    );
  }
}
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import {
  evaluateCapabilityMaturity,
  type CapabilityMaturityReport,
} from "./capability-maturity-evaluator";

export interface CapabilityMaturityQuery {
  limit: number;
}

export interface CapabilityMaturityEvidenceRows {
  observations: unknown[];
  corroboratedRewardIds: Set<number>;
  historicalNegativeCapabilities?: Set<string>;
}

export interface CapabilityMaturityStore {
  listEvidence(query: CapabilityMaturityQuery): Promise<CapabilityMaturityEvidenceRows>;
}

function positiveLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("limit must be a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 500) {
    throw new Error("limit must be a positive integer no greater than 500");
  }
  return parsed;
}

export function parseCapabilityMaturityQuery(
  query: Record<string, unknown>,
): CapabilityMaturityQuery {
  return { limit: positiveLimit(query.limit) ?? 100 };
}

export const databaseCapabilityMaturityStore: CapabilityMaturityStore = {
  async listEvidence({ limit }) {
    const result = await db.execute(sql`
      WITH recent AS MATERIALIZED (
        SELECT e.id, e.tenant_id, e.data
        FROM event_log e
        WHERE e.tenant_id = ${ADMIN_TENANT_ID}
          AND e.event_type = 'capability_evidence_shadow'
        ORDER BY e.id DESC
        LIMIT ${limit}
      ),
      negative_history AS MATERIALIZED (
        SELECT e.data->>'capability' AS capability
        FROM event_log e
        WHERE e.tenant_id = ${ADMIN_TENANT_ID}
          AND e.event_type = 'capability_evidence_shadow'
          AND e.data->>'evidenceClass' IN ('hollow_success', 'failed')
        GROUP BY e.data->>'capability'
      )
      SELECT recent.data,
             sr.id AS corroborated_reward_id,
             negative_history.capability IS NOT NULL AS historical_negative
      FROM recent
      LEFT JOIN step_rewards sr
        ON sr.tenant_id = recent.tenant_id
       AND sr.id::text = recent.data->>'rewardId'
      LEFT JOIN negative_history
        ON negative_history.capability = recent.data->>'capability'
      ORDER BY recent.id DESC
    `);
    const rows = ((result as any).rows ?? result) as Array<{
      data: unknown;
      corroborated_reward_id: number | string | null;
      historical_negative: boolean;
    }>;
    const corroboratedRewardIds = new Set<number>();
    const historicalNegativeCapabilities = new Set<string>();
    for (const row of rows) {
      const rewardId = Number(row.corroborated_reward_id);
      if (Number.isSafeInteger(rewardId) && rewardId > 0) {
        corroboratedRewardIds.add(rewardId);
      }
      if (
        row.historical_negative === true &&
        row.data &&
        typeof row.data === "object" &&
        !Array.isArray(row.data) &&
        typeof (row.data as Record<string, unknown>).capability === "string"
      ) {
        historicalNegativeCapabilities.add(
          (row.data as Record<string, unknown>).capability as string,
        );
      }
    }
    return {
      observations: rows.map((row) => row.data),
      corroboratedRewardIds,
      historicalNegativeCapabilities,
    };
  },
};

export async function buildCapabilityMaturityPayload(
  query: CapabilityMaturityQuery,
  store: CapabilityMaturityStore = databaseCapabilityMaturityStore,
): Promise<CapabilityMaturityReport> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  const evidence = await store.listEvidence(query);
  return evaluateCapabilityMaturity(
    evidence.observations,
    evidence.corroboratedRewardIds,
    evidence.historicalNegativeCapabilities,
  );
}
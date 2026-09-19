import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import {
  skillOptimizationCandidates,
  skillOptimizationVersions,
} from "../../shared/schema";
import {
  evaluateImprovementEvidence,
  summarizeImprovementEvidence,
  type ImprovementCandidateEvidence,
  type ImprovementEvidenceReport,
  type ImprovementEvidenceSummary,
  type ImprovementVersionEvidence,
} from "./improvement-evidence-evaluator";

export interface ImprovementEvidenceQuery {
  limit: number;
  skillId?: number;
}

export interface ImprovementEvidencePayload {
  generatedFrom: "durable_skill_optimizer_evidence";
  tenantScope: typeof ADMIN_TENANT_ID;
  reportOnly: true;
  autonomyChanged: false;
  summary: ImprovementEvidenceSummary;
  reports: Array<Omit<ImprovementEvidenceReport, "label">>;
}

export interface ImprovementEvidenceCliPayload
  extends Omit<ImprovementEvidencePayload, "reports"> {
  reports: ImprovementEvidenceReport[];
}

export interface ImprovementEvidenceStore {
  listCandidates(options: ImprovementEvidenceQuery): Promise<ImprovementCandidateEvidence[]>;
  listVersions(ids: number[]): Promise<ImprovementVersionEvidence[]>;
}

function positiveInteger(
  value: unknown,
  name: "limit" | "skillId",
  maximum?: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) {
    throw new Error(`${name} must be a positive integer${maximum ? ` no greater than ${maximum}` : ""}`);
  }
  return parsed;
}

export function parseImprovementEvidenceQuery(
  query: Record<string, unknown>,
): ImprovementEvidenceQuery {
  return {
    limit: positiveInteger(query.limit, "limit", 500) ?? 100,
    skillId: positiveInteger(query.skillId, "skillId", 2_147_483_647),
  };
}

export const databaseImprovementEvidenceStore: ImprovementEvidenceStore = {
  async listCandidates({ limit, skillId }) {
    const candidateWhere = skillId
      ? and(
          eq(skillOptimizationCandidates.tenantId, ADMIN_TENANT_ID),
          eq(skillOptimizationCandidates.skillId, skillId),
        )
      : eq(skillOptimizationCandidates.tenantId, ADMIN_TENANT_ID);

    // Explicit projection is a privacy boundary. Candidate content and free-form
    // descriptions never enter this reporting path.
    return db
      .select({
        id: skillOptimizationCandidates.id,
        tenantId: skillOptimizationCandidates.tenantId,
        skillId: skillOptimizationCandidates.skillId,
        label: skillOptimizationCandidates.label,
        state: skillOptimizationCandidates.state,
        seedHash: skillOptimizationCandidates.seedHash,
        candidateHash: skillOptimizationCandidates.candidateHash,
        evalSetHash: skillOptimizationCandidates.evalSetHash,
        policyVersion: skillOptimizationCandidates.policyVersion,
        evidence: skillOptimizationCandidates.evidence,
        juryDecision: skillOptimizationCandidates.juryDecision,
        juryDecisionHash: skillOptimizationCandidates.juryDecisionHash,
        promotedVersionId: skillOptimizationCandidates.promotedVersionId,
        rolledBackAt: skillOptimizationCandidates.rolledBackAt,
      })
      .from(skillOptimizationCandidates)
      .where(candidateWhere)
      .orderBy(desc(skillOptimizationCandidates.createdAt), desc(skillOptimizationCandidates.id))
      .limit(limit);
  },

  async listVersions(ids) {
    if (ids.length === 0) return [];
    return db
      .select({
        id: skillOptimizationVersions.id,
        candidateId: skillOptimizationVersions.candidateId,
        contentHash: skillOptimizationVersions.contentHash,
        kind: skillOptimizationVersions.kind,
      })
      .from(skillOptimizationVersions)
      .where(and(
        eq(skillOptimizationVersions.tenantId, ADMIN_TENANT_ID),
        inArray(skillOptimizationVersions.id, ids),
      ))
      .orderBy(desc(skillOptimizationVersions.id))
      .limit(ids.length);
  },
};

async function evaluateStoredImprovementEvidence(
  query: ImprovementEvidenceQuery,
  store: ImprovementEvidenceStore = databaseImprovementEvidenceStore,
): Promise<ImprovementEvidenceCliPayload> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  if (query.skillId !== undefined && (!Number.isInteger(query.skillId) || query.skillId < 1)) {
    throw new Error("skillId must be a positive integer");
  }

  const candidates = await store.listCandidates(query);
  const promotedVersionIds = candidates
    .map((candidate) => candidate.promotedVersionId)
    .filter((id): id is number => id !== null);
  const versions = await store.listVersions(promotedVersionIds);
  const versionsById = new Map<number, ImprovementVersionEvidence>(
    versions.map((version) => [version.id, version]),
  );
  const reports = candidates.map((candidate) =>
    evaluateImprovementEvidence(
      candidate,
      candidate.promotedVersionId === null
        ? null
        : versionsById.get(candidate.promotedVersionId) ?? null,
    ),
  );

  return {
    generatedFrom: "durable_skill_optimizer_evidence",
    tenantScope: ADMIN_TENANT_ID,
    reportOnly: true,
    autonomyChanged: false,
    summary: summarizeImprovementEvidence(reports),
    reports,
  };
}

export async function buildImprovementEvidencePayload(
  query: ImprovementEvidenceQuery,
  store: ImprovementEvidenceStore = databaseImprovementEvidenceStore,
): Promise<ImprovementEvidencePayload> {
  const payload = await evaluateStoredImprovementEvidence(query, store);
  return {
    ...payload,
    reports: payload.reports.map(({ label: _label, ...report }) => report),
  };
}

export async function buildImprovementEvidenceCliPayload(
  query: ImprovementEvidenceQuery,
  store: ImprovementEvidenceStore = databaseImprovementEvidenceStore,
): Promise<ImprovementEvidenceCliPayload> {
  return evaluateStoredImprovementEvidence(query, store);
}
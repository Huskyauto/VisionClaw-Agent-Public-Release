/**
 * Proof-backed capability evidence shadow.
 *
 * Observations are measurements derived from durable step rewards. They have no
 * authority over routing, permissions, rewards, approvals, or execution.
 */
import { createHash } from "node:crypto";
import { logSilentCatch } from "./silent-catch";

const DIGEST_RE = /^[a-f0-9]{64}$/;
const CAPABILITY_RE = /^[a-zA-Z0-9_.:/ -]{1,80}$/;
const OBSERVATION_KEYS = new Set([
  "schemaVersion", "mode", "authorityEffect", "eventKey", "rewardId", "planId",
  "runId", "stepIndex", "capability", "score", "success", "outputLen",
  "evidenceClass", "taskDigest", "observedAt",
]);

export type CapabilityEvidenceClass = "verified_success" | "hollow_success" | "failed";

export interface CapabilityEvidenceObservation {
  schemaVersion: 1;
  mode: "shadow";
  authorityEffect: "none";
  eventKey: string;
  rewardId: number;
  planId?: number;
  runId?: number;
  stepIndex: number;
  capability: string;
  score: number;
  success: boolean;
  outputLen: number;
  evidenceClass: CapabilityEvidenceClass;
  taskDigest: string;
  observedAt: string;
}

export interface BuildCapabilityEvidenceInput {
  rewardId: number;
  planId?: number | null;
  runId?: number | null;
  stepIndex: number;
  capability?: string | null;
  score: number;
  success: boolean;
  outputLen: number;
  taskDigest: string;
  at?: Date;
}

function boundedInt(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function normalizeCapabilityIdentity(value: unknown): string {
  return String(value || "unattributed")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, " ")
    .replace(/[^a-zA-Z0-9_.:/ -]+/g, " ")
    .replace(/\b(system|assistant|user|developer)\s*:/gi, "$1-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "unattributed";
}

export function isCapabilityEvidenceShadowEnabled(
  value = process.env.CAPABILITY_EVIDENCE_SHADOW,
): boolean {
  return value !== "off";
}

export function digestCapabilityTask(task: unknown): string {
  return createHash("sha256").update(String(task ?? ""), "utf8").digest("hex");
}

export function buildCapabilityEvidenceObservation(
  input: BuildCapabilityEvidenceInput,
): CapabilityEvidenceObservation {
  const rewardId = boundedInt(input.rewardId, 1, Number.MAX_SAFE_INTEGER);
  const stepIndex = boundedInt(input.stepIndex, 0, 100_000);
  const score = boundedInt(input.score, 0, 100);
  const outputLen = boundedInt(input.outputLen, 0, 10_000_000);
  const capability = normalizeCapabilityIdentity(input.capability);
  const observedAt = (input.at ?? new Date()).toISOString();
  const taskDigest = DIGEST_RE.test(input.taskDigest) ? input.taskDigest : digestCapabilityTask("");
  const evidenceClass: CapabilityEvidenceClass =
    !input.success ? "failed" : outputLen < 20 ? "hollow_success" : "verified_success";
  const observation: CapabilityEvidenceObservation = {
    schemaVersion: 1,
    mode: "shadow",
    authorityEffect: "none",
    eventKey: `${rewardId}:${stepIndex}`,
    rewardId,
    stepIndex,
    capability,
    score,
    success: input.success,
    outputLen,
    evidenceClass,
    taskDigest,
    observedAt,
  };
  if (Number.isSafeInteger(input.planId) && Number(input.planId) > 0) observation.planId = Number(input.planId);
  if (Number.isSafeInteger(input.runId) && Number(input.runId) > 0) observation.runId = Number(input.runId);
  return observation;
}

export function parseCapabilityEvidenceObservation(value: unknown): CapabilityEvidenceObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !OBSERVATION_KEYS.has(key))) return null;
  if (
    row.schemaVersion !== 1 ||
    row.mode !== "shadow" ||
    row.authorityEffect !== "none" ||
    !Number.isSafeInteger(row.rewardId) || Number(row.rewardId) <= 0 ||
    !Number.isSafeInteger(row.stepIndex) || Number(row.stepIndex) < 0 ||
    !Number.isSafeInteger(row.score) || Number(row.score) < 0 || Number(row.score) > 100 ||
    !Number.isSafeInteger(row.outputLen) || Number(row.outputLen) < 0 ||
    typeof row.capability !== "string" || !CAPABILITY_RE.test(row.capability) ||
    typeof row.success !== "boolean" ||
    !["verified_success", "hollow_success", "failed"].includes(String(row.evidenceClass)) ||
    row.evidenceClass !== (!row.success ? "failed" : Number(row.outputLen) < 20 ? "hollow_success" : "verified_success") ||
    typeof row.taskDigest !== "string" || !DIGEST_RE.test(row.taskDigest) ||
    typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) ||
    row.eventKey !== `${row.rewardId}:${row.stepIndex}`
  ) return null;
  for (const key of ["planId", "runId"]) {
    if (row[key] !== undefined && (!Number.isSafeInteger(row[key]) || Number(row[key]) <= 0)) return null;
  }
  return row as unknown as CapabilityEvidenceObservation;
}

/**
 * Conservative review threshold only. "Ready" means enough evidence for a human
 * to inspect; it never means authorized, promoted, or safe for expanded access.
 */
export function isCapabilityEvidenceReadyForReview(
  observations: CapabilityEvidenceObservation[],
  corroboratedRewardIds: Set<number>,
): boolean {
  if (observations.length < 3) return false;
  const capabilities = new Set(observations.map((row) => row.capability));
  if (capabilities.size !== 1) return false;
  const unique = new Set<number>();
  let strongSuccesses = 0;
  for (const row of observations) {
    if (!parseCapabilityEvidenceObservation(row)) return false;
    if (!corroboratedRewardIds.has(row.rewardId) || unique.has(row.rewardId)) continue;
    unique.add(row.rewardId);
    if (row.evidenceClass === "verified_success" && row.score >= 70 && row.outputLen >= 80) {
      strongSuccesses++;
    }
  }
  return strongSuccesses >= 3;
}

export async function recordCapabilityEvidenceShadow(params: {
  tenantId: number;
  rewardId: number;
  planId?: number | null;
  runId?: number | null;
  stepIndex: number;
  capability?: string | null;
  task?: string | null;
  score: number;
  success: boolean;
  outputLen: number;
}): Promise<void> {
  if (!isCapabilityEvidenceShadowEnabled()) return;
  if (!Number.isSafeInteger(params.tenantId) || params.tenantId <= 0) return;
  if (!Number.isSafeInteger(params.rewardId) || params.rewardId <= 0) return;
  try {
    const observation = buildCapabilityEvidenceObservation({
      ...params,
      taskDigest: digestCapabilityTask(params.task),
    });
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.transaction(async (tx) => {
      // Unlike Promise.race, a statement timeout cancels the database work rather
      // than merely abandoning the wait while a query keeps using the pool.
      await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
      await tx.execute(sql`
        WITH evidence_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${params.tenantId}:${observation.eventKey}`}, 0)
          )
        )
        INSERT INTO event_log (tenant_id, event_type, source, data, status)
        SELECT sr.tenant_id, 'capability_evidence_shadow', 'step-reward',
               ${JSON.stringify(observation)}::jsonb, 'shadow'
        FROM step_rewards sr
        CROSS JOIN evidence_lock
        WHERE sr.id = ${params.rewardId}
          AND sr.tenant_id = ${params.tenantId}
          AND NOT EXISTS (
            SELECT 1 FROM event_log e
            WHERE e.tenant_id = sr.tenant_id
              AND e.event_type = 'capability_evidence_shadow'
              AND e.data->>'eventKey' = ${observation.eventKey}
          )
      `);
    });
  } catch (error) {
    logSilentCatch("server/lib/capability-evidence-shadow.ts:record", error);
  }
}
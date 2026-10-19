import { sql } from "drizzle-orm";
import type { BusinessReportReviewInput, BusinessReportReviewState } from "./business-report-review";
import { reservePaidReportJury } from "./business-report-paid-budget";
import { REPORT_GEMINI_MODEL } from "./business-report-gemini";
import { hashReportBytes } from "./business-report-evidence";

export const REPORT_COMPILER_CAP_MICROS = 5_000_000;

function validPriorRecovery(prior: Record<string, any>, grant: any, base: string, state: BusinessReportReviewState): boolean {
  const key = grant.priorKey;
  if (typeof key !== "string") return false;
  const original = prior[key];
  if (!original || original.requestId !== state.requestId || original.digest !== state.digest) return false;
  if (key === base) {
    return original.status === "claimed" && !Object.hasOwn(original, "response") &&
      !Object.hasOwn(original, "candidate") && !Object.hasOwn(original, "receipt");
  }
  const prefix = `${base}:recovery:`;
  if (!key.startsWith(prefix) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key.slice(prefix.length)) ||
      original.status !== "response_received" || original.failure?.kind !== "incomplete" ||
      original.response?.httpStatus !== 200 || typeof original.response.rawBody !== "string" ||
      original.response.rawBody.length > 2_000_000 || typeof grant.priorResponseHash !== "string" ||
      hashReportBytes(original.response.rawBody) !== grant.priorResponseHash ||
      original.response.responseHash !== grant.priorResponseHash) return false;
  try {
    const body = JSON.parse(original.response.rawBody);
    return /^gemini-4-argon(?:-\d{3}|-\d{4}-\d{2}-\d{2})?$/.test(body.modelVersion) &&
      body.candidates?.length === 1 && body.candidates[0].finishReason === "MAX_TOKENS" &&
      Number.isSafeInteger(body.usageMetadata?.promptTokenCount) && body.usageMetadata.promptTokenCount >= 0 &&
      Number.isSafeInteger(body.usageMetadata?.candidatesTokenCount) && body.usageMetadata.candidatesTokenCount > 0;
  } catch { return false; }
}

export function reportCompilerOperationKey(state: BusinessReportReviewState): string {
  const base = `compiler:${state.round}:${state.requestId}`;
  if (state.compilerRecoveryId === undefined) return base;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state.compilerRecoveryId)) {
    throw new Error("Report compiler recovery authorization invalid");
  }
  return `${base}:recovery:${state.compilerRecoveryId}`;
}

export async function reserveReportCompiler(
  input: BusinessReportReviewInput, state: BusinessReportReviewState, jobId: number,
  attempt: number, amount: number,
  database?: Pick<typeof import("../db").db, "transaction">,
) {
  if (input.tenantId !== 1 || process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1" ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isSafeInteger(state.round) || state.round < 1 || state.round > 2) {
    throw new Error("Report compiler budget scope invalid");
  }
  const store = database ?? (await import("../db")).db;
  const key = reportCompilerOperationKey(state);
  const runs = await store.transaction(async tx => {
    const result: any = await tx.execute(sql`SELECT payload FROM agent_jobs
      WHERE id=${jobId} AND tenant_id=${input.tenantId} AND kind='business_report_review'
      AND status='running' AND attempts=${attempt} AND lease_until > NOW()
      AND payload->'state'->>'phase'='compiling' FOR UPDATE`);
    const payload = (result.rows || result)[0]?.payload;
    if (!payload || payload.input?.tenantId !== input.tenantId ||
        payload.state?.requestId !== state.requestId || payload.state?.digest !== state.digest ||
        payload.state?.round !== state.round || payload.state?.compilerRecoveryId !== state.compilerRecoveryId ||
        payload.input?.kind !== input.kind ||
        payload.input?.operatorJobId !== input.operatorJobId ||
        payload.input?.paidJuryBatch !== input.paidJuryBatch) {
      throw new Error("Report compiler reservation lost its bound lease");
    }
    const prior = payload.compilerRuns ?? {};
    if (!prior || typeof prior !== "object" || Array.isArray(prior) || Object.hasOwn(prior, key)) {
      throw new Error("Report compiler dispatch already claimed or malformed; no retry");
    }
    const amounts = Object.values(prior).map((run: any) => run.reservedMicros);
    if (amounts.some(v => !Number.isSafeInteger(v) || v <= 0)) throw new Error("Invalid compiler budget history");
    const reservedMicros = Math.ceil(amount * 1_000_000);
    if (state.compilerRecoveryId !== undefined) {
      const base = `compiler:${state.round}:${state.requestId}`;
      const grant = payload.compilerRecoveryGrants?.[state.compilerRecoveryId];
      if (!grant || grant.jobId !== jobId || grant.tenantId !== input.tenantId ||
          grant.requestId !== state.requestId || grant.digest !== state.digest ||
          grant.round !== state.round || typeof grant.authorizedAt !== "string" ||
          !Number.isFinite(Date.parse(grant.authorizedAt)) ||
          !Number.isSafeInteger(grant.maxAdditionalMicros) || grant.maxAdditionalMicros <= 0 ||
          reservedMicros > grant.maxAdditionalMicros || !validPriorRecovery(prior, grant, base, state)) {
        throw new Error("Report compiler recovery authorization does not match its uncertain operation");
      }
    }
    if (amounts.reduce((sum, value) => sum + value, 0) + reservedMicros > REPORT_COMPILER_CAP_MICROS) {
      throw new Error("Report compiler $5 ceiling reached");
    }
    const next = { ...prior, [key]: { reservedMicros, requestId: state.requestId, digest: state.digest,
      status: "claimed", model: REPORT_GEMINI_MODEL, claimedAt: new Date().toISOString() } };
    await tx.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,'{compilerRuns}',${JSON.stringify(next)}::jsonb)
      WHERE id=${jobId} AND tenant_id=${input.tenantId} AND attempts=${attempt}
      AND status='running' AND lease_until > NOW()`);
    return next;
  });
  // Also debit the EXISTING shared report allocation. Never create a fresh batch.
  if (input.paidJuryBatch) {
    await reservePaidReportJury(input, jobId, attempt, key, REPORT_GEMINI_MODEL, amount,
      { db: store });
  }
  return runs;
}

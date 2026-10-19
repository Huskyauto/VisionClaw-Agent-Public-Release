import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { reserveReportCompiler } from "../../server/lib/business-report-compiler-budget";
import type { BusinessReportReviewInput, BusinessReportReviewState } from "../../server/lib/business-report-review";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

test("compiler reservations are durable, tenant/lease bound, capped and never refunded or replayed", async () => {
  const input = { tenantId: 1, kind: "readiness", operatorJobId: "fixture" } as BusinessReportReviewInput;
  const state = { phase: "compiling", round: 1, requestId: "revision", digest: "a".repeat(64) } as BusinessReportReviewState;
  const payload: any = { input, state };
  let live = true, writes = 0;
  const dialect = new PgDialect();
  const database = { transaction: async (fn: any) => fn({ execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    assert.match(sql, /tenant_id/);
    assert.match(sql, /lease_until > NOW/);
    assert.match(sql, /attempts/);
    if (sql.startsWith("SELECT")) return { rows: live ? [{ payload: structuredClone(payload) }] : [] };
    writes++;
    payload.compilerRuns = JSON.parse(params.find((p: any) => typeof p === "string" && p.startsWith("{")) as string);
    return { rows: [{ id: 12 }] };
  } }) } as any;
  await reserveReportCompiler(input, state, 12, 1, 2.5, database);
  assert.equal(writes, 1);
  await assert.rejects(reserveReportCompiler(input, state, 12, 1, 0.1, database), /claimed/);
  payload.state = { ...state, round: 2, requestId: "next" };
  await assert.rejects(reserveReportCompiler(input, payload.state, 12, 1, 2.500001, database), /ceiling/);
  await reserveReportCompiler(input, payload.state, 12, 1, 2.5, database);
  assert.equal(Object.keys(payload.compilerRuns).length, 2);
  live = false;
  await assert.rejects(reserveReportCompiler(input, state, 12, 1, 0.1, database), /lease/);
  await assert.rejects(reserveReportCompiler({ ...input, tenantId: 2 }, state, 12, 1, 0.1, database), /scope/);
  for (const value of [NaN, Infinity, 0, -1, "1", null]) {
    await assert.rejects(reserveReportCompiler(input, state, 12, 1, value as number, database), /scope/);
  }
  assert.equal(writes, 2);
});

test("definite token exhaustion can use a separately bound recovery with all old reservations retained", async () => {
  const grantId = "fd5ba6b5-564c-4422-af36-215bba4035f3";
  const oldId = "fd5ba6b5-564c-4422-af36-215bba4035f2";
  const base = "compiler:1:retained", priorKey = `${base}:recovery:${oldId}`;
  const state: any = { phase: "compiling", round: 1, requestId: "retained",
    digest: "b".repeat(64), compilerRecoveryId: grantId };
  const input: any = { tenantId: 1, kind: "readiness", operatorJobId: "fixture" };
  const rawBody = JSON.stringify({ modelVersion: "gemini-4-argon", candidates: [{ finishReason: "MAX_TOKENS" }],
    usageMetadata: { promptTokenCount: 34267, candidatesTokenCount: 16384 } });
  const responseHash = hashReportBytes(rawBody);
  const payload: any = { input, state, compilerRuns: {
    [base]: { reservedMicros: 980000 },
    [priorKey]: { reservedMicros: 980000, status: "response_received",
      requestId: state.requestId, digest: state.digest, failure: { kind: "incomplete" },
      response: { rawBody, httpStatus: 200, responseHash } } },
    compilerRecoveryGrants: { [grantId]: { jobId: 12, tenantId: 1, requestId: state.requestId,
      digest: state.digest, round: 1, priorKey, priorResponseHash: responseHash,
      authorizedAt: "2026-10-18T23:59:00Z", maxAdditionalMicros: 1400000 } } };
  const dialect = new PgDialect();
  const database: any = { transaction: async (fn: any) => fn({ execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    if (sql.startsWith("SELECT")) return { rows: [{ payload: structuredClone(payload) }] };
    payload.compilerRuns = JSON.parse(params.find((p: any) => typeof p === "string" && p.startsWith("{")) as string);
    return { rows: [{ id: 12 }] };
  } }) };
  const runs = await reserveReportCompiler(input, state, 12, 9, 1.308, database);
  assert.equal(Object.keys(runs).length, 3);
  assert.equal(Object.values(runs).reduce((sum: number, run: any) => sum + run.reservedMicros, 0), 3268000);
  delete payload.compilerRuns[`${base}:recovery:${grantId}`];
  payload.compilerRuns[priorKey].response.rawBody = rawBody.replace("MAX_TOKENS", "STOP");
  await assert.rejects(reserveReportCompiler(input, state, 12, 9, 1.308, database), /authorization/);
});

test("one explicit owner recovery keeps the uncertain reservation and cannot replay its grant", async () => {
  const grantId = "fd5ba6b5-564c-4422-af36-215bba4035f2";
  const state: any = { phase: "compiling", round: 1, requestId: "retained",
    digest: "b".repeat(64), compilerRecoveryId: grantId };
  const input: any = { tenantId: 1, kind: "readiness", operatorJobId: "fixture" };
  const priorKey = "compiler:1:retained";
  const original = { reservedMicros: 980000, status: "claimed", requestId: state.requestId,
    digest: state.digest, claimedAt: "2026-10-18T20:00:00Z" };
  const payload: any = { input, state, compilerRuns: { [priorKey]: original },
    compilerRecoveryGrants: { [grantId]: { jobId: 12, tenantId: 1, requestId: state.requestId,
      digest: state.digest, round: 1, priorKey, authorizedAt: "2026-10-18T23:59:00Z",
      maxAdditionalMicros: 1050000 } } };
  const dialect = new PgDialect();
  const database: any = { transaction: async (fn: any) => fn({ execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    if (sql.startsWith("SELECT")) return { rows: [{ payload: structuredClone(payload) }] };
    payload.compilerRuns = JSON.parse(params.find((p: any) => typeof p === "string" && p.startsWith("{")) as string);
    return { rows: [{ id: 12 }] };
  } }) };
  const result = await reserveReportCompiler(input, state, 12, 7, 0.98, database);
  assert.equal(Object.keys(result).length, 2);
  assert.deepEqual(result[priorKey], original, "unknown first completion is never refunded or rewritten");
  assert.equal(Object.values(result).reduce((sum: number, run: any) => sum + run.reservedMicros, 0), 1960000);
  await assert.rejects(reserveReportCompiler(input, state, 12, 7, 0.98, database), /claimed/);
  delete payload.compilerRuns[`${priorKey}:recovery:${grantId}`];
  payload.compilerRecoveryGrants[grantId].digest = "c".repeat(64);
  await assert.rejects(reserveReportCompiler(input, state, 12, 7, 0.98, database), /authorization/);
  payload.compilerRecoveryGrants[grantId].digest = state.digest;
  await assert.rejects(reserveReportCompiler(input, state, 12, 7, 1.06, database), /authorization/);
});

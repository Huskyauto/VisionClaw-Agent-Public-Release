import test from "node:test";
import assert from "node:assert/strict";
import { inspectInvalidCompilerReply } from "../../server/lib/business-report-compiler-failure";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { reserveReportCompiler } from "../../server/lib/business-report-compiler-budget";
import { PgDialect } from "drizzle-orm/pg-core";
import { retainedCompanyReviewFixture } from "../helpers/retained-company-review";
import { retainedCompilerReviewMatches } from "../../server/lib/company-report-retained-review";
const digest = "a".repeat(64), requestId = "f0df9b5b-5da6-4b8c-864c-054e5845e205";
const input: any = { tenantId: 1, kind: "readiness", sections: [{ heading: "Summary", body: "original" }],
  evidence: { sources: [], limitations: [], version: 1 } };
const state: any = { phase: "blocked", round: 1, requestId, digest, expiresAt: new Date(Date.now() + 3600000).toISOString() };
function run(report: any = {}) {
  const rawBody = JSON.stringify({ modelVersion: "gemini-4-argon", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 },
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ requestId, digest, report }) }] } }] });
  return { status: "response_received", requestId, digest,
    response: { rawBody, httpStatus: 200, responseHash: hashReportBytes(rawBody) } };
}
test("confirmed-invalid recovery proves retained bytes/model/binding and never repeats a valid response", () => {
  const original = run();
  assert.ok(inspectInvalidCompilerReply(input, state, original)?.diagnostics.length);
  for (const mutate of [(r: any) => r.response.httpStatus = 500, (r: any) => r.response.responseHash = "forged",
    (r: any) => r.digest = "wrong", (r: any) => r.response.rawBody = "{}"]) {
    const copy = structuredClone(original); mutate(copy);
    assert.equal(inspectInvalidCompilerReply(input, state, copy), null);
  }
  const valid = run({ sections: [{ heading: "Summary", blocks: [{ type: "recommendation", sourceIds: [],
    text: "Pilot a measured service improvement and verify costs, evidence, customer outcomes and implementation dependencies before expansion. ".repeat(2) }] }], unknowns: [] });
  assert.equal(inspectInvalidCompilerReply(input, state, valid), null, "A usable retained response is reuse-only, never new paid work");
  const malformed = run(), body = JSON.parse(malformed.response.rawBody);
  body.usageMetadata.thoughtsTokenCount = "unknown";
  malformed.response.rawBody = JSON.stringify(body);
  malformed.response.responseHash = hashReportBytes(malformed.response.rawBody);
  assert.equal(inspectInvalidCompilerReply(input, state, malformed), null, "Malformed thinking usage is uncertainty");
});

test("paid compiler correction requires the exact response and diagnostic grant and cannot repeat", async () => {
  const { child } = retainedCompanyReviewFixture();
  const input = child.payload.input, state = child.payload.state, jobId = child.id;
  delete input.paidJuryBatch; // This test isolates the compiler DB seam, never a live parent reservation.
  const prior = run(), recoveryId = "971159be-0a52-484d-9a26-14c139cfaa90";
  prior.requestId = state.requestId; prior.digest = state.digest;
  const body = JSON.parse(prior.response.rawBody);
  body.candidates[0].content.parts[0].text = JSON.stringify({ requestId: state.requestId, digest: state.digest, report: {} });
  prior.response.rawBody = JSON.stringify(body); prior.response.responseHash = hashReportBytes(prior.response.rawBody);
  const inspected = inspectInvalidCompilerReply(input, state, prior)!;
  const base = `compiler:1:${state.requestId}`;
  const liveState = { ...state, phase: "compiling", compilerRecoveryId: recoveryId };
  const payload: any = { ...child.payload, input, state: liveState, compilerRuns: { [base]: { ...prior, reservedMicros: 500_000 } },
    compilerRecoveryGrants: { [recoveryId]: { kind: "confirmed-invalid", jobId, tenantId: 1,
      requestId: state.requestId, digest: state.digest, round: 1, priorKey: base, priorResponseHash: inspected.responseHash,
      diagnosticHash: inspected.diagnosticHash, authorizedAt: new Date().toISOString(), maxAdditionalMicros: 2_000_000 } } };
  const dialect = new PgDialect();
  const database: any = { transaction: (fn: any) => fn({ execute: async (q: any) => {
    const { sql: query, params } = dialect.sqlToQuery(q);
    if (query.startsWith("SELECT")) return { rows: [{ payload }] };
    if (query.startsWith("UPDATE")) { payload.compilerRuns = JSON.parse(params[0] as string); return { rows: [] }; }
    throw new Error("Unexpected offline query");
  } }) };
  const grant = payload.compilerRecoveryGrants[recoveryId], correct = grant.diagnosticHash;
  grant.diagnosticHash = "forged";
  await assert.rejects(reserveReportCompiler(input, liveState, jobId, 1, .5, database), /authorization/);
  assert.equal(Object.keys(payload.compilerRuns).length, 1);
  grant.diagnosticHash = correct;
  assert.equal(retainedCompilerReviewMatches(payload, jobId), true);
  const checklist = liveState.correctionChecklist;
  liveState.correctionChecklist = [];
  await assert.rejects(reserveReportCompiler(input, liveState, jobId, 1, .5, database), /obligations/);
  liveState.correctionChecklist = checklist;
  await reserveReportCompiler(input, liveState, jobId, 1, .5, database);
  assert.equal(Object.keys(payload.compilerRuns).length, 2);
  await assert.rejects(reserveReportCompiler(input, liveState, jobId, 1, .5, database), /already claimed/);
});

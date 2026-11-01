import test from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_MODEL_SEATS, nextPackageSpend, reservePackageOperation, packageWindowOpen } from "../../server/lib/company-report-production";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import * as production from "../../server/lib/company-report-production";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { sanitizeAgentOutput } from "../../server/safety-layer";
import { guardReportArgonClient } from "../../server/lib/report-argon-route";
import { executeOwnerJuryApiCall } from "../../server/lib/owner-jury-api-route";
import OpenAI from "openai";
import { wrapClientWithParamAdaptation } from "../../server/lib/param-adaptation";

test("package GPT request uses completion tokens with SDK retries and parameter retries disabled", async () => {
  let calls = 0;
  // This injected transport cannot contact a provider or incur a charge.
  const client = wrapClientWithParamAdaptation(new OpenAI({ apiKey: "offline-fixture",
    maxRetries: 0, fetch: async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      if (body.max_tokens !== undefined) return new Response(JSON.stringify({ error: {
        message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
        type: "invalid_request_error", code: "unsupported_parameter", param: "max_tokens",
      } }), { status: 400, headers: { "content-type": "application/json" } });
      assert.equal(body.model, "gpt-5.4");
      assert.equal(body.max_completion_tokens, 8192);
      return new Response(JSON.stringify({ id: "offline", object: "chat.completion", created: 1,
        model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop",
          message: { role: "assistant", content: "Offline fixture only." } }] }),
        { headers: { "content-type": "application/json" } });
    } }));
  const messages: any = [{ role: "system", content: "Write a section." }, { role: "user", content: "Offline." }];
  await assert.rejects(client.chat.completions.create({ model: "gpt-5.4", messages, max_tokens: 8192 },
    { maxRetries: 0 }), (error: any) => error.status === 400);
  assert.equal(calls, 1, "the legacy request is not automatically repaired and retried");
  const request = (production as any).packageDraftRequest("readiness", messages);
  assert.equal((await client.chat.completions.create(request, { maxRetries: 0 })).model, "gpt-5.4");
  assert.equal(calls, 2, "the corrected request needs exactly one offline dispatch");
  assert.equal((production as any).packageDraftRequest("executive", messages).max_tokens, 8192);
});

test("draft failure diagnostics retain closed cause codes, not provider messages or secrets", () => {
  const failure = (production as any).packageDraftFailure({
    status: 400, code: "unsupported_parameter", param: "max_tokens",
    message: "Private provider message must not be retained",
  }, "request");
  assert.equal(failure.reason, "request-rejected");
  assert.equal(failure.status, 400);
  assert.equal(failure.code, "unsupported_parameter");
  assert.equal(failure.parameter, "max_tokens");
  assert.equal(failure.stage, "request");
  assert.doesNotMatch(JSON.stringify(failure), /Private provider/);
  const local = (production as any).packageDraftFailure(
    new Error("Argon requires the exact bounded owner report grant and output limit"), "request");
  assert.equal(local.boundary, "argon-contract");
  const untrusted = (production as any).packageDraftFailure({
    status: "400", code: "private-unrecognized-value", param: "private-unrecognized-value",
  }, "client");
  assert.equal(untrusted.reason, "uncertain");
  assert.equal(untrusted.status, undefined);
  assert.equal(untrusted.code, undefined);
  assert.equal(untrusted.parameter, undefined);
  assert.equal((production as any).packageDraftFailure(null, "request").reason, "uncertain");
});

test("package Gemini drafting satisfies the real bounded Argon guard without relaxing it", async () => {
  const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let calls = 0, reserved = false;
  const client = guardReportArgonClient({ chat: { completions: { create: async (params: any, options: any) => {
    assert.equal(reserved, true);
    assert.equal(params.max_tokens, 4096);
    assert.equal(params.max_completion_tokens, undefined);
    assert.deepEqual(params.provider, { allow_fallbacks: false, require_parameters: true });
    assert.equal(options.maxRetries, 0);
    calls++;
    return { model: PACKAGE_MODEL_SEATS.opportunities.model, choices: [] };
  } } } } as any, 1);
  try {
    const request = (production as any).packageDraftRequest("opportunities",
      [{ role: "system", content: "Write a report." }, { role: "user", content: "Offline fixture." }]);
    const run = (params: any) => executeOwnerJuryApiCall(1, "openrouter", request.model, "Offline fixture",
      { estimate: () => .1, ceiling: () => ({ spent: 0, ceiling: .1 }), reserve: () => { reserved = true; } },
      () => client.chat.completions.create(params), "bounded-report");
    // The failed live request never reaches the transport.
    await assert.rejects(run({ ...request, max_tokens: 8192, max_completion_tokens: undefined }), /output limit/);
    assert.equal(calls, 0);
    await run(request);
    assert.equal(calls, 1);
    await assert.rejects(client.chat.completions.create(request), /grant/);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
  }
});

test("verified source checksums use the established safe wire form without relaxing egress scanning", () => {
  const text = "The public page lists furnace and air-conditioning services.";
  const evidence: any = { version: 1, capturedAt: "2026-10-20", limitations: [], sources: [
    { id: "S1", kind: "public", title: "Service page", text, sha256: hashReportBytes(text) },
  ] };
  const wire = (production as any).packageEvidenceForWire(evidence);
  assert.equal(sanitizeAgentOutput(JSON.stringify(wire)).redacted, false);
  assert.equal(wire.sources[0].text, text);
  assert.notEqual(wire.sources[0].sha256, evidence.sources[0].sha256);
  assert.throws(() => (production as any).packageEvidenceForWire({ ...evidence,
    sources: [{ ...evidence.sources[0], sha256: "0".repeat(64) }] }), /hash mismatch/);
  const untrusted = { ...evidence, sources: [{ ...evidence.sources[0], text: "1".repeat(64), sha256: hashReportBytes("1".repeat(64)) }] };
  assert.equal(sanitizeAgentOutput(JSON.stringify((production as any).packageEvidenceForWire(untrusted))).redacted, true);
});

test("package model assignments use three distinct families and independent paid transports", () => {
  assert.equal(new Set(Object.values(PACKAGE_MODEL_SEATS).map(s => s.model)).size, 3);
  assert.deepEqual(new Set(Object.values(PACKAGE_MODEL_SEATS).map(s => s.lane)),
    new Set(["openai-api", "anthropic-api", "openrouter"]));
});

test("concurrent parent reservations serialize, deduplicate and refuse expired or foreign claims", async () => {
  const payload: any = { tenantId: 1, productionVersion: 2, processingWindowStartedAt: new Date().toISOString(), state: { phase: "drafting" },
    completionAdmission: { version: 1, priorKeys: [], bounds: { remainingDrafts: 1, initialSeats: 0, compilerRounds: 0, finalSeats: 0, aggregatePackets: 0 } } };
  let lease = new Date(Date.now() + 60_000);
  let queue = Promise.resolve();
  const dialect = new PgDialect();
  const db: any = { transaction: (work: any) => {
    const run = queue.then(() => work({ execute: async (query: any) => {
      const compiled = dialect.sqlToQuery(query);
      if (compiled.sql.startsWith("SELECT payload,status"))
        return { rows: [{ payload, status: "running", attempts: 2, lease_until: lease }] };
      if (compiled.sql.startsWith("UPDATE agent_jobs")) {
        payload.packageSpend = JSON.parse(compiled.params[0] as string);
        return { rows: [] };
      }
      throw new Error("Unexpected fixture query");
    } }));
    queue = run.catch(() => {});
    return run;
  } };
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
    reservePackageOperation(45, 1, "draft:one", 0.25, { parentAttempt: 2 }, { db })));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(Object.keys(payload.packageSpend).length, 1);
  lease = new Date(Date.now() - 100);
  await assert.rejects(reservePackageOperation(45, 1, "section:two", 0.25, { parentAttempt: 2 }, { db }), /lease lost/);
  await assert.rejects(reservePackageOperation(45, 2, "section:two", 0.25, { parentAttempt: 2 }, { db }), /denied/);
});

test("the processing window closes for child spend too, and resume must issue a fresh bounded window", () => {
  const now = Date.now();
  assert.equal(packageWindowOpen(new Date(now - 25 * 60 * 60_000).toISOString(), now), false);
  assert.equal(packageWindowOpen(new Date(now).toISOString(), now), true);
  assert.equal(packageWindowOpen(new Date(now + 1000).toISOString(), now), false);
  assert.equal(packageWindowOpen(undefined, now), false);
});

test("deferring the parent atomically preserves concurrent child paid claims", () => {
  const source = readFileSync("server/lib/company-report-package.ts", "utf8");
  const deferral = source.slice(source.indexOf("// A child may reserve spend"), source.indexOf("return { deferred: true }"));
  assert.match(deferral, /payload=jsonb_set\(payload,'\{state\}'/);
  assert.match(deferral, /lease_until>NOW\(\)/);
  assert.doesNotMatch(source, /deferJob\(|SELECT payload FROM[\s\S]{0,280}deferJob/);
});

test("compiler recovery reserves only for the exact live child revision and retained recovery ID", async () => {
  const parent = { payload: { tenantId: 1, productionVersion: 2,
    completionAdmission: { version: 1, priorKeys: [], bounds: { remainingDrafts: 0, initialSeats: 0, compilerRounds: 1, finalSeats: 0, aggregatePackets: 0 } },
    processingWindowStartedAt: new Date().toISOString(),
    state: { phase: "reviewing", intake: { company: "Fixture", website: "https://example.test/" },
      reports: { readiness: { jobId: 91, status: "pending" } } } }, status: "pending" };
  const child = { input: { orderId: "company-package:45:readiness", paidJuryBatch: "company-package:45",
    tenantId: 1, reportOnly: true, intake: parent.payload.state.intake },
    state: { phase: "compiling", round: 1, requestId: "request", compilerRecoveryId: "recovery-id" } };
  const dialect = new PgDialect();
  const db: any = { transaction: (work: any) => work({ execute: async (query: any) => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.startsWith("SELECT payload,status")) return { rows: [parent] };
    if (compiled.sql.startsWith("SELECT payload FROM")) return { rows: [{ payload: child }] };
    if (compiled.sql.startsWith("UPDATE agent_jobs")) return { rows: [] };
    throw new Error("Unexpected fixture query");
  } }) };
  await reservePackageOperation(45, 1, "review:91:compiler:1:request:recovery:recovery-id", 0.25,
    { childId: 91, childAttempt: 2, phaseKey: "compiler:1:request:recovery:recovery-id" }, { db });
  await assert.rejects(reservePackageOperation(45, 1, "review:wrong", 0.25,
    { childId: 91, childAttempt: 2, phaseKey: "compiler:1:request:recovery:wrong-id" }, { db }), /binding lost/);
  parent.payload.processingWindowStartedAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  await assert.rejects(reservePackageOperation(45, 1, "review:expired", 0.25,
    { childId: 91, childAttempt: 2, phaseKey: "compiler:1:request:recovery:recovery-id" }, { db }), /authority lost/);
});
test("package spend rejects duplicates, non-numbers and amounts beyond its bound", () => {
  const first = nextPackageSpend({}, "draft:a", 0.5);
  assert.throws(() => nextPackageSpend(first, "draft:a", 0.5), /already reserved/);
  for (const amount of [NaN, Infinity, -1, 0, "1", null, 31]) {
    assert.throws(() => nextPackageSpend(first, "draft:b", amount as number));
  }
  assert.equal(first["draft:a"], 500_000);
});

test("a paid draft retry needs exact owner recovery authority and cannot spend during research-only repair", async () => {
  const retryOf = "draft:readiness:prompt:gpt-5.4", recoveryId = "owner-recovery";
  const payload: any = { tenantId: 1, productionVersion: 2, processingWindowStartedAt: new Date().toISOString(),
    completionAdmission: { version: 1, priorKeys: [retryOf], bounds: { remainingDrafts: 1, initialSeats: 0, compilerRounds: 0, finalSeats: 0, aggregatePackets: 0 } },
    state: { phase: "drafting" }, packageSpend: { [retryOf]: 500000 },
    packageRecovery: { id: recoveryId, researchOnly: false, retryKeys: [retryOf] } };
  const dialect = new PgDialect();
  const db: any = { transaction: (work: any) => work({ execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.startsWith("SELECT payload,status")) return { rows: [{ payload, status: "running",
      attempts: 2, lease_until: new Date(Date.now() + 60000) }] };
    if (q.sql.startsWith("UPDATE agent_jobs")) { payload.packageSpend = JSON.parse(q.params[0] as string); return { rows: [] }; }
    throw Error("Unexpected fixture query");
  } }) };
  const key = `${retryOf}:recovery:${recoveryId}`;
  await assert.rejects(reservePackageOperation(50, 1, key, .5,
    { parentAttempt: 2, retryOf, recoveryId: "forged" }, { db }), /authority/);
  assert.equal(Object.keys(payload.packageSpend).length, 1);
  await reservePackageOperation(50, 1, key, .5, { parentAttempt: 2, retryOf, recoveryId }, { db });
  assert.equal(Object.values(payload.packageSpend).reduce((a: any, b: any) => a + b, 0), 1000000);
  await assert.rejects(reservePackageOperation(50, 1, key, .5,
    { parentAttempt: 2, retryOf, recoveryId }, { db }), /already reserved/);
  payload.researchOnly = true;
  await assert.rejects(reservePackageOperation(50, 1, "new-attempt", .5,
    { parentAttempt: 2 }, { db }), /authority lost/);
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { registerCompanyReportPackages } from "../../server/routes/company-report-packages";
import { newCompilationMatrix, compilationOperations } from "../../server/lib/company-compilation-matrix";
import { compilationRecoveryPlan } from "../../server/lib/company-compilation-recovery";

test("one company form durably starts v3 once; duplicate submit reuses job, conflicts and non-owner requests are refused", async () => {
  const dialect = new PgDialect();
  let job: any, inserts = 0, queries = 0;
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    queries++;
    const q = dialect.sqlToQuery(query), text = q.sql, params = q.params;
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (text.includes("payload->>'requestId'")) return { rows: job ? [job] : [] };
    if (text.includes("status IN ('pending','running')")) return { rows: job ? [job] : [] };
    if (text.includes("count(*)")) return { rows: [{ count: 0 }] };
    if (text.includes("INSERT INTO agent_jobs")) {
      inserts++;
      const payload = params.find(p => typeof p === "string" && p.startsWith('{"tenantId"'));
      assert.ok(payload);
      job = { id: 91, tenant_id: 1, kind: "company_report_package", status: "pending",
        created_at: "2026-10-20", payload: JSON.parse(String(payload)) };
      return { rows: [{ id: 91 }] };
    }
    if (text.includes("SELECT id,status,payload")) return { rows: job ? [job] : [] };
    throw new Error(`Unexpected offline query: ${text}`);
  } };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (req, res) => {
      if (req.headers["x-fixture-owner"] !== "yes") { res.status(403).json({ error: "Owner only" }); return null; }
      return 1;
    },
  }, { db, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 150, audioBudgetUsd: 5, notice: "Offline test" }) });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/company-report-packages`;
  const body = { requestId: "00000000-0000-4000-8000-000000000001", company: "Offline Company",
    website: "https://example.com", notes: "Customer support and new service ideas", acceptResearchCost: true,
    allowAutomaticCorrections: true };
  const send = (value: any, owner = true) => fetch(base, { method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { "x-fixture-owner": "yes" } : {}) }, body: JSON.stringify(value) });
  try {
    assert.equal((await send(body)).status, 202);
    assert.equal(job.payload.productionVersion, 3);
    assert.equal(job.payload.audioBudgetMicros, 5_000_000);
    assert.equal(job.payload.state.intake.notes, body.notes);
    assert.equal(job.payload.compilationCorrectionPolicy.maxPerOperation, 1);
    assert.equal(job.payload.compilationCorrectionPolicy.version, 1);
    assert.equal(job.payload.state.intake.allowAutomaticCorrections, undefined);
    assert.equal(job.payload.completionAdmission, undefined, "no legacy jury envelope");
    assert.equal((await (await send(body)).json()).id, 91);
    assert.equal(inserts, 1);
    assert.equal((await send({ ...body, company: "Different company" })).status, 409);
    assert.equal((await send({ ...body, website: "" })).status, 400);
    const count = queries;
    assert.equal((await send(body, false)).status, 403);
    assert.equal(queries, count, "unprivileged request never reaches storage");
    const status = await (await fetch(`${base}/91`, { headers: { "x-fixture-owner": "yes" } })).json();
    assert.deepEqual(status.compilationProgress, { authors: 0, syntheses: 0, delivered: 0, corrections: [],
      execution: "parallel-authors-per-category-synthesis", evidenceReferenceRecovery: [] });
    assert.equal(status.repairPlan, undefined, "no legacy jury-recovery control on new jobs");
    assert.equal(status.automaticCorrectionsApproved, true);
    const saved = structuredClone(job);
    job.payload.state.phase = "blocked";
    job.status = "succeeded";
    job.payload.state.error = "The one permitted corrective attempt did not complete acceptance. An uncertain claim requires reconciliation.";
    job.payload.state.compilation = { slots: { "author:readiness:gpt-5.4": {
      phase: "received", raw: {}, correction: { phase: "received", raw: {} },
    } } };
    const failedStatus = await (await fetch(`${base}/91`, { headers: { "x-fixture-owner": "yes" } })).json();
    assert.match(failedStatus.error, /received and saved.*did not pass/);
    assert.doesNotMatch(failedStatus.error, /uncertain/i, "legacy saved errors are presented from current durable receipts");
    assert.equal(failedStatus.canResume, false);
    job = saved;
    assert.equal((await send({ ...body, modelBudgetUsd: 200 })).status, 400);
    assert.equal((await send({ ...body, modelBudgetUsd: 200, allowAutomaticCorrections: undefined })).status, 400);
    job = undefined;
    assert.equal((await send({ ...body, allowAutomaticCorrections: undefined })).status, 202);
    assert.equal(job.payload.compilationCorrectionPolicy, undefined, "legacy clients do not silently approve paid correction");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("truncated replacement route requires exact owner approval, preserves spend, and deduplicates an active approved resume", async () => {
  const dialect = new PgDialect(), [gpt, argon] = compilationOperations();
  const matrix = newCompilationMatrix("same-intake-and-research");
  matrix.phase = "blocked";
  matrix.slots[gpt.key] = { phase: "complete", text: "retained", raw: { model: gpt.model } };
  matrix.slots[argon.key] = { phase: "received", raw: { model: argon.model,
    choices: [{ finish_reason: "length", message: { content: '{"incomplete":' } }] } };
  const job: any = { id: 91, tenant_id: 1, kind: "company_report_package", status: "succeeded", attempts: 7,
    payload: { tenantId: 1, productionVersion: 3, modelBudgetMicros: 150_000_000, audioBudgetMicros: 5_000_000,
      packageSpend: { [`matrix:${gpt.key}`]: 1, [`matrix:${argon.key}`]: 1 },
      state: { phase: "blocked", intake: { company: "Offline", website: "https://example.com" },
        research: { complete: true }, compilation: matrix, reports: {}, files: [] } } };
  const before = structuredClone(job);
  let updates = 0;
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.sql.includes("FOR UPDATE")) {
      assert.ok(q.sql.includes("tenant_id=")); assert.ok(q.params.includes(1));
      return { rows: [structuredClone(job)] };
    }
    if (q.sql.includes("status IN ('pending','running')")) return { rows: [] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=")) {
      updates++; job.payload = JSON.parse(String(q.params.find(p => typeof p === "string" && p.startsWith("{"))));
      job.status = "pending"; return { rows: [] };
    }
    throw new Error(`Unexpected query ${q.sql}`);
  } };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (req, res) => {
      if (req.headers["x-owner"] !== "yes") { res.status(403).json({ error: "Owner only" }); return null; }
      return 1;
    },
  }, { db, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 150, audioBudgetUsd: 5, notice: "Offline" }) });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/company-report-packages/91/resume`;
  const send = (value: any, owner = true) => fetch(base, { method: "POST", headers: {
    "Content-Type": "application/json", ...(owner ? { "x-owner": "yes" } : {}) }, body: JSON.stringify(value) });
  const approval = { acceptResearchCost: true, replaceTruncatedCompilation: true,
    snapshot: compilationRecoveryPlan(job).snapshot };
  try {
    assert.equal((await send(approval, false)).status, 403);
    assert.equal((await send({ acceptResearchCost: true })).status, 409, "ordinary Continue cannot loop on truncation");
    assert.equal((await send({ ...approval, acceptResearchCost: false })).status, 400);
    assert.equal((await send({ ...approval, snapshot: "0".repeat(64) })).status, 409);
    assert.deepEqual(job, before);
    assert.equal((await send(approval)).status, 202);
    assert.equal(updates, 1);
    assert.deepEqual(job.payload.packageSpend, before.payload.packageSpend);
    assert.deepEqual(job.payload.state.compilation.slots[gpt.key], before.payload.state.compilation.slots[gpt.key]);
    assert.deepEqual(job.payload.state.compilation.replacements[argon.key].raw, before.payload.state.compilation.slots[argon.key].raw);
    assert.equal((await send(approval)).status, 202, "same active approval is idempotent");
    assert.equal(updates, 1);
    Object.assign(job, structuredClone(before));
    assert.equal((await send({ acceptResearchCost: true, allowAutomaticCorrections: true })).status, 202);
    assert.equal(job.payload.compilationCorrectionPolicy.maxPerOperation, 1);
    assert.deepEqual(job.payload.state.compilation.slots[argon.key], before.payload.state.compilation.slots[argon.key],
      "automatic opt-in retains the original response in place");
    assert.equal(job.payload.state.compilation.replacements, undefined);
    assert.deepEqual(job.payload.packageSpend, before.payload.packageSpend);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

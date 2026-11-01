import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { registerCompanyReportPackages } from "../../server/routes/company-report-packages";
import { packageRecoveryPlan } from "../../server/lib/company-report-recovery";

test("real recovery handler rejects stale/type-confused approvals and accepts a click only once, without provider calls", async () => {
  const job: any = { id: 50, tenant_id: 1, status: "succeeded", attempts: 4,
    payload: { tenantId: 1, productionVersion: 2, digest: "fixture",
      state: { phase: "blocked", intake: { company: "Fixture", website: "https://example.test/" },
        reports: { readiness: { status: "error" } }, files: [],
        research: { complete: true, evidence: { capturedAt: "now", sources: [] }, map: {} } },
      packageSpend: { "draft:readiness:prompt:gpt-5.4": 500000 } } };
  const dialect = new PgDialect();
  let writes = 0;
  const db: any = { transaction: (work: any) => work({ execute: async (sql: any) => {
    const q = dialect.sqlToQuery(sql);
    if (q.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.sql.startsWith("SELECT id,tenant_id,payload,status,attempts")) return { rows: [structuredClone(job)] };
    if (q.sql.startsWith("SELECT id FROM agent_jobs")) return { rows: [] };
    if (q.sql.startsWith("UPDATE agent_jobs SET payload=")) {
      writes++; job.payload = JSON.parse(q.params[0] as string); job.status = "pending";
      return { rows: [] };
    }
    throw new Error("Unexpected offline fixture query; live DB is never used");
  } }) };
  db.execute = async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.startsWith("SELECT id,status,payload,created_at,attempts")) return { rows: [structuredClone(job)] };
    throw Error("Unexpected offline read");
  };
  const app = express(); app.use(express.json());
  let owner = true;
  registerCompanyReportPackages(app, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (_req, res) => {
      if (!owner) { res.status(403).json({ error: "Owner required" }); return null; }
      return 1;
    },
  }, { db, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 30, notice: "Offline" }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/admin/company-report-packages`;
  const post = (body: any) => fetch(`${base}/50/resume`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/preflight`)).status, 200);
    const preview: any = await (await fetch(`${base}/50`)).json();
    const snapshot = preview.recovery.snapshot;
    assert.equal(snapshot, packageRecoveryPlan(job).snapshot, "the actual GET preview binds the POST attempt counter");
    assert.equal((await post({ snapshot, acceptResearchCost: true, researchOnly: "false" })).status, 400);
    assert.equal((await post({ snapshot: "0".repeat(64), acceptResearchCost: true, confirmUncertainPaidRetry: true })).status, 409);
    const missingUncertaintyApproval = await post({ snapshot, acceptResearchCost: true });
    assert.equal(missingUncertaintyApproval.status, 409, await missingUncertaintyApproval.text());
    assert.equal(writes, 0);
    owner = false;
    assert.equal((await post({ snapshot, acceptResearchCost: true, confirmUncertainPaidRetry: true })).status, 403);
    owner = true;
    const approval = { snapshot, acceptResearchCost: true, confirmUncertainPaidRetry: true };
    assert.equal((await post(approval)).status, 202);
    assert.equal((await post(approval)).status, 202);
    assert.equal(writes, 1);
    assert.equal(job.payload.packageSpend["draft:readiness:prompt:gpt-5.4"], 500000);
    assert.equal(job.payload.packageRecovery.retryKeys.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("the owner recovery route preserves pre-dispatch jury audits and all spending when reinitializing an unspent child", async () => {
  const input = { tenantId: 1, kind: "executive", orderId: "company-package:50:executive",
    paidJuryBatch: "company-package:50", reportOnly: true, modelId: "fixture", customerEmail: "",
    intake: { company: "Fixture", website: "https://example.test/" },
    evidence: { version: 1, capturedAt: "now", sources: [], limitations: [] }, sections: [] };
  const child: any = { status: "failed_terminal", payload: { input,
    state: { phase: "blocked", stopReason: "Report initial jury blocked: verdict=ESCALATE, successful votes=0/3; owner review required; no customer delivery",
      juryHistory: [{ verdict: "ESCALATE" }] },
    paidJuryRuns: { initial: { proposers: [{ ok: false }, { ok: false }, { ok: false }] } },
    reportJuryRuns: { initial: { events: [] } } } };
  const originalChild = structuredClone(child.payload);
  const job: any = { id: 50, status: "succeeded", attempts: 9, payload: {
    tenantId: 1, digest: "fixture", productionVersion: 2, packageSpend: { "draft:executive:fixture": 500000 },
    state: { phase: "blocked", intake: input.intake, reports: { executive: { jobId: 7, status: "error" } },
      files: [], research: { complete: true, evidence: input.evidence, map: {} } } } };
  const dialect = new PgDialect();
  let childWrites = 0;
  const db: any = { transaction: (work: any) => work({ execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("pg_advisory_xact_lock") || q.sql.startsWith("SELECT id FROM agent_jobs")) return { rows: [] };
    if (q.sql.startsWith("SELECT id,tenant_id,payload,status,attempts")) return { rows: [structuredClone(job)] };
    if (q.sql.startsWith("SELECT payload,status")) return { rows: [structuredClone(child)] };
    if (q.sql.startsWith("UPDATE agent_jobs SET payload=")) {
      const payload = JSON.parse(q.params[0] as string);
      if (q.params[1] === 7) { child.payload = payload; child.status = "pending"; childWrites++; }
      else { job.payload = payload; job.status = "pending"; }
      return { rows: [] };
    }
    throw Error("Unexpected offline query");
  } }) };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, { authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async () => 1 }, { db,
    configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 30, notice: "Offline" }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address() as { port: number };
    const approval = { snapshot: packageRecoveryPlan(job).snapshot, acceptResearchCost: true, confirmUncertainPaidRetry: true };
    const post = () => fetch(`http://127.0.0.1:${address.port}/api/admin/company-report-packages/50/resume`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approval) });
    const resumed = await post();
    assert.equal(resumed.status, 202, await resumed.text());
    assert.equal((await post()).status, 202);
    assert.equal(childWrites, 1);
    assert.equal(child.payload.state.phase, "initial_jury");
    assert.deepEqual(child.payload.paidJuryRuns, {});
    assert.deepEqual(child.payload.packageRecoveryHistory[0].paidJuryRuns, originalChild.paidJuryRuns);
    assert.deepEqual(child.payload.packageRecoveryHistory[0].reportJuryRuns, originalChild.reportJuryRuns);
    assert.deepEqual(job.payload.packageSpend, { "draft:executive:fixture": 500000 });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

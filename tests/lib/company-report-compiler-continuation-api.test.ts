import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { registerCompanyReportPackages } from "../../server/routes/company-report-packages";
import { compilerContinuationPlan } from "../../server/lib/company-report-compiler-continuation";
import { retainedCompanyReviewFixture } from "../helpers/retained-company-review";

test("owner continuation requires exact fresh approval and preserves paid votes/claims without dispatching providers", async () => {
  const { parent, child } = retainedCompanyReviewFixture();
  const original = structuredClone({ parent, child });
  const dialect = new PgDialect();
  let writes = 0, owner = true;
  const execute = async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.sql.startsWith("SELECT id FROM agent_jobs")) return { rows: [] };
    if (q.sql.includes("WHERE id IN (")) {
      assert.ok(q.params.includes(1), "the child query binds the owner's tenant");
      return { rows: [structuredClone(child)] };
    }
    if (q.sql.startsWith("SELECT id,tenant_id,kind,status,attempts,payload") ||
        q.sql.startsWith("SELECT id,status,payload,created_at,attempts")) return { rows: [structuredClone(parent)] };
    if (q.sql.startsWith("UPDATE agent_jobs SET payload=")) {
      writes++;
      const target = q.params[1] === 7 ? child : parent;
      target.payload = JSON.parse(q.params[0] as string); target.status = "pending";
      return { rows: [{ id: target.id }] };
    }
    throw Error("Unexpected offline SQL; no live database is available");
  };
  const db: any = { execute, transaction: (work: any) => work({ execute }) };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (_req, res) => { if (!owner) { res.status(403).json({ error: "Owner required" }); return null; } return 1; },
  }, { db, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 30, notice: "Offline" }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/admin/company-report-packages/50`;
  const post = (body: any) => fetch(`${url}/continue-reviewed`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const snapshot = compilerContinuationPlan(parent, [child]).snapshot;
    assert.equal((await post({ snapshot, acceptResearchCost: "true" })).status, 400);
    assert.equal((await post({ snapshot })).status, 400);
    assert.equal((await post({ snapshot: "a".repeat(64), acceptResearchCost: true })).status, 409);
    assert.equal(writes, 0);
    owner = false;
    assert.equal((await post({ snapshot, acceptResearchCost: true })).status, 403);
    owner = true;
    const preview: any = await (await fetch(url)).json();
    assert.equal(preview.reviewContinuation.snapshot, snapshot);
    assert.equal(preview.reviewContinuation.available, true);
    const approval = { snapshot, acceptResearchCost: true };
    assert.equal((await post(approval)).status, 202);
    assert.equal((await post(approval)).status, 202);
    assert.equal(writes, 2, "a double click schedules each job only once");
    assert.equal(child.payload.state.phase, "wait_muse");
    assert.equal(parent.payload.state.phase, "reviewing");
    assert.equal(parent.payload.state.reports.executive.status, "pending");
    assert.deepEqual(child.payload.input, original.child.payload.input);
    assert.deepEqual(child.payload.paidJuryRuns, original.child.payload.paidJuryRuns);
    assert.deepEqual(child.payload.reportJuryRuns, original.child.payload.reportJuryRuns);
    assert.deepEqual(child.payload.state.correctionChecklist, original.child.payload.state.correctionChecklist);
    assert.equal(child.payload.state.requestId, original.child.payload.state.requestId);
    assert.equal(child.payload.state.digest, original.child.payload.state.digest);
    assert.deepEqual(parent.payload.packageSpend, original.parent.payload.packageSpend);
    assert.deepEqual(child.payload.packageCompilerContinuationHistory[0].state, original.child.payload.state);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

/** Retained private CSV; real PostgreSQL JSONB round trips, fake job storage,
 * fake providers and fake delivery only. Never mutates the saved live package. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { db as postgres, pool } from "../server/db";
import { registerCompanyReportPackages } from "../server/routes/company-report-packages";
import { advanceCompanyCompilation } from "../server/lib/company-package-v3";
import { acceptCompilation, COMPANY_HEADINGS } from "../server/lib/company-compilation-content";
import { compilationOperations } from "../server/lib/company-compilation-matrix";
import { requestCompanyCompilation } from "../server/lib/company-compilation-runtime";
import { reservePackageOperation } from "../server/lib/company-report-production";
import { canReconcileUnspentCompilation, UNSPENT_COMPILATION_RECONCILIATION as binding } from "../server/lib/company-compilation-unspent-recovery";

async function main() {
  const csv = readFileSync(process.argv[2], "utf8");
  assert.ok(csv.startsWith('payload\n"') && csv.trimEnd().endsWith('"'), "Expected exact private one-column CSV");
  const original = JSON.parse(csv.trimEnd().slice('payload\n"'.length, -1).replace(/""/g, '"'));
  const roundTrip = async (value: any) => {
    const result: any = await postgres.execute(sql`SELECT ${JSON.stringify(value)}::jsonb AS value`);
    return (result.rows || result)[0].value;
  };
  let payload = await roundTrip(original);
  let job: any = { id: binding.jobId, tenant_id: 1, tenantId: 1, kind: "company_report_package",
    status: "succeeded", attempts: 12, payload };
  assert.equal(canReconcileUnspentCompilation(job), true, "Exact retained claim must match source-owned reconciliation");
  const preserved = JSON.stringify(original.state.compilation.slots);
  const legacyClaim = JSON.stringify(original.state.compilation.slots[binding.operation].correction);
  const dialect = new PgDialect();
  let reservations = 0, updates = 0, calls = 0, published = 0;
  const fakeDb: any = { transaction: async (fn: any) => fn(fakeDb), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.sql.includes("SELECT payload,status,attempts,lease_until")) return { rows: [{
      payload: await roundTrip(payload), status: job.status, attempts: job.attempts,
      lease_until: new Date(Date.now() + 60_000),
    }] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=jsonb_set")) {
      reservations++;
      payload.packageSpend = await roundTrip(JSON.parse(q.params.find(v => typeof v === "string" && v.startsWith("{")) as string));
      return { rows: [] };
    }
    if (q.sql.includes("FOR UPDATE")) return { rows: [{ ...job, payload: await roundTrip(payload) }] };
    if (q.sql.includes("status IN ('pending','running')"))
      return { rows: ["pending", "running"].includes(job.status) ? [job] : [] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=")) {
      updates++; payload = await roundTrip(JSON.parse(q.params.find(v => typeof v === "string" && v.startsWith("{")) as string));
      job.status = "pending"; return { rows: [] };
    }
    if (q.sql.includes("SELECT id,status,payload")) return { rows: [{ ...job, payload }] };
    throw new Error(`Unexpected offline query: ${q.sql}`);
  } };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, { authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (req, res) => {
      if (req.headers["x-offline-owner"] !== "yes") { res.status(403).end(); return null; }
      return 1;
    } }, { db: fakeDb, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 150, audioBudgetUsd: 5, notice: "OFFLINE" }) });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/company-report-packages/${binding.jobId}`;
  const headers = { "Content-Type": "application/json", "x-offline-owner": "yes" };
  const resume = (owner: boolean) => fetch(`${base}/resume`, { method: "POST",
    headers: owner ? headers : { "Content-Type": "application/json" }, body: JSON.stringify({ acceptResearchCost: true }) });
  const priorFlag = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  try {
    assert.equal((await resume(false)).status, 403);
    const status = await (await fetch(base, { headers })).json();
    assert.equal(status.canResume, true); assert.ok(/not sent/.test(status.error), "Projection must describe the unsent claim");
    assert.equal(status.compilationProgress.authors, 8);
    assert.equal((await resume(true)).status, 202);
    assert.equal(updates, 1); assert.equal(calls, 0); assert.equal(reservations, 0);
    assert.ok(JSON.stringify(payload.packageSpend) === JSON.stringify(original.packageSpend), "Resume must preserve spending");
    assert.equal((await resume(true)).status, 409);
    job = { ...job, status: "running", payload: await roundTrip(payload) };
    const state = job.payload.state;
    assert.ok(JSON.stringify(state.compilation.slots[binding.operation].reconciledUnspentClaim) === legacyClaim,
      "Resume must preserve the prior unsent claim");
    const valid = (op: ReturnType<typeof compilationOperations>[number]) => ({
      model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: Array.from({ length: 3 }, () => ({
          type: "recommendation", text: "Assign an owner to measure the pilot before expansion. ".repeat(op.stage === "synthesis" ? 20 : 15), sourceIds: [],
        })) })), unknowns: ["Verify staffing before implementing the recommendation."],
      }) } }],
    });
    const checkpoint = async () => { payload.state = (await roundTrip({ state })).state; };
    const request = (op: any, drafts: string[], correction?: any) =>
      requestCompanyCompilation(job, state, op, drafts, async () => {}, {
        reserve: ((...args: Parameters<typeof reservePackageOperation>) =>
          reservePackageOperation(args[0], args[1], args[2], args[3], args[4], { db: fakeDb })) as any,
        getClientForModel: (async () => ({ actualModelId: op.model, client: { chat: { completions: {
          create: async () => { calls++; return valid(op); },
        } } } })) as any,
      }, correction);
    const ports = { checkpoint, request: (op: any, drafts: string[]) => request(op, drafts),
      correct: (op: any, drafts: string[], raw: unknown, check: string) => request(op, drafts, { original: raw, check }),
      accept: (op: any, raw: unknown) => acceptCompilation(state, op, raw),
      publish: async (kind: any) => { published++; return { key: `${kind}-full`, filename: `${kind}.pdf`, label: kind, category: "full" as const,
        audioUrl: "https://drive.google.com/file/d/offlineaudio1234/view", pdfUrl: "https://drive.google.com/file/d/offlinepdf12345/view" }; },
      publishTeaser: async () => ({ key: "teaser-pack", filename: "teaser.pdf", label: "OFFLINE", category: "teaser" as const,
        pdfUrl: "https://drive.google.com/file/d/offlineteaser123/view" }),
    };
    for (let i = 0; i < 10; i++) await advanceCompanyCompilation(state, ports);
    assert.equal(state.phase, "done"); assert.equal(calls, 4); assert.equal(reservations, 4); assert.equal(published, 3);
    const slot = state.compilation.slots[binding.operation];
    assert.equal(slot.correction.digestVersion, 2); assert.equal(slot.correction.phase, "complete");
    for (const [key, before] of Object.entries(original.state.compilation.slots) as [string, any][]) {
      assert.ok(JSON.stringify(state.compilation.slots[key].raw) === JSON.stringify(before.raw),
        "Every original response must remain unchanged");
      if (key !== binding.operation) assert.ok(JSON.stringify(state.compilation.slots[key]) === JSON.stringify(before),
        "Accepted drafts must remain unchanged");
    }
    assert.ok(JSON.stringify(slot.reconciledUnspentClaim) === legacyClaim, "Archived claim must remain unchanged");
    const key = `matrix:${binding.operation}:correction:${slot.correction.originalDigest}`;
    // Restore only the live pre-acceptance phase in fake storage to verify the
    // spending barrier itself rejects a duplicate, not merely completed-state checks.
    payload.state.phase = "drafting"; payload.state.compilation.slots[binding.operation].phase = "received";
    payload.state.compilation.slots[binding.operation].correction.phase = "claimed";
    delete payload.state.compilation.slots[binding.operation].correction.raw;
    await assert.rejects(reservePackageOperation(job.id, 1, key, 1, { parentAttempt: 12 }, { db: fakeDb }), /already reserved/);
    assert.equal(calls, 4); assert.equal(reservations, 4);
    assert.ok(JSON.stringify(original.state.compilation.slots) === preserved, "Source receipts must remain unchanged");
    assert.ok(readFileSync(process.argv[2], "utf8") === csv, "Private checkpoint must remain unchanged");
    console.log("PASS: exact private live checkpoint + real PostgreSQL JSONB, owner-only resume, no spend at reconciliation, original/old claim preserved, one fake correction + three fake syntheses, three fake PDF/audio pairs + teaser, duplicate reservation rejected. NO LIVE RECOVERY.");
  } finally {
    if (priorFlag === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED; else process.env.OWNER_JURY_DIRECT_API_ENABLED = priorFlag;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(() => {
  // Assertion diffs and JSON/parser/provider errors can contain private retained
  // prose. Never emit them to captured workflow output, even on setup failure.
  console.error("Offline unspent-correction replay failed. Private checkpoint values and errors were not logged.");
  process.exitCode = 1;
}).finally(() => pool.end());

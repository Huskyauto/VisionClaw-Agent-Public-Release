/** Private retained checkpoint + fake API/provider/delivery only. Never live spend. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { initialPackage } from "../server/lib/company-report-package-core";
import { advanceCompanyCompilation } from "../server/lib/company-package-v3";
import { compilationOperations } from "../server/lib/company-compilation-matrix";
import { COMPANY_HEADINGS, acceptCompilation } from "../server/lib/company-compilation-content";
import { registerCompanyReportPackages, canResumeCompilation } from "../server/routes/company-report-packages";
import { requestCompanyCompilation } from "../server/lib/company-compilation-runtime";
import { reservePackageOperation } from "../server/lib/company-report-production";
import { canApproveTargetedRepair, hasTargetedRepairApproval, targetedRepairSpendKey,
  TARGETED_COMPILATION_REPAIR_GRANT as grant } from "../server/lib/company-compilation-targeted-repair";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Supply a privately retained read-only checkpoint");
  const source = readFileSync(path, "utf8"), retained = JSON.parse(source);
  const state: any = { ...initialPackage(retained.intake), research: retained.research,
    compilation: retained.compilation, phase: "blocked" };
  const originalMatrix = JSON.stringify(state.compilation);
  const originalReceipts = JSON.stringify(state.compilation.slots[grant.operation]);
  let job: any = { id: grant.jobId, tenant_id: 1, tenantId: 1, kind: "company_report_package",
    status: "succeeded", attempts: 1, payload: { tenantId: 1, productionVersion: 3,
      modelBudgetMicros: retained.modelBudgetMicros, packageSpend: retained.packageSpend,
      state, audioBudgetMicros: 5_000_000,
      compilationCorrectionPolicy: { version: 1, maxPerOperation: 1, approvedAt: "2026-10-21" },
    } };
  assert.equal(canApproveTargetedRepair(job), true, "exact production checkpoint must match compiled authority");
  assert.equal(canResumeCompilation(job), true);
  let payload = JSON.parse(JSON.stringify(job.payload)), updates = 0, reserved = 0, providerCalls = 0;
  const dialect = new PgDialect();
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (q.sql.includes("SELECT payload,status,attempts,lease_until"))
      return { rows: [{ payload, status: job.status, attempts: 1, lease_until: new Date(Date.now() + 60_000) }] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=jsonb_set")) {
      reserved++;
      payload.packageSpend = JSON.parse(String(q.params.find(v => typeof v === "string" && v.startsWith("{"))));
      return { rows: [] };
    }
    if (q.sql.includes("FOR UPDATE")) return { rows: [{ ...job, payload: JSON.parse(JSON.stringify(payload)) }] };
    if (q.sql.includes("status IN ('pending','running')")) return { rows: ["pending", "running"].includes(job.status) ? [job] : [] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=")) {
      updates++;
      payload = JSON.parse(String(q.params.find(v => typeof v === "string" && v.startsWith("{"))));
      job.status = "pending"; return { rows: [] };
    }
    if (q.sql.includes("SELECT id,status,payload")) return { rows: [{ ...job, payload }] };
    throw new Error(`Unexpected offline query: ${q.sql}`);
  } };
  const app = express(); app.use(express.json());
  registerCompanyReportPackages(app, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    requireAdmin: async (req, res) => {
      if (req.headers["x-offline-owner"] !== "yes") { res.status(403).json({ error: "Owner only" }); return null; }
      return 1;
    },
  }, { db, configuration: () => ({ ready: true, issues: [], models: [], modelBudgetUsd: 150,
    audioBudgetUsd: 5, notice: "OFFLINE" }) });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/company-report-packages/${grant.jobId}`;
  const send = (owner: boolean) => fetch(`${base}/resume`, { method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { "x-offline-owner": "yes" } : {}) },
    body: JSON.stringify({ acceptResearchCost: true }) });
  const valid = (op: ReturnType<typeof compilationOperations>[number]) => ({
    model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: Array.from({ length: 3 }, () => ({
        type: "recommendation", text: "Assign an owner to measure the pilot before expansion. ".repeat(15), sourceIds: [],
      })) })), unknowns: ["Verify staffing before implementing this recommendation."],
    }) } }],
  });
  const checkpoint = async () => { payload.state = JSON.parse(JSON.stringify(job.payload.state)); };
  const priorFlag = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  try {
    assert.equal((await send(false)).status, 403);
    assert.equal(updates, 0);
    const projected = await (await fetch(base, { headers: { "x-offline-owner": "yes" } })).json();
    assert.equal(projected.targetedRepair.available, true);
    assert.equal((await send(true)).status, 202);
    assert.equal(updates, 1);
    assert.equal((await send(true)).status, 409, "active work is not requeued");
    job = { ...job, status: "running", payload: JSON.parse(JSON.stringify(payload)), tenantId: 1 };
    assert.equal(hasTargetedRepairApproval(job), true);
    const rawSlotsBefore = JSON.stringify(job.payload.state.compilation.slots);
    assert.equal(rawSlotsBefore, JSON.stringify(retained.compilation.slots), "resume does not rewrite receipts");
    let otherCalls = 0, publications = 0;
    const ports = {
      checkpoint,
      request: async (op: any) => { otherCalls++; return valid(op); },
      accept: (op: any, raw: unknown) => acceptCompilation(job.payload.state, op, raw),
      targetedRepair: { operation: grant.operation,
        request: (op: any, drafts: string[], original: unknown, check: string) =>
          requestCompanyCompilation(job, job.payload.state, op, drafts, async () => {}, {
            reserve: (async (...args: Parameters<typeof reservePackageOperation>) =>
              reservePackageOperation(args[0], args[1], args[2], args[3], args[4], { db })) as any,
            getClientForModel: (async () => ({ actualModelId: op.model, client: { chat: { completions: {
              create: async (params: any, options: any) => {
                providerCalls++;
                await assert.rejects(reservePackageOperation(job.id, 1, targetedRepairSpendKey(), 1,
                  { parentAttempt: 1 }, { db }), /already reserved/, "duplicate reservation is rejected before another dispatch");
                const input = JSON.parse(params.messages[1].content);
                assert.equal(params.messages.length, 2);
                assert.equal(options.maxRetries, 0);
                assert.equal(input.outputBudget.targetMaxJsonCharacters, 18_000);
                assert.ok(input.correctionFeedback.measuredSize.characters > 25_000);
                assert.ok(input.correctionFeedback.measuredSize.sections.length === 6);
                return valid(op);
              },
            } } } })) as any,
          }, { original, check, targetedRepair: true }),
      },
      publish: async (kind: any) => {
        publications++;
        return { key: `${kind}-full`, filename: `${kind}.pdf`, label: kind, category: "full" as const,
          audioUrl: "https://drive.google.com/file/d/offlineaudio1234/view",
          pdfUrl: "https://drive.google.com/file/d/offlinepdf12345/view" };
      },
      publishTeaser: async () => ({ key: "teaser-pack", filename: "teaser.pdf", label: "OFFLINE",
        category: "teaser" as const, pdfUrl: "https://drive.google.com/file/d/offlineteaser123/view" }),
    };
    for (let i = 0; i < 16; i++) await advanceCompanyCompilation(job.payload.state, ports);
    assert.equal(job.payload.state.phase, "done");
    assert.equal(providerCalls, 1);
    assert.equal(reserved, 1);
    assert.equal(otherCalls, 11);
    assert.equal(publications, 3);
    const slot = job.payload.state.compilation.slots[grant.operation];
    const savedSlot = JSON.parse(originalReceipts);
    assert.equal(JSON.stringify(slot.raw), JSON.stringify(savedSlot.raw));
    assert.equal(JSON.stringify(slot.correction), JSON.stringify(savedSlot.correction));
    assert.ok(payload.packageSpend[targetedRepairSpendKey()] > 0);
    assert.ok(Object.values(payload.packageSpend).reduce((a: number, b: any) => a + b, 0) <= 150_000_000);
    assert.equal(canApproveTargetedRepair({ ...job, status: "succeeded" }), false);
    await advanceCompanyCompilation(job.payload.state, ports);
    assert.equal(providerCalls, 1);
    assert.equal(readFileSync(path, "utf8"), source);
    assert.equal(JSON.stringify(retained.compilation), originalMatrix);
    console.log("PASS: exact retained production checkpoint, owner-only resume, one fake bounded repair reservation/dispatch, unchanged original/correction receipts, 11 remaining fake model steps, three fake report/audio pairs and teaser, no replay purchase. NO LIVE RECOVERY CLAIM.");
  } finally {
    if (priorFlag === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = priorFlag;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Offline replay failed"); process.exitCode = 1; });

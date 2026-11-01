import type { Express, Request, Response } from "express";
import { z } from "zod";
import { compilationRecoveryPlan, approveCompilationReplacement } from "../lib/company-compilation-recovery";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db as defaultDb } from "../db";
import { PACKAGE_JOB_KIND, packageFile } from "../lib/company-report-package";
import { initialPackage, isPackageFileKey, type PackageState } from "../lib/company-report-package-core";
import { packageConfiguration } from "../lib/company-report-preflight";
import { approvePackageRecovery, packageRecoveryPlan, canRestartUnspentPackageReview } from "../lib/company-report-recovery";
import { compilerContinuationPlan } from "../lib/company-report-compiler-continuation";
import { registerCompilerContinuation, loadCompilerContinuationChildren } from "./company-report-compiler-continuation";
import { approvePackageRepair, packageRepairPlan } from "../lib/company-package-repair";
import { compilationOperations } from "../lib/company-compilation-matrix";
import { websiteFromBusinessEmail } from "../../shared/company-report-intake";
import { compilationReceiptDigest, hasCompilationCorrectionApproval } from "../lib/company-compilation-correction-policy";
import { isTruncatedCompilation } from "../lib/company-compilation-recovery";
import { acceptCompilation } from "../lib/company-compilation-content";
import { compilationCorrectionStopReason } from "../lib/company-compilation-checks";
import { canApproveTargetedRepair, approveTargetedRepair, hasTargetedRepairApproval,
  TARGETED_COMPILATION_REPAIR_GRANT, targetedRepairSpendKey } from "../lib/company-compilation-targeted-repair";
import { canReconcileUnspentCompilation, reconcileUnspentCompilation,
  UNSPENT_COMPILATION_RECONCILIATION } from "../lib/company-compilation-unspent-recovery";

export const companyPackageBody = z.object({
  requestId: z.string().uuid(), company: z.string().trim().min(1).max(200),
  website: z.string().trim().url().max(300).refine(value => {
    try {
      const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search;
    } catch { return false; }
  }, "Use a public website URL without credentials or query parameters").or(z.literal("")).optional().default(""),
  principalName: z.string().trim().max(120).optional(), industry: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  crm: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional(),
  intakeText: z.string().max(20_000).optional(), acceptResearchCost: z.literal(true),
  allowAutomaticCorrections: z.literal(true).optional(),
  modelBudgetUsd: z.number().int().min(10).max(150).default(150),
}).refine(value => !value.allowAutomaticCorrections || value.modelBudgetUsd <= 150,
  "Automatic corrections require a model allowance no higher than $150.")
  .refine(value => !!value.website || !!websiteFromBusinessEmail(value.contactEmail),
  "Supply the public company website or a business-domain email; personal email needs a website.")
  .transform(value => ({ ...value, website: value.website || websiteFromBusinessEmail(value.contactEmail)! }))
  .refine(value => Buffer.byteLength(JSON.stringify(value)) <= 30_000, "Company information exceeds the safe input limit.");
const rows = (r: any) => r.rows || r;
const resumeBody = z.object({ snapshot: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  acceptResearchCost: z.literal(true).optional(), confirmUncertainPaidRetry: z.boolean().optional(),
  researchOnly: z.boolean().optional(), replaceTruncatedCompilation: z.literal(true).optional(),
  allowAutomaticCorrections: z.literal(true).optional() }).strict();
function projection(job: any) {
  const state = job.payload.state as PackageState;
  const savedError = state.error || null;
  const unspent = canReconcileUnspentCompilation(job);
  const error = unspent
    ? "The correction was not sent. A saved-response identity check stopped it before spending. Continue reuses saved work and the existing correction approval."
    : state.phase === "blocked" && savedError?.startsWith("The one permitted corrective attempt")
    ? savedError.replace("An uncertain claim requires reconciliation.",
      compilationCorrectionStopReason(Object.values(job.payload.state.compilation?.slots ?? {})))
    : savedError;
  return { id: job.id, status: state.phase === "done" ? "done" : state.phase === "blocked" ? "error"
    : ["failed", "failed_terminal", "cancelled"].includes(job.status) ? "error" : job.status === "running" ? "running" : "pending",
    phase: state.phase, company: state.intake.company, website: state.intake.website, error,
    createdAt: job.created_at, files: state.files, coverage: state.research?.coverage,
    reports: state.reports, emailSummary: state.emailSummary,
    productionVersion: job.payload.productionVersion,
    automaticCorrectionsApproved: hasCompilationCorrectionApproval(job.payload),
    canResumeWithAutomaticCorrections: canResumeCompilation(job, true),
    targetedRepair: job.payload.productionVersion === 3 ? {
      available: canApproveTargetedRepair(job),
      phase: job.payload.state.compilation?.slots?.[TARGETED_COMPILATION_REPAIR_GRANT.operation]?.targetedRepair?.phase,
    } : undefined,
     compilationProgress: job.payload.productionVersion === 3 ? {
       execution: "parallel-authors-per-category-synthesis",
       evidenceReferenceRecovery: Object.entries(job.payload.state.compilation?.slots ?? {}).flatMap(([operation, slot]: [string, any]) => {
         const op = compilationOperations().find(op => op.key === operation);
         if (!op) return [];
         try {
           const accepted = JSON.parse(acceptCompilation(state, op, slot.targetedRepair?.raw ?? slot.correction?.raw ?? slot.raw));
           return accepted.evidenceDerivations?.length ? [{ operation,
             status: slot.phase === "complete" ? "applied" : "available",
             note: "An exact saved research limitation can be labeled and cited from its retained evidence. Original model responses remain unchanged; this conversion requires no model call." }] : [];
         } catch { return []; }
       }),
      authors: compilationOperations().filter(op => op.stage === "author" &&
        job.payload.state.compilation?.slots?.[op.key]?.phase === "complete").length,
      syntheses: compilationOperations().filter(op => op.stage === "synthesis" &&
        job.payload.state.compilation?.slots?.[op.key]?.phase === "complete").length,
      delivered: Object.values(state.reports).filter(report => report?.status === "done").length,
      corrections: Object.entries(job.payload.state.compilation?.slots ?? {}).flatMap(([operation, slot]: [string, any]) =>
         slot.correction ? [{ operation, phase: slot.correction.phase, check: slot.correction.check,
           resolved: slot.phase === "complete", notDispatched: unspent && operation === UNSPENT_COMPILATION_RECONCILIATION.operation }] : []),
    } : undefined,
     audioProgress: job.payload.productionVersion === 3 ? Object.entries(job.payload.state.publication ?? {}).map(
       ([kind, value]: [string, any]) => ({ kind, stage: value.stage,
         savedChunks: Object.values(value.chunks ?? {}).filter((chunk: any) => !!chunk.sha).length,
         totalChunks: value.totalChunks })) : undefined,
    compilationRecovery: job.payload.productionVersion === 3 ? compilationRecoveryPlan(job) : undefined,
    canResume: job.payload.productionVersion === 3 ? canResumeCompilation(job) : canResumePackage(job),
    recovery: job.payload.productionVersion === 3 ? undefined : packageRecoveryPlan(job) };
}
export function canResumeCompilation(job: any, optIn = false): boolean {
  const targetedAvailable = canApproveTargetedRepair(job);
  const unspent = canReconcileUnspentCompilation(job);
  const correctionAllowed = hasCompilationCorrectionApproval(job.payload) ||
    optIn && hasCompilationCorrectionApproval({ ...job.payload, compilationCorrectionPolicy: {
      version: 1, maxPerOperation: 1, approvedAt: new Date().toISOString(),
    } });
  return job.payload?.productionVersion === 3 && job.payload.state?.phase === "blocked" &&
    job.tenant_id === 1 && job.payload.tenantId === 1 &&
    !["pending", "running", "cancelled"].includes(job.status) &&
    !(job.payload.state.research?.map as any)?.overflow &&
     Object.entries(job.payload.state.compilation?.slots || {}).every(([key, slot]: [string, any]) => {
        if (unspent && key === UNSPENT_COMPILATION_RECONCILIATION.operation) return true;
       const spend = job.payload.packageSpend ?? {};
       const knownUnspentCorrection = correctionAllowed && slot.correction?.phase === "claimed" &&
         slot.correction.preflightRejected === true &&
         slot.correction.originalDigest === compilationReceiptDigest(slot.raw, slot.correction.digestVersion) &&
         !Object.hasOwn(spend, `matrix:${key}:correction:${slot.correction.originalDigest}`);
       if (slot.targetedRepair) {
         const knownUnspentTargeted = slot.targetedRepair.phase === "claimed" &&
           slot.targetedRepair.preflightRejected === true && !Object.hasOwn(spend, targetedRepairSpendKey());
         if (!hasTargetedRepairApproval(job) || key !== TARGETED_COMPILATION_REPAIR_GRANT.operation ||
             slot.targetedRepair.phase === "claimed" && !knownUnspentTargeted ||
             slot.targetedRepair.originalDigest !== TARGETED_COMPILATION_REPAIR_GRANT.failedCorrectionDigest) return false;
         if (slot.phase !== "complete" && !knownUnspentTargeted) {
           const op = compilationOperations().find(op => op.key === key)!;
           try { acceptCompilation(job.payload.state, op, slot.targetedRepair.raw); } catch { return false; }
         }
       }
       // A received correction is not uncertain, but Continue cannot repair an
       // invalid one. Only admit validation-only recovery of a valid receipt.
       if (slot.phase !== "complete" && !slot.targetedRepair && slot.correction && slot.correction.phase !== "claimed") {
         const op = compilationOperations().find(op => op.key === key);
         try {
            if (!op || slot.correction.originalDigest !== compilationReceiptDigest(slot.raw, slot.correction.digestVersion)) return false;
           acceptCompilation(job.payload.state, op, slot.correction.raw);
         } catch { return targetedAvailable && key === TARGETED_COMPILATION_REPAIR_GRANT.operation; }
       }
       const knownUnspent = slot.phase === "claimed" && slot.preflightRejected === true &&
         !Object.keys(job.payload.packageSpend ?? {}).some(spendKey =>
           spendKey === `matrix:${key}` || spendKey.startsWith(`matrix:${key}:`));
       return (slot.phase !== "claimed" || knownUnspent) &&
         (slot.correction?.phase !== "claimed" || knownUnspentCorrection) &&
      (slot.raw?.choices?.[0]?.finish_reason !== "length" ||
         slot.correction && ["received", "complete"].includes(slot.correction.phase) ||
        knownUnspentCorrection ||
        correctionAllowed && !slot.correction && !job.payload.state.compilation?.replacements?.[key] &&
         compilationOperations().some(op => op.key === key && isTruncatedCompilation(op, slot.raw)));
     });
}
export function canResumePackage(job: any): boolean {
  const state = job.payload?.state;
  return state?.phase === "blocked" &&
    !(state.research?.map as any)?.overflow &&
    !Object.keys(job.payload.packageSpend ?? {}).length &&
    Object.values(state.reports ?? {}).every((report: any) => !report.jobId);
}
export function registerCompanyReportPackages(app: Express, helpers: {
  authMiddleware: any; requireAdmin(req: Request, res: Response): Promise<number | null>;
}, dependencies?: { db?: typeof defaultDb; configuration?: typeof packageConfiguration }) {
  const db = dependencies?.db ?? defaultDb;
  const configurationCheck = dependencies?.configuration ?? packageConfiguration;
  const base = "/api/admin/company-report-packages";
  registerCompilerContinuation(app, helpers, db, configurationCheck);
  app.post(`${base}/:id/repair`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    const body = z.object({ snapshot: z.string().regex(/^[a-f0-9]{64}$/),
      modelBudgetUsd: z.number().int().min(10).max(200), confirmAdditionalPaidWork: z.literal(true) }).strict().safeParse(req.body);
    if (!body.success || !/^\d{1,10}$/.test(String(req.params.id))) return res.status(400).json({ error: "Confirm the saved repair and bounded model allowance." });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report generation is stopped." });
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,${tenant})`);
        const [job] = rows(await tx.execute(sql`SELECT id,status,payload,attempts,tenant_id,kind FROM agent_jobs
          WHERE id=${Number(req.params.id)} AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND} FOR UPDATE`));
        if (!job) throw new Error("Repair unavailable");
        if (job.payload.completionAdmission?.subject === body.data.snapshot && ["pending", "running"].includes(job.status)) return;
        const [active] = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND status IN ('pending','running') LIMIT 1`));
        if (active || !configurationCheck().ready) throw new Error("Repair unavailable");
        const children = await loadCompilerContinuationChildren(tx, job, true);
        const repaired = approvePackageRepair(job, children, body.data);
        for (const child of repaired.children) await tx.execute(sql`UPDATE agent_jobs
          SET payload=${JSON.stringify(child.payload)}::jsonb,status='pending',error=NULL,lease_until=NULL,
            next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
          WHERE id=${child.id} AND tenant_id=${tenant} AND kind='business_report_review'`);
        await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(repaired.payload)}::jsonb,
          status='pending',error=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
          WHERE id=${job.id} AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`);
      });
      res.status(202).json({ id: Number(req.params.id), status: "pending" });
    } catch { res.status(409).json({ error: "Repair was not admitted. Refresh status; saved work or its completion envelope needs reconciliation." }); }
  });
  app.get(`${base}/preflight`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    res.setHeader("Cache-Control", "private, no-store");
    res.json(configurationCheck());
  });
  app.post(base, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    const parsed = companyPackageBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter the company name and public website or business email, then approve the allowances. Personal email addresses need a website." });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report generation is stopped." });
    const { requestId, acceptResearchCost: _, modelBudgetUsd, allowAutomaticCorrections, ...intake } = parsed.data;
    const digest = createHash("sha256").update(JSON.stringify({ intake, modelBudgetUsd,
      ...(allowAutomaticCorrections ? { allowAutomaticCorrections: true } : {}) })).digest("hex");
    try {
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,${tenant})`);
        const [prior] = rows(await tx.execute(sql`SELECT id,payload FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND payload->>'requestId'=${requestId} ORDER BY id DESC LIMIT 1`));
        if (prior) return prior.payload.digest === digest ? { id: prior.id } : { conflict: true };
        const configuration = configurationCheck();
        if (!configuration.ready) return { configuration: configuration.issues };
        const [active] = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND status IN ('pending','running') LIMIT 1`));
        if (active) return { busy: active.id };
        const [quota] = rows(await tx.execute(sql`SELECT count(*)::int AS count FROM agent_jobs
          WHERE tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND} AND created_at>NOW()-INTERVAL '24 hours'`));
        if (quota.count >= 5) return { capped: true };
        const payload = { tenantId: tenant, requestId, digest, productionVersion: 3,
          modelBudgetMicros: modelBudgetUsd * 1e6, audioBudgetMicros: 5_000_000,
          ...(allowAutomaticCorrections ? { compilationCorrectionPolicy: {
            version: 1, maxPerOperation: 1, approvedAt: new Date().toISOString(),
          } } : {}),
          processingWindowStartedAt: new Date().toISOString(), state: initialPackage(intake) };
        const [created] = rows(await tx.execute(sql`INSERT INTO agent_jobs (kind,payload,tenant_id,max_attempts)
          VALUES (${PACKAGE_JOB_KIND},${JSON.stringify(payload)}::jsonb,${tenant},1600) RETURNING id`));
        return { id: created.id };
      });
      if (outcome.conflict) return res.status(409).json({ error: "Request identity belongs to different company inputs." });
      if (outcome.configuration) return res.status(503).json({ error: outcome.configuration.join(" ") });
      if (outcome.busy) return res.status(409).json({ error: "A package is already in progress. Resume it rather than starting duplicate research.", id: outcome.busy });
      if (outcome.capped) return res.status(429).json({ error: "Five-package daily research limit reached." });
      return res.status(202).json({ id: outcome.id, status: "pending" });
    } catch { return res.status(503).json({ error: "Package could not be durably queued. Retry with the same request identity." }); }
  });
  app.post(`${base}/:id/resume`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    const parsed = resumeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Use the current recovery controls and explicit approval checkboxes." });
    req.body = parsed.data;
    if (!/^\d{1,10}$/.test(String(req.params.id)) ||
        req.body?.researchOnly !== true && req.body?.acceptResearchCost !== true)
      return res.status(400).json({ error: "Confirm the research cost before resuming." });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1")
      return res.status(503).json({ error: "Report generation is stopped." });
    try {
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,${tenant})`);
         const [job] = rows(await tx.execute(sql`SELECT id,tenant_id,payload,status,attempts FROM agent_jobs WHERE id=${Number(req.params.id)}
          AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND} FOR UPDATE`));
        if (!job) return false;
        if (req.body?.snapshot && job.payload.packageRecovery?.subject === req.body.snapshot &&
            ["pending", "running"].includes(job.status)) return true;
         if (req.body?.replaceTruncatedCompilation === true && req.body?.snapshot &&
             ["pending", "running"].includes(job.status) &&
             Object.values(job.payload.state?.compilation?.replacements ?? {}).some((r: any) => r.snapshot === req.body.snapshot))
           return true;
        const [active] = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND status IN ('pending','running') LIMIT 1`));
        if (active) return false;
        if (job.payload.productionVersion === 3) {
           if (req.body?.acceptResearchCost !== true || req.body?.researchOnly === true || !configurationCheck().ready) return false;
           if (req.body?.replaceTruncatedCompilation === true) approveCompilationReplacement(job, req.body);
           else if (!canResumeCompilation(job, req.body.allowAutomaticCorrections === true)) return false;
          if (req.body.allowAutomaticCorrections === true) {
            if (!Number.isSafeInteger(job.payload.modelBudgetMicros) ||
                job.payload.modelBudgetMicros > 150_000_000 || job.payload.modelBudgetMicros < 10_000_000) return false;
            job.payload.compilationCorrectionPolicy ??= {
              version: 1, maxPerOperation: 1, approvedAt: new Date().toISOString(),
            };
          }
           if (canApproveTargetedRepair(job)) approveTargetedRepair(job);
            if (canReconcileUnspentCompilation(job)) reconcileUnspentCompilation(job);
           const state = job.payload.state;
          state.phase = state.research?.complete === true ? "drafting" : "researching";
          delete state.error;
          if (state.compilation?.phase === "blocked") state.compilation.phase = "authors";
          const payload = { ...job.payload, state, processingWindowStartedAt: new Date().toISOString() };
          await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(payload)}::jsonb,
            status='pending',error=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
            WHERE id=${job.id} AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`);
          return true;
        }
        // Legacy uncharged recovery remains supported, but paid recovery must
        // bind the preview token and explicit uncertainty acknowledgement.
        const request = req.body?.snapshot ? req.body : canResumePackage(job)
          ? { ...req.body, snapshot: packageRecoveryPlan(job).snapshot,
              ...(packageRecoveryPlan(job).canRepairResearch ? { researchOnly: true } : {}) } : req.body;
        const payload = approvePackageRecovery(job, request);
        if (!payload.researchOnly) {
          const configuration = configurationCheck();
          if (!configuration.ready) throw new Error(configuration.issues.join(" "));
          for (const [kind, report] of Object.entries(payload.state.reports) as [string, any][]) {
            if (!report.jobId || report.status === "done") continue;
            const [child] = rows(await tx.execute(sql`SELECT payload,status FROM agent_jobs
              WHERE id=${report.jobId} AND tenant_id=${tenant} AND kind='business_report_review' FOR UPDATE`));
            if (!child || child.payload.input?.orderId !== `company-package:${job.id}:${kind}` ||
                child.payload.input?.tenantId !== tenant || child.payload.input?.reportOnly !== true ||
                child.payload.input?.paidJuryBatch !== `company-package:${job.id}` ||
                child.payload.input?.intake?.company !== payload.state.intake.company ||
                child.payload.input?.intake?.website !== payload.state.intake.website)
              throw new Error("Saved report binding needs inspection.");
            if (["pending", "running"].includes(child.status)) throw new Error("A saved report is still advancing; refresh before recovery.");
            if (!canRestartUnspentPackageReview(report.jobId, child.payload, job.payload.packageSpend || {}))
              throw new Error("A paid report review needs inspection before it can be retried.");
            const { initialBusinessReportReview } = await import("../lib/business-report-review");
            const input = { ...child.payload.input, evidence: payload.state.research.evidence };
            const prior = { input: child.payload.input, state: child.payload.state,
              paidJuryRuns: child.payload.paidJuryRuns, reportJuryRuns: child.payload.reportJuryRuns };
            const childPayload = { ...child.payload, input, state: initialBusinessReportReview(input),
              paidJuryRuns: {}, reportJuryRuns: {},
              packageRecoveryHistory: [...(child.payload.packageRecoveryHistory || []), prior] };
            await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(childPayload)}::jsonb,
              status='pending',error=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
              WHERE id=${report.jobId} AND tenant_id=${tenant} AND kind='business_report_review'`);
          }
        }
        await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(payload)}::jsonb,
          status='pending',error=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
          WHERE id=${Number(req.params.id)} AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`);
        return true;
      });
      if (!outcome) return res.status(409).json({ error: "This package cannot be automatically resumed: active work, accepted review or paid reservations need inspection." });
      res.status(202).json({ id: Number(req.params.id), status: "pending" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const safe = /^(?:Saved compilation changed|Explicit replacement approval required|Package changed;|Explicit approval is required|Approve the existing|A paid report review needs|A saved report is still|Saved report binding needs|Refresh saved factual research|The \$30 model|An unfinished paid review)/.test(message);
      res.status(safe ? 409 : 503).json({ error: safe ? message : "Resume could not be confirmed. Refresh status before trying again." });
    }
  });
  app.get(base, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const jobs = rows(await db.execute(sql`SELECT id,status,payload,created_at,attempts,tenant_id,kind FROM agent_jobs WHERE tenant_id=${tenant}
        AND kind=${PACKAGE_JOB_KIND} ORDER BY id DESC LIMIT 20`));
      res.json({ items: jobs.map(projection) });
    } catch { res.status(503).json({ error: "Package history unavailable; no records were discarded." }); }
  });
  app.get(`${base}/:id`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    if (!/^\d{1,10}$/.test(String(req.params.id))) return res.status(400).json({ error: "Invalid package" });
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const [job] = rows(await db.execute(sql`SELECT id,status,payload,created_at,attempts,tenant_id,kind FROM agent_jobs WHERE id=${Number(req.params.id)}
        AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`));
      if (!job) return res.status(404).json({ error: "Package not found" });
      if (job.payload.productionVersion === 3) return res.json(projection(job));
      const children = await loadCompilerContinuationChildren(db, job);
      res.json({ ...projection(job), reviewContinuation: compilerContinuationPlan(job, children),
        repairPlan: packageRepairPlan(job, children) });
    } catch { res.status(503).json({ error: "Package status unavailable" }); }
  });
  app.get(`${base}/:id/files/:key`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    if (!/^\d{1,10}$/.test(String(req.params.id)) ||
        !isPackageFileKey(String(req.params.key)))
      return res.status(400).json({ error: "Invalid package file" });
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const [job] = rows(await db.execute(sql`SELECT payload FROM agent_jobs WHERE id=${Number(req.params.id)}
        AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`));
      if (!job || !job.payload.state.files.some((file: any) => file.key === req.params.key))
        return res.status(404).json({ error: "Artifact not ready" });
      const bytes = await packageFile(tenant, Number(req.params.id), String(req.params.key));
      if (!bytes) return res.status(503).json({ error: "Durable package PDF unavailable" });
      res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="${req.params.key}.pdf"`);
      res.send(bytes);
    } catch { res.status(503).json({ error: "Private package download unavailable" }); }
  });
}

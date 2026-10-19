import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { PACKAGE_JOB_KIND, packageFile } from "../lib/company-report-package";
import { initialPackage, isPackageFileKey, type PackageState } from "../lib/company-report-package-core";

export const companyPackageBody = z.object({
  requestId: z.string().uuid(), company: z.string().trim().min(1).max(200),
  website: z.string().trim().url().max(300).refine(value => {
    const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search;
  }, "Use a public website URL without credentials or query parameters"),
  principalName: z.string().trim().max(120).optional(), industry: z.string().trim().max(200).optional(),
  crm: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional(),
  intakeText: z.string().max(20_000).optional(), acceptResearchCost: z.literal(true),
});
const rows = (r: any) => r.rows || r;
function projection(job: any) {
  const state = job.payload.state as PackageState;
  return { id: job.id, status: state.phase === "done" ? "done" : state.phase === "blocked" ? "error"
    : ["failed", "failed_terminal", "cancelled"].includes(job.status) ? "error" : job.status === "running" ? "running" : "pending",
    phase: state.phase, company: state.intake.company, website: state.intake.website, error: state.error || null,
    createdAt: job.created_at, files: state.files, coverage: state.research?.coverage,
    reports: state.reports, emailSummary: state.emailSummary };
}
export function registerCompanyReportPackages(app: Express, helpers: {
  authMiddleware: any; requireAdmin(req: Request, res: Response): Promise<number | null>;
}) {
  const base = "/api/admin/company-report-packages";
  app.post(base, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    const parsed = companyPackageBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Company, public website, request identity and explicit upfront research-cost approval are required." });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report generation is stopped." });
    const { requestId, acceptResearchCost: _, ...intake } = parsed.data;
    const digest = createHash("sha256").update(JSON.stringify(intake)).digest("hex");
    try {
      const outcome = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,${tenant})`);
        const [prior] = rows(await tx.execute(sql`SELECT id,payload FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND payload->>'requestId'=${requestId} ORDER BY id DESC LIMIT 1`));
        if (prior) return prior.payload.digest === digest ? { id: prior.id } : { conflict: true };
        const [active] = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind=${PACKAGE_JOB_KIND} AND status IN ('pending','running') LIMIT 1`));
        if (active) return { busy: active.id };
        const [quota] = rows(await tx.execute(sql`SELECT count(*)::int AS count FROM agent_jobs
          WHERE tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND} AND created_at>NOW()-INTERVAL '24 hours'`));
        if (quota.count >= 5) return { capped: true };
        const payload = { tenantId: tenant, requestId, digest, state: initialPackage(intake) };
        const [created] = rows(await tx.execute(sql`INSERT INTO agent_jobs (kind,payload,tenant_id,max_attempts)
          VALUES (${PACKAGE_JOB_KIND},${JSON.stringify(payload)}::jsonb,${tenant},1600) RETURNING id`));
        return { id: created.id };
      });
      if (outcome.conflict) return res.status(409).json({ error: "Request identity belongs to different company inputs." });
      if (outcome.busy) return res.status(409).json({ error: "A package is already in progress. Resume it rather than starting duplicate research.", id: outcome.busy });
      if (outcome.capped) return res.status(429).json({ error: "Five-package daily research limit reached." });
      return res.status(202).json({ id: outcome.id, status: "pending" });
    } catch { return res.status(503).json({ error: "Package could not be durably queued. Retry with the same request identity." }); }
  });
  app.get(base, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const jobs = rows(await db.execute(sql`SELECT id,status,payload,created_at FROM agent_jobs WHERE tenant_id=${tenant}
        AND kind=${PACKAGE_JOB_KIND} ORDER BY id DESC LIMIT 20`));
      res.json({ items: jobs.map(projection) });
    } catch { res.status(503).json({ error: "Package history unavailable; no records were discarded." }); }
  });
  app.get(`${base}/:id`, helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    if (!/^\d{1,10}$/.test(String(req.params.id))) return res.status(400).json({ error: "Invalid package" });
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const [job] = rows(await db.execute(sql`SELECT id,status,payload,created_at FROM agent_jobs WHERE id=${Number(req.params.id)}
        AND tenant_id=${tenant} AND kind=${PACKAGE_JOB_KIND}`));
      if (!job) return res.status(404).json({ error: "Package not found" });
      res.json(projection(job));
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

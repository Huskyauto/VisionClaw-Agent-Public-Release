import type { Express, Request, Response } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  createCmmcAssessment,
  createCmmcInvitation,
  getCmmcAccessByToken,
  getCmmcAssessmentById,
  getCmmcSnapshot,
  listCmmcAssessments,
  revokeCmmcInvitation,
  saveCmmcDraftByToken,
  submitCmmcAssessmentByToken,
} from "../cmmc-assessments";
import {
  CmmcDeliveryInProgressError,
  deliverCmmcReportPair,
  generateCmmcReportPair,
  listCmmcReports,
} from "../cmmc-report";
import {
  CMMC_L1_CATALOG_VERSION,
  CMMC_L1_DISCLAIMER,
  CMMC_L1_REQUIREMENTS,
  CMMC_L1_SELF_CERTIFICATION_TEXT,
  cmmcNotApplicableCount,
  cmmcNotMetCount,
  cmmcProhibitedContentFields,
  isCmmcLevel1SelfReady,
  sanitizeCmmcDraft,
} from "@shared/cmmc-level1-fields";

const publicCmmcLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const createSchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  companyName: z.string().trim().min(1).max(255),
  customerName: z.string().trim().min(1).max(255),
  customerEmail: z.string().trim().email().max(320),
});
const draftSchema = z.object({ draft: z.unknown() });
const submitSchema = z.object({
  authorizedOfficialName: z.string().max(200),
  authorizedOfficialTitle: z.string().max(200),
  authorizedOfficialEmail: z.string().max(320),
  signedAt: z.string().max(40),
  draft: z.unknown(),
});

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.CMMC_SELF_ASSESSMENT_ENABLED === "1";
}

function inviteUrl(req: Request, token: string): string {
  return `${req.protocol}://${req.get("host")}/cmmc/assessment/${token}`;
}

export function registerCmmcPublicRoutes(app: Express): void {
  app.get("/api/public/cmmc/:token", publicCmmcLimiter, async (req: Request, res: Response) => {
    if (!enabled()) return res.status(404).json({ error: "Not found" });
    const access = await getCmmcAccessByToken(String(req.params.token));
    if (!access) return res.status(404).json({ error: "This invitation is invalid, expired, or revoked." });
    return res.json({
      assessment: {
        companyName: access.assessment.companyName,
        customerName: access.assessment.customerName,
        status: access.assessment.status,
        draft: sanitizeCmmcDraft(access.assessment.draft),
      },
      catalogVersion: CMMC_L1_CATALOG_VERSION,
      expiresAt: access.invitation.expiresAt,
      disclaimer: CMMC_L1_DISCLAIMER,
      selfCertification: CMMC_L1_SELF_CERTIFICATION_TEXT,
      requirements: CMMC_L1_REQUIREMENTS,
    });
  });

  app.put("/api/public/cmmc/:token/draft", publicCmmcLimiter, express.json({ limit: "1mb" }), async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "Not found" });
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid draft." });
    if (cmmcProhibitedContentFields(parsed.data.draft).length > 0) {
      return res.status(400).json({ error: "This questionnaire accepts scope descriptions and evidence locators only. Remove restricted content before saving." });
    }
    const result = await saveCmmcDraftByToken(String(req.params.token), parsed.data.draft);
    if (!result.ok) return res.status(404).json({ error: "This invitation is invalid, expired, revoked, or locked." });
    return res.json({ ok: true, updatedAt: result.assessment?.updatedAt });
  });

  app.post("/api/public/cmmc/:token/submit", publicCmmcLimiter, express.json({ limit: "1mb" }), async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "Not found" });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid submission." });
    const result = await submitCmmcAssessmentByToken(String(req.params.token), { ...parsed.data, draft: parsed.data.draft ?? {} });
    if (!result.ok) {
      if (result.missing.includes("assessmentAlreadySubmitted")) return res.status(409).json({ error: "This assessment has already been submitted." });
      if (result.missing.length === 0) return res.status(404).json({ error: "This invitation is invalid, expired, or revoked." });
      if (result.missing.some((field) => field.startsWith("prohibitedContent."))) {
        return res.status(400).json({ error: "This questionnaire accepts scope descriptions and evidence locators only. Remove restricted content before submitting." });
      }
      return res.status(400).json({ error: "Complete all required fields before submitting.", missing: result.missing });
    }
    return res.json({ ok: true, submittedAt: result.snapshot?.submittedAt, revision: result.snapshot?.revision });
  });
}

export function registerCmmcAdminRoutes(app: Express, helpers: {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null | Promise<number | null>;
  isAdminRequest: (req: Request) => boolean;
}): void {
  const guard = async (req: Request, res: Response): Promise<number | null> => {
    if (!enabled()) { res.status(404).json({ error: "Not found" }); return null; }
    if (!helpers.isAdminRequest(req)) { res.status(403).json({ error: "Admin access required" }); return null; }
    const tenantId = await helpers.getTenantFromRequest(req);
    if (!tenantId) { res.status(401).json({ error: "Authentication required" }); return null; }
    return tenantId;
  };
  app.get("/api/admin/cmmc", helpers.authMiddleware, async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const assessments = await listCmmcAssessments(tenantId);
    const items = await Promise.all(assessments.map(async (assessment) => {
      const draft = sanitizeCmmcDraft(assessment.draft);
      return {
        ...assessment,
        reports: await listCmmcReports(tenantId, assessment.id),
        cmmcSummary: {
          cageCodes: draft.cageCodes,
          cmmcStatusDate: draft.cmmcStatusDate || null,
          level1SelfReady: isCmmcLevel1SelfReady(draft),
          notMetCount: cmmcNotMetCount(draft),
          notApplicableCount: cmmcNotApplicableCount(draft),
          retentionUntil: assessment.retentionUntil,
        },
      };
    }));
    res.json({ items });
  });
  app.post("/api/admin/cmmc", helpers.authMiddleware, express.json(), async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const body = createSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Provide company, customer name, and a valid customer email." });
    const created = await createCmmcAssessment({ tenantId, ...body.data });
    res.status(201).json({ assessment: created.assessment, inviteUrl: inviteUrl(req, created.token), expiresAt: created.expiresAt });
  });
  app.post("/api/admin/cmmc/:id/invitation", helpers.authMiddleware, express.json(), async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid assessment id" });
    try {
      const invitation = await createCmmcInvitation(tenantId, id);
      res.json({ inviteUrl: inviteUrl(req, invitation.token), expiresAt: invitation.expiresAt });
    } catch (error: any) { res.status(404).json({ error: error.message || "Assessment not found" }); }
  });
  app.post("/api/admin/cmmc/:id/revoke", helpers.authMiddleware, express.json(), async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid assessment id" });
    const revoked = await revokeCmmcInvitation(tenantId, id);
    res.json({ ok: true, revoked });
  });
  app.post("/api/admin/cmmc/:id/generate", helpers.authMiddleware, express.json(), async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const assessment = await getCmmcAssessmentById(tenantId, Number(req.params.id));
    if (!assessment?.submittedRevision) return res.status(409).json({ error: "A submitted assessment is required before generating reports." });
    const snapshot = await getCmmcSnapshot(tenantId, assessment.id, assessment.submittedRevision);
    if (!snapshot) return res.status(404).json({ error: "Submitted snapshot not found." });
    try {
      const report = await generateCmmcReportPair({ tenantId, assessment, snapshot });
      res.json({ report });
    } catch (error: any) { res.status(502).json({ error: error.message || "Report generation failed." }); }
  });
  app.post("/api/admin/cmmc/:id/reports/:reportId/deliver", helpers.authMiddleware, express.json(), async (req, res) => {
    const tenantId = await guard(req, res); if (!tenantId) return;
    const assessment = await getCmmcAssessmentById(tenantId, Number(req.params.id));
    const reports = assessment ? await listCmmcReports(tenantId, assessment.id) : [];
    const report = reports.find((item) => item.id === Number(req.params.reportId));
    if (!assessment || !report) return res.status(404).json({ error: "Report not found." });
    try {
      const delivered = await deliverCmmcReportPair({ tenantId, assessment, report, reviewedBy: "platform admin" });
      res.json({ report: delivered });
    } catch (error: any) {
      if (error instanceof CmmcDeliveryInProgressError) {
        return res.status(409).json({ error: error.message });
      }
      res.status(502).json({ error: error.message || "Paired delivery failed; the report remains retryable." });
    }
  });
}
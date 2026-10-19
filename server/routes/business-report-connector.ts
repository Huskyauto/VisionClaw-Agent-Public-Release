import type { Express, Request, Response, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { buildMuseReportRequest, validateMuseReportReply,
  type BusinessReportReviewInput, type BusinessReportReviewState } from "../lib/business-report-review";
import { hashReportBytes, reportDigestForWire, matchesReportDigest } from "../lib/business-report-evidence";
import { sanitizeAgentOutput } from "../safety-layer";
import { ReportQualityError } from "../lib/business-report-quality";
import { reportReplySchema as replySchema, REPORT_REPLY_CONTRACT } from "../lib/business-report-reply-contract";

// Only schema-owned field names, fixed codes and numeric bounds may leave the
// parser. Zod messages/received values/unrecognized keys can contain private data.
const replyDiagnosticFields = new Set([
  "requestId", "digest", "report", "sections", "heading", "blocks", "type", "text",
  "sourceIds", "unknowns", "actionPlan", "priority", "action", "benefit", "effort",
  "cost", "risk", "dependency", "owner", "measurement", "corrections", "id",
  "disposition", "resolution",
]);
function safeReplyIssues(error: z.ZodError) {
  return error.issues.slice(0, REPORT_REPLY_CONTRACT.maxDiagnosticIssues).map(issue => ({
    path: issue.path.map(part => typeof part === "number" && Number.isSafeInteger(part) && part >= 0
      ? part : replyDiagnosticFields.has(String(part)) ? String(part) : "field").join(".") || "body",
    code: issue.code,
    ...(issue.code === "too_small" && typeof issue.minimum === "number" &&
      Number.isFinite(issue.minimum) ? { minimum: issue.minimum } : {}),
    ...(issue.code === "too_big" && typeof issue.maximum === "number" &&
      Number.isFinite(issue.maximum) ? { maximum: issue.maximum } : {}),
  }));
}
function schemaRejection(error: z.ZodError) {
  return {
    error: "Expected requestId, digest, and a complete structured report",
    issues: safeReplyIssues(error), issueCount: error.issues.length,
    issuesTruncated: error.issues.length > REPORT_REPLY_CONTRACT.maxDiagnosticIssues,
  };
}

export function registerBusinessReportConnector(app: Express, auth: RequestHandler,
  apiOnly: RequestHandler, tenantForRequest: (req: Request) => number | null | undefined,
  store: Pick<typeof db, "execute" | "transaction"> = db): void {
  const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
  const gate = (req: Request, res: Response, write = false): number | null => {
    const tenantId = tenantForRequest(req);
    const scopes = (req as any).apiKeyScopes as string[] | undefined;
    if (!tenantId || tenantId !== ownerTenantId() ||
        !scopes?.some(scope => write ? ["chat", "admin"].includes(scope) : ["read", "chat", "admin"].includes(scope))) {
      res.status(403).json({ error: "Authorized owner API key with the required report scope is required" });
      return null;
    }
    return tenantId;
  };
  const parseId = (value: string): number | null =>
    /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

  app.get("/api/v1/spark/reports/schema", auth, apiOnly, limiter, (req, res) => {
    if (gate(req, res) === null) return;
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report handoffs are stopped" });
    return res.json(REPORT_REPLY_CONTRACT);
  });

  app.get("/api/v1/spark/reports", auth, apiOnly, limiter, async (req, res) => {
    const tenantId = gate(req, res);
    if (tenantId === null) return;
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report handoffs are stopped" });
    try {
      const rows: any = await store.execute(sql`
        SELECT id, payload->'state'->>'requestId' AS "requestId",
          payload->'state'->>'digest' AS digest, payload->'state'->>'expiresAt' AS "expiresAt"
        FROM agent_jobs WHERE tenant_id = ${tenantId} AND kind = 'business_report_review'
          AND status = 'pending' AND payload->'state'->>'phase' = 'wait_muse'
          AND NOT (payload->'state' ? 'reply')
           AND payload->'input'->>'compilerMode' = 'muse-legacy'
          AND (payload->'state'->>'expiresAt')::timestamptz > NOW()
        ORDER BY id LIMIT 50
      `);
      res.json({ protocol: "business-report-handoff-v1",
        requests: (rows.rows || rows).map((row: any) => ({ ...row, digest: reportDigestForWire(row.digest) })) });
    } catch {
      res.status(503).json({ error: "Report request inbox unavailable; do not infer there are no reports" });
    }
  });
  app.get("/api/v1/spark/reports/:id", auth, apiOnly, limiter, async (req, res) => {
    const tenantId = gate(req, res);
    if (tenantId === null) return;
    const id = parseId(String(req.params.id));
    if (!id) return res.status(400).json({ error: "Invalid report job ID" });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report handoffs are stopped" });
    try {
      const rows: any = await store.execute(sql`SELECT payload, status FROM agent_jobs
        WHERE id = ${id} AND tenant_id = ${tenantId} AND kind = 'business_report_review'
          LIMIT 1`);
      const row = (rows.rows || rows)[0];
      if (!row) return res.status(404).json({ error: "No pending report request" });
      const input = row.payload.input as BusinessReportReviewInput;
      const state = row.payload.state as BusinessReportReviewState;
      if (input.tenantId !== tenantId) {
        return res.status(409).json({ error: "Report request has invalid binding" });
      }
      if (state.replyHash) {
        const acceptance = state.replyAcceptances?.find(item => item.receipt.requestId === state.requestId);
        return res.json({ status: "accepted", jobId: id, requestId: state.requestId,
          receipt: acceptance?.receipt ?? null, legacyAcceptance: !acceptance, reviewPhase: state.phase,
          customerDeliveryApproved: false });
      }
      if (input.compilerMode !== "muse-legacy") {
        return res.status(409).json({ status: "internal_compiler", jobId: id,
          reviewPhase: state.phase, error: "This report uses the direct internal compiler, not an external handoff" });
      }
      if (Date.now() >= Date.parse(state.expiresAt)) {
        return res.status(410).json({ status: "expired", jobId: id, requestId: state.requestId,
          expiresAt: state.expiresAt });
      }
      if (state.phase !== "wait_muse" || !["pending", "running"].includes(row.status)) {
        return res.status(409).json({ status: "blocked", jobId: id, reviewPhase: state.phase });
      }
      const packet = buildMuseReportRequest(input, state);
      if (sanitizeAgentOutput(JSON.stringify(packet)).redacted) {
        return res.status(422).json({ error: "Report egress contains sensitive data; owner correction required" });
      }
      return res.json({ ...packet, status: "pending", jobId: id });
    } catch {
      res.status(503).json({ error: "Report request temporarily unavailable" });
    }
  });
  app.post("/api/v1/spark/reports/:id/reply", auth, apiOnly, limiter, async (req, res) => {
    const tenantId = gate(req, res, true);
    if (tenantId === null) return;
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") return res.status(503).json({ error: "Report handoffs are stopped" });
    const id = parseId(String(req.params.id));
    if (!id || JSON.stringify(req.body ?? {}).length > 180_000) return res.status(400).json({ error: "Invalid report reply size or ID" });
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      const rejection = schemaRejection(parsed.error);
      console.warn("[business-report-reply] schema rejection", JSON.stringify({ jobId: id, ...rejection }));
      return res.status(400).json(rejection);
    }
    if (sanitizeAgentOutput(JSON.stringify(parsed.data.report)).redacted) {
      return res.status(422).json({ error: "Sensitive data is not allowed in a report reply" });
    }
    try {
      const result = await store.transaction(async tx => {
        const rows: any = await tx.execute(sql`SELECT payload, status FROM agent_jobs
          WHERE id = ${id} AND tenant_id = ${tenantId} AND kind = 'business_report_review' FOR UPDATE`);
        const row = (rows.rows || rows)[0];
        if (!row) return { status: 404, error: "Report request not found" };
        const input = row.payload.input as BusinessReportReviewInput;
        const state = row.payload.state as BusinessReportReviewState;
        const replyHash = hashReportBytes(JSON.stringify(parsed.data.report));
        const prior = state.replyAcceptances?.find(item => item.receipt.requestId === parsed.data.requestId);
        if (input.tenantId === tenantId && prior) {
          return prior.replyHash === replyHash && matchesReportDigest(parsed.data.digest, prior.digest)
            ? { status: 200, accepted: true, duplicate: true, receipt: prior.receipt }
            : { status: 409, error: "A different reply is already bound to this revision" };
        }
        if (input.tenantId !== tenantId || state.requestId !== parsed.data.requestId || !matchesReportDigest(parsed.data.digest, state.digest)) {
          return { status: 409, error: "Report revision binding mismatch" };
        }
        if (state.replyHash) {
          return state.replyHash === replyHash
            ? { status: 200, accepted: true, duplicate: true, legacyAcceptance: true,
              jobId: id, requestId: state.requestId, receipt: null }
            : { status: 409, error: "A different reply is already bound to this revision" };
        }
        if (input.compilerMode !== "muse-legacy") {
          return { status: 409, error: "This report uses the direct internal compiler; external replies are disabled" };
        }
        if (row.status !== "pending") return { status: 409, error: "Report is being advanced; retry the same reply later" };
        validateMuseReportReply(input, state, parsed.data);
        const receipt = { jobId: id, requestId: state.requestId, status: "accepted" as const,
          acceptedAt: new Date().toISOString() };
        const updated = { ...state, reply: parsed.data.report, replyHash,
          replyAcceptances: [...(state.replyAcceptances || []), { digest: state.digest, replyHash, receipt }],
          replyActor: { apiKeyId: (req as any).apiKeyId, receivedAt: new Date().toISOString(),
            channel: "authenticated-muse-report-connector", providerIdentityAttested: false } };
        await tx.execute(sql`UPDATE agent_jobs
          SET payload = jsonb_set(payload, '{state}', ${JSON.stringify(updated)}::jsonb), next_run_at = NOW()
          WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'`);
        return { status: 202, accepted: true, receipt };
      });
      const { status, ...body } = result;
      return res.status(status).json(body);
    } catch (error: any) {
      // Only fixed validator diagnostics are public; never echo source/customer text.
      if (error instanceof ReportQualityError) {
        const issues = error.issues.slice(0, REPORT_REPLY_CONTRACT.maxDiagnosticIssues);
        const rejection = { error: "Report action-plan or quality contract failed", issues,
          issueCount: error.issues.length,
          issuesTruncated: error.issues.length > REPORT_REPLY_CONTRACT.maxDiagnosticIssues };
        console.warn("[business-report-reply] quality rejection", JSON.stringify({ jobId: id, ...rejection }));
        return res.status(422).json(rejection);
      }
      const contractError = error instanceof ReportQualityError ||
        /quotation|citation|section|blocks|revision|contract/.test(String(error?.message));
      return res.status(contractError ? 422 : 503).json({ error: contractError
        ? "Report failed the source, section, action-plan or correction contract; correct and resubmit the same revision"
        : "Reply persistence unavailable; retry the same reply, not a new report" });
    }
  });
}

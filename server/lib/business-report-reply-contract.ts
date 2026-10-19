import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** One structural contract for HTTP intake, downstream quality checks and clients. */
export const reportActionTextSchemas = {
  action: z.string().min(10).max(1200),
  benefit: z.string().min(10).max(1200),
  effort: z.string().min(10).max(1200),
  cost: z.string().min(10).max(1200),
  risk: z.string().min(10).max(1200),
  dependency: z.string().min(10).max(1200),
  owner: z.string().min(1).max(1200),
  measurement: z.string().min(10).max(1200),
};
export const reportActionSchema = z.object({
  priority: z.number().int().min(1).max(6),
  sourceIds: z.array(z.string().regex(/^S[1-9]\d*$/)).min(1).max(8),
  ...reportActionTextSchemas,
}).strict();
const actionPlan = z.array(reportActionSchema).min(3).max(6);
const corrections = z.array(z.object({
  id: z.string().min(1).max(80),
  disposition: z.enum(["corrected", "removed"]),
  resolution: z.string().min(20).max(1500),
}).strict()).max(30);
const reportSchema = z.object({
  sections: z.array(z.object({
    heading: z.string().min(1).max(160),
    blocks: z.array(z.object({
      type: z.enum(["fact", "recommendation", "assumption"]),
      text: z.string().min(10).max(3000),
      sourceIds: z.array(z.string().regex(/^S[1-9]\d*$/)).max(8),
    }).strict()).min(1).max(24),
  }).strict()).min(1).max(30),
  unknowns: z.array(z.string().min(1).max(1000)).max(30),
  actionPlan: actionPlan.optional(),
  corrections: corrections.optional(),
}).strict();
export const reportReplySchema = z.object({
  requestId: z.string().uuid(),
  digest: z.string().regex(/^(?:[a-f0-9]{64}|sha256-b64:[A-Za-z0-9_-]{43})$/),
  report: reportSchema,
}).strict();
export const qualityReportReplySchema = reportReplySchema.extend({
  report: reportSchema.extend({ actionPlan, corrections }),
});
const jsonSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { $refStrategy: "none" });
export const REPORT_REPLY_CONTRACT = {
  protocol: "business-report-handoff-v1",
  versions: { "0": jsonSchema(reportReplySchema), "1": jsonSchema(qualityReportReplySchema) },
  maxBodyCharacters: 180000,
  maxDiagnosticIssues: 64,
  http: {
    structuralRejection: 400, semanticRejection: 422, revisionConflict: 409,
    firstAcceptance: 202, identicalAcceptance: 200, expiredRequest: 410,
  },
  lifecycle: {
    cursorRule: "Advance past a handoff only after its 202 receipt or a matching identical-reply 200 receipt. Older stored replies without receipts return legacyAcceptance=true, jobId and requestId on their identical-reply 200; this is the documented legacy equivalent. Acceptance queues jury review; it is not final report approval or customer delivery.",
    getAfterAcceptance: "200 with status=accepted and the receipt; pending requests return status=pending; unaccepted expired requests return 410 with status=expired.",
    duplicateRule: "An identical parsed report for the same requestId and digest returns the original receipt. A different report or digest conflicts.",
  },
  semanticRules: [
    "Version 1: all action text fields must meet their minimum length after trimming whitespace; values are not rewritten.",
    "Sections must match the requested headings exactly once in order, each with at least 150 rendered characters.",
    "Fact blocks must quote one retained source verbatim. All source references must exist in the retained evidence; inline references must be bound to the block or action.",
    "Version 1: action priorities must be consecutive from 1. Every checklist ID needs exactly one corrected or removed disposition; resolution needs at least 20 non-padding characters.",
    "Version 1: no internal review/process narration in customer prose. Action fields must reference retained source IDs rather than embed URLs.",
    "Version 1: every section should begin with a highlighted bullet-point overview followed by detailed analysis and practical recommendations. The Executive Summary should cover all major sections. Editorial word counts are not acceptance gates; structural and request-size bounds still apply.",
    "For server-stamped detailed-v1 reports: the first block of each section must be a recommendation block with '-' overview bullets, followed by at least two recommendation blocks of substantive analysis and implementation guidance, each at least 150 characters. The first Executive Summary block must name every other section heading. Padding or generic advice still requires correction by the final jury.",
    "Request identity, digest, expiry, owner authorization, stop switch, jury approval and paid-review approval remain enforced independently.",
  ],
} as const;

export function reportReplyInstruction(version: number): string {
  return "AUTHORITATIVE REPLY CONTRACT: actionPlan and corrections belong INSIDE report, never beside requestId/digest. " +
    "Return the complete {requestId,digest,report} envelope matching the replyContract JSON Schema in this request. " +
    "\nAdditional enforced rules: " + REPORT_REPLY_CONTRACT.semanticRules
      .filter(rule => version === 1 || !rule.startsWith("Version 1:")).join(" ");
}

export type ReportReplyReceipt = {
  jobId: number; requestId: string; status: "accepted"; acceptedAt: string;
};
export type ReportReplyAcceptance = {
  digest: string; replyHash: string; receipt: ReportReplyReceipt;
};

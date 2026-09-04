import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { createDocx } from "./doc-create";
import { generateStyledPdf, type PdfSection } from "./pdf-create";
import { deliverDigitalProduct, readPersistedBundleFiles, type DeliveryResult } from "./delivery-pipeline";
import { readAndValidateDocxFile } from "./deliverable-verifier";
import { loadCmmcArtifact, persistCmmcArtifact } from "./cmmc-artifacts";
import {
  cmmcAssessments,
  cmmcReportExports,
  cmmcAssessmentSnapshots,
  deliveryLogs,
  type CmmcAssessment,
  type CmmcAssessmentSnapshot,
  type CmmcReportExport,
} from "@shared/schema";
import {
  CMMC_L1_CATALOG_VERSION,
  CMMC_L1_DISCLAIMER,
  CMMC_L1_REVIEW_DATE,
  CMMC_L1_REQUIREMENTS,
  type CmmcRequirement,
  CMMC_L1_SOURCE_CITATIONS,
  CMMC_L1_SELF_CERTIFICATION_TEXT,
  CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES,
  sanitizeCmmcDraft,
} from "@shared/cmmc-level1-fields";

function artifactName(companyName: string, revision: number, extension: "pdf" | "docx"): string {
  const prefix = "CMMC-Level-1-FCI-Preparation-";
  const suffix = `-R${revision}`;
  // The PDF/DOCX generators historically cap their basename at 60 characters.
  // Keep the revision inside that cap so newly generated reports retain their
  // deterministic name and can be delivered without a legacy compatibility path.
  const maxCompanyLength = Math.max(1, 60 - prefix.length - suffix.length);
  const company = companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, maxCompanyLength) || "customer";
  return `${prefix}${company}${suffix}.${extension}`;
}

export function resolveCmmcSnapshotIdentity(
  snapshot: CmmcAssessmentSnapshot,
  fallback: Pick<CmmcAssessment, "companyName" | "customerName" | "customerEmail">,
): Pick<CmmcAssessment, "companyName" | "customerName" | "customerEmail"> {
  const stored = snapshot.snapshot as Record<string, unknown>;
  const storedText = (key: "company" | "customerName" | "customerEmail", maxLength: number, fallbackValue: string) => (
    typeof stored[key] === "string" && stored[key].trim()
      ? stored[key].trim().slice(0, maxLength)
      : fallbackValue
  );
  return {
    companyName: storedText("company", 255, fallback.companyName),
    customerName: storedText("customerName", 255, fallback.customerName),
    customerEmail: storedText("customerEmail", 320, fallback.customerEmail),
  } as Pick<CmmcAssessment, "companyName" | "customerName" | "customerEmail">;
}

export function resolveCmmcSnapshotMetadata(snapshot: CmmcAssessmentSnapshot) {
  const stored = snapshot.snapshot as Record<string, unknown>;
  const storedCatalog = Array.isArray(stored.catalog) ? stored.catalog as CmmcRequirement[] : CMMC_L1_REQUIREMENTS;
  const catalogVersion = typeof stored.catalogVersion === "string" ? stored.catalogVersion : snapshot.catalogVersion || CMMC_L1_CATALOG_VERSION;
  const catalogReviewDate = typeof stored.catalogReviewDate === "string" ? stored.catalogReviewDate : CMMC_L1_REVIEW_DATE;
  const catalogRequirementCount = Number.isInteger(stored.catalogRequirementCount) ? stored.catalogRequirementCount as number : storedCatalog.length;
  const catalogObjectiveCount = Number.isInteger(stored.catalogObjectiveCount)
    ? stored.catalogObjectiveCount as number
    : storedCatalog.reduce((total, requirement) => total + requirement.objectivePrompts.length, 0);
  const disclaimer = typeof stored.disclaimer === "string" ? stored.disclaimer : CMMC_L1_DISCLAIMER;
  const selfCertification = typeof stored.selfCertification === "string" ? stored.selfCertification : CMMC_L1_SELF_CERTIFICATION_TEXT;
  const sourceCitations = Array.isArray(stored.sourceCitations) && stored.sourceCitations.every((citation) => typeof citation === "string")
    ? stored.sourceCitations
    : CMMC_L1_SOURCE_CITATIONS;
  return {
    catalog: storedCatalog,
    catalogVersion,
    catalogReviewDate,
    catalogRequirementCount,
    catalogObjectiveCount,
    disclaimer,
    selfCertification,
    sourceCitations,
  };
}

export function hasVerifiedCmmcDelivery(delivery: {
  success: boolean;
  emailSent?: boolean;
  linkVerified?: boolean;
  bundleFiles?: Array<{ success: boolean }>;
}): boolean {
  return delivery.success
    && Boolean(delivery.emailSent)
    && Boolean(delivery.linkVerified)
    && (!delivery.bundleFiles || delivery.bundleFiles.every((file) => file.success));
}

const CMMC_UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const CMMC_LEGACY_UPLOADS_ROOT = path.resolve(process.cwd(), "deliverables", "uploads");
const CMMC_GENERATED_FILENAME = /^CMMC-Level-1-FCI-Preparation-[a-z0-9-]+-R\d+\.(pdf|docx)$/i;

export class CmmcDeliveryInProgressError extends Error {
  constructor() {
    super("This CMMC report is already being delivered. Please retry shortly.");
  }
}

class CmmcDeliveryStatePersistenceError extends Error {}

// A CMMC delivery worker makes external Drive/email side effects. Never take
// its lease merely because its report bytes are unavailable; only a failed
// receipt, or a no-receipt lease older than the full delivery retry window, is
// safe to recover into a new report-generation attempt.
const CMMC_STALE_DELIVERY_RECOVERY_MS = 10 * 60 * 1_000;

export function resolveCmmcDeliveryFilePath(storedPath: string, ...expectedFileNames: string[]): string {
  const filename = path.basename(storedPath);
  const isExpectedCurrentName = expectedFileNames.includes(filename);
  const isAllowedGeneratedName = expectedFileNames.length > 0
    ? isExpectedCurrentName
    : CMMC_GENERATED_FILENAME.test(filename);
  if (!filename || filename === "." || filename === ".." || !isAllowedGeneratedName) {
    throw new Error("CMMC report path is not a generated uploads file");
  }
  if (storedPath === `/uploads/${filename}`) return path.join(CMMC_UPLOADS_ROOT, filename);

  // Older rows stored a workspace-relative render path below
  // deliverables/uploads. Preserve only that exact legacy shape; never accept
  // absolute filesystem paths or normalize traversal into an allowed location.
  const pathParts = storedPath.split("/");
  if (
    path.isAbsolute(storedPath)
    || !storedPath.startsWith("deliverables/uploads/")
    || pathParts.some((part) => part === "." || part === ".." || !part)
  ) {
    throw new Error("CMMC report path is outside the generated report roots");
  }
  const candidate = path.resolve(process.cwd(), storedPath);
  const relative = path.relative(CMMC_LEGACY_UPLOADS_ROOT, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("CMMC report path is outside the generated report roots");
  }
  return candidate;
}

export function cmmcReportPathsNeedRegeneration(
  report: Pick<CmmcReportExport, "status" | "pdfPath" | "docxPath" | "revision">,
  companyName: string,
): boolean {
  if (!["reports_ready", "delivery_failed"].includes(report.status)) return false;
  return report.pdfPath !== `/uploads/${artifactName(companyName, report.revision, "pdf")}`
    || report.docxPath !== `/uploads/${artifactName(companyName, report.revision, "docx")}`;
}

async function loadCmmcReportPair(
  report: Pick<CmmcReportExport, "pdfArtifactKey" | "docxArtifactKey" | "pdfSha256" | "docxSha256" | "pdfSize" | "docxSize">,
  tenantId: number,
): Promise<{ pdf: Buffer; docx: Buffer }> {
  const { pdfArtifactKey, docxArtifactKey, pdfSha256, docxSha256, pdfSize, docxSize } = report;
  if (
    !pdfArtifactKey
    || !docxArtifactKey
    || !pdfSha256
    || !docxSha256
    || typeof pdfSize !== "number"
    || typeof docxSize !== "number"
  ) {
    throw new Error("CMMC durable report pair is unavailable");
  }
  const [pdf, docx] = await Promise.all([
    loadCmmcArtifact({
      tenantId,
      artifactKey: pdfArtifactKey,
      expectedSha256: pdfSha256,
      expectedSize: pdfSize,
      kind: "pdf",
    }),
    loadCmmcArtifact({
      tenantId,
      artifactKey: docxArtifactKey,
      expectedSha256: docxSha256,
      expectedSize: docxSize,
      kind: "docx",
    }),
  ]);
  return { pdf: pdf.bytes, docx: docx.bytes };
}

export function assertCmmcReportSnapshotIntegrity(
  assessment: Pick<CmmcAssessment, "id">,
  report: Pick<CmmcReportExport, "assessmentId" | "revision" | "snapshotHash">,
  snapshot: Pick<CmmcAssessmentSnapshot, "assessmentId" | "revision" | "answerHash">,
): void {
  if (
    snapshot.assessmentId !== assessment.id
    || report.assessmentId !== assessment.id
    || snapshot.revision !== report.revision
    || snapshot.answerHash !== report.snapshotHash
  ) {
    throw new Error("CMMC report snapshot does not match the signed assessment export");
  }
}

export async function claimCmmcDelivery(report: CmmcReportExport, tenantId: number): Promise<CmmcReportExport> {
  if (report.status === "delivered") return report;
  if (report.status === "delivering") throw new CmmcDeliveryInProgressError();
  const [claimed] = await db.update(cmmcReportExports).set({ status: "delivering", updatedAt: new Date() })
    .where(and(
      eq(cmmcReportExports.id, report.id),
      eq(cmmcReportExports.tenantId, tenantId),
      inArray(cmmcReportExports.status, ["reports_ready", "delivery_failed"]),
    )).returning();
  if (claimed) return claimed;

  const [current] = await db.select().from(cmmcReportExports).where(and(
    eq(cmmcReportExports.id, report.id),
    eq(cmmcReportExports.tenantId, tenantId),
  )).limit(1);
  if (current?.status === "delivered") return current;
  if (current?.status === "delivering") throw new CmmcDeliveryInProgressError();
  throw new Error("CMMC report delivery could not be claimed safely");
}

export async function claimCmmcDeliveryForAssessment(
  report: CmmcReportExport,
  assessmentId: number,
  tenantId: number,
): Promise<CmmcReportExport> {
  if (report.status === "delivered") return report;
  if (report.status === "delivering") throw new CmmcDeliveryInProgressError();
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(cmmcReportExports).set({ status: "delivering", updatedAt: new Date() })
      .where(and(
        eq(cmmcReportExports.id, report.id),
        eq(cmmcReportExports.tenantId, tenantId),
        eq(cmmcReportExports.assessmentId, assessmentId),
        inArray(cmmcReportExports.status, ["reports_ready", "delivery_failed"]),
      )).returning();
    if (!claimed) {
      const [current] = await tx.select().from(cmmcReportExports).where(and(
        eq(cmmcReportExports.id, report.id),
        eq(cmmcReportExports.tenantId, tenantId),
        eq(cmmcReportExports.assessmentId, assessmentId),
      )).limit(1);
      if (current?.status === "delivered") return current;
      if (current?.status === "delivering") throw new CmmcDeliveryInProgressError();
      throw new Error("CMMC report delivery could not be claimed safely");
    }
    const [approved] = await tx.update(cmmcAssessments).set({ status: "approved", updatedAt: new Date() })
      .where(and(
        eq(cmmcAssessments.id, assessmentId),
        eq(cmmcAssessments.tenantId, tenantId),
        inArray(cmmcAssessments.status, [...CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES]),
      )).returning({ id: cmmcAssessments.id });
    if (!approved) {
      const [assessment] = await tx.select({ status: cmmcAssessments.status }).from(cmmcAssessments).where(and(
        eq(cmmcAssessments.id, assessmentId),
        eq(cmmcAssessments.tenantId, tenantId),
      )).limit(1);
      if (assessment?.status !== "approved") {
        throw new Error("Approved report assessment could not be recorded for this tenant");
      }
    }
    return claimed;
  });
}

export async function claimCmmcDeliveryWithReservedReceipt(
  report: CmmcReportExport,
  assessment: CmmcAssessment,
  snapshot: CmmcAssessmentSnapshot,
  tenantId: number,
): Promise<{ report: CmmcReportExport; deliveryId: number }> {
  if (report.status === "delivered") {
    if (!report.deliveryLogId) throw new CmmcDeliveryStatePersistenceError("Delivered CMMC report has no delivery receipt");
    return { report, deliveryId: report.deliveryLogId };
  }
  if (report.status === "delivering") throw new CmmcDeliveryInProgressError();

  const receiptKey = `cmmc-delivery-${assessment.id}-r${report.revision}`;
  const identity = resolveCmmcSnapshotIdentity(snapshot, assessment);
  return db.transaction(async (tx) => {
    const receiptValues = {
      tenantId,
      customerName: identity.customerName,
      customerEmail: identity.customerEmail,
      productName: "CMMC Level 1 / FCI Preparation Packet",
      fileName: artifactName(identity.companyName, report.revision, "pdf"),
      status: "reserved",
      idempotencyKey: receiptKey,
      metadata: { cmmcReportId: report.id, _deliveryMimeType: "application/pdf" },
    } as const;
    const [inserted] = await tx.insert(deliveryLogs).values(receiptValues).onConflictDoNothing({
      target: [deliveryLogs.tenantId, deliveryLogs.idempotencyKey],
      where: sql`idempotency_key IS NOT NULL`,
    }).returning();
    let receipt = inserted;
    if (!receipt) {
      const [existing] = await tx.select().from(deliveryLogs).where(and(
        eq(deliveryLogs.tenantId, tenantId),
        eq(deliveryLogs.idempotencyKey, receiptKey),
      )).limit(1);
      if (!existing) throw new Error("CMMC delivery receipt reservation could not be read");
      if (existing.status === "completed") {
        throw new CmmcDeliveryStatePersistenceError("Completed CMMC receipt must reconcile before a new claim");
      }
      if (existing.status !== "failed") throw new CmmcDeliveryInProgressError();
      const [revived] = await tx.update(deliveryLogs).set({
        status: "reserved",
        errorMessage: null,
      }).where(and(
        eq(deliveryLogs.id, existing.id),
        eq(deliveryLogs.tenantId, tenantId),
        eq(deliveryLogs.status, "failed"),
      )).returning();
      if (!revived) throw new CmmcDeliveryInProgressError();
      receipt = revived;
    }

    const [claimed] = await tx.update(cmmcReportExports).set({
      status: "delivering",
      deliveryLogId: receipt.id,
      updatedAt: new Date(),
    }).where(and(
      eq(cmmcReportExports.id, report.id),
      eq(cmmcReportExports.tenantId, tenantId),
      eq(cmmcReportExports.assessmentId, assessment.id),
      inArray(cmmcReportExports.status, ["reports_ready", "delivery_failed"]),
    )).returning();
    if (!claimed) throw new CmmcDeliveryInProgressError();

    const [approved] = await tx.update(cmmcAssessments).set({ status: "approved", updatedAt: new Date() })
      .where(and(
        eq(cmmcAssessments.id, assessment.id),
        eq(cmmcAssessments.tenantId, tenantId),
        inArray(cmmcAssessments.status, [...CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES]),
      )).returning({ id: cmmcAssessments.id });
    if (!approved) throw new Error("Approved report assessment could not be recorded for this tenant");
    return { report: claimed, deliveryId: receipt.id };
  });
}

async function recordCmmcDeliveryFailure(report: CmmcReportExport, tenantId: number, message: string): Promise<CmmcReportExport | null> {
  const ownershipFence = report.deliveryLogId
    ? [
      eq(cmmcReportExports.deliveryLogId, report.deliveryLogId),
      sql`EXISTS (
        SELECT 1 FROM delivery_logs
        WHERE delivery_logs.id = ${cmmcReportExports.deliveryLogId}
          AND delivery_logs.tenant_id = ${tenantId}
          AND delivery_logs.status = 'failed'
      )`,
    ]
    : [];
  const [failed] = await db.update(cmmcReportExports).set({
    status: "delivery_failed",
    errorMessage: message.slice(0, 2_000),
    updatedAt: new Date(),
  }).where(and(
    eq(cmmcReportExports.id, report.id),
    eq(cmmcReportExports.tenantId, tenantId),
    eq(cmmcReportExports.status, "delivering"),
    ...ownershipFence,
  )).returning();
  if (failed) return null;

  const [current] = await db.select().from(cmmcReportExports).where(and(
    eq(cmmcReportExports.id, report.id),
    eq(cmmcReportExports.tenantId, tenantId),
  )).limit(1);
  if (current?.status === "delivered") return current;
  throw new Error(`${message}; the CMMC delivery failure state could not be recorded safely`);
}

function snapshotControls(raw: unknown, catalog: CmmcRequirement[]): Record<string, {
  status: string;
  objectiveStatuses: Record<string, string>;
  objectiveRationales: Record<string, string>;
  owner: string;
  evidence: string;
  evidenceDate: string;
}> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return Object.fromEntries(catalog.map((requirement) => {
    const candidate = source[requirement.id] && typeof source[requirement.id] === "object"
      ? source[requirement.id] as Record<string, unknown>
      : {};
    const objectives = candidate.objectiveStatuses && typeof candidate.objectiveStatuses === "object"
      ? candidate.objectiveStatuses as Record<string, unknown>
      : {};
    const rationales = candidate.objectiveRationales && typeof candidate.objectiveRationales === "object"
      ? candidate.objectiveRationales as Record<string, unknown>
      : {};
    return [requirement.id, {
      status: candidate.status === "met" || candidate.status === "not_met" ? candidate.status : "",
      objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => {
        const status = objectives[String(index)];
        return [String(index), status === "met" || status === "not_met" || status === "not_applicable" ? status : ""];
      })),
      objectiveRationales: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [
        String(index),
        (() => {
          const rationale = rationales[String(index)];
          return typeof rationale === "string" ? rationale.trim().slice(0, 500) : "";
        })(),
      ])),
      owner: typeof candidate.owner === "string" ? candidate.owner : "",
      evidence: typeof candidate.evidence === "string" ? candidate.evidence : "",
      evidenceDate: typeof candidate.evidenceDate === "string" ? candidate.evidenceDate : "",
    }];
  }));
}

export function cmmcRetentionBasisLabel(provisional: boolean): string {
  return provisional
    ? "Provisional — server-recorded submission date until actual CMMC Status Date is known"
    : "CMMC Status Date";
}

function objectiveFindingLabel(status: string): string {
  if (status === "met") return "Met";
  if (status === "not_applicable") return "Not applicable";
  return "Not met";
}

function buildSections(assessment: CmmcAssessment, snapshot: CmmcAssessmentSnapshot): PdfSection[] {
  const stored = snapshot.snapshot as Record<string, unknown>;
  const identity = resolveCmmcSnapshotIdentity(snapshot, assessment);
  const metadata = resolveCmmcSnapshotMetadata(snapshot);
  const draft = sanitizeCmmcDraft({
    systemDescription: stored.systemDescription,
    cageCodes: stored.cageCodes,
    cmmcStatusDate: stored.cmmcStatusDate,
    controls: stored.controls,
    legacyControls: stored.legacyControls,
  });
  const answers = snapshotControls(stored.controls, metadata.catalog);
  const notMetCount = metadata.catalog.reduce((total, requirement) => {
    const answer = answers[requirement.id];
    return total + (answer.status === "not_met" ? 1 : 0) + Object.values(answer.objectiveStatuses).filter((status) => status === "not_met").length;
  }, 0);
  const notApplicableCount = metadata.catalog.reduce((total, requirement) => {
    const answer = answers[requirement.id];
    return total + Object.values(answer.objectiveStatuses).filter((status) => status === "not_applicable").length;
  }, 0);
  const level1SelfReady = typeof stored.level1SelfReady === "boolean"
    ? stored.level1SelfReady
    : metadata.catalog.every((requirement) => {
      const answer = answers[requirement.id];
      return answer.status === "met" && requirement.objectivePrompts.every((_, index) => {
        const status = answer.objectiveStatuses[String(index)];
        return status === "met" || (status === "not_applicable" && Boolean(answer.objectiveRationales[String(index)]));
      });
    });
  const retention = stored.retention && typeof stored.retention === "object" && !Array.isArray(stored.retention)
    ? stored.retention as Record<string, unknown>
    : {};
  const retentionProvisional = retention.provisional === true;
  const summary = level1SelfReady
    ? "Every customer-stated requirement and assessment objective is marked Met or documented Not applicable. This packet is preparation documentation only; the customer must separately enter its result in SPRS and have its Affirming Official affirm it there."
    : `This packet is NOT ready to be represented as a Final Level 1 (Self) result. ${notMetCount} customer-stated response(s) are marked Not met. Level 1 does not allow POA&Ms; each gap must be corrected and reassessed before the customer can represent a Final Level 1 (Self) result.`;
  const sections: PdfSection[] = [
    {
      title: "Important limitation",
      highlight: metadata.disclaimer,
      paragraphs: [
        "This packet is limited to CMMC Level 1 / Federal Contract Information preparation. Do not paste FCI, CUI, credentials, screenshots, logs, IP addresses, contract files, or diagrams into this service.",
          "The customer’s Affirming Official remains responsible for reviewing this customer-stated information and for any separate government process.",
      ],
    },
    {
      title: "Assessment profile",
      table: {
        headers: ["Field", "Customer-stated value"],
        rows: [
          ["Organization", identity.companyName],
          ["CMMC Assessment Scope", draft.systemDescription],
          ["Industry CAGE code(s)", draft.cageCodes || "Not provided — collect for SPRS preparation"],
          ["CMMC Status Date", draft.cmmcStatusDate || "Not yet recorded — preparation only"],
          ["Ruleset", metadata.catalogVersion],
          ["Catalog review date", metadata.catalogReviewDate],
          ["Requirements", String(metadata.catalogRequirementCount)],
          ["Objective checks", String(metadata.catalogObjectiveCount)],
          ["Not met answers", String(notMetCount)],
           ["Not applicable objectives", String(notApplicableCount)],
          ["Snapshot hash", snapshot.answerHash],
          ["Evidence retention basis", cmmcRetentionBasisLabel(retentionProvisional)],
          ["Retention through", `${snapshot.retentionUntil.toISOString().slice(0, 10)}${retentionProvisional ? " (provisional)" : ""}`],
        ],
      },
    },
    { title: "Customer-stated result", content: summary },
  ];

  for (const requirement of metadata.catalog) {
    const answer = answers[requirement.id];
    sections.push({
      title: `${requirement.number}. ${requirement.practice} — ${requirement.title}`,
      content: `Assessment Guide practice ${requirement.practice}. Baseline: ${requirement.baseline}`,
      table: {
        headers: ["Check", "Response"],
        rows: [
          ["Requirement status", answer.status === "met" ? "Met" : "Not met"],
          ...requirement.objectivePrompts.map((prompt, index) => [
            `${requirement.practice} [${requirement.objectiveLabels?.[index] || String.fromCharCode(97 + index)}] ${prompt}`,
            `${objectiveFindingLabel(answer.objectiveStatuses[String(index)])}${answer.objectiveStatuses[String(index)] === "not_applicable" ? ` — Rationale: ${answer.objectiveRationales[String(index)] || "Not provided"}` : ""}`,
          ]),
          ["Accountable owner", answer.owner || "Not provided"],
          ["Evidence locator", answer.evidence || "Not provided"],
          ["Evidence date", answer.evidenceDate || "Not provided"],
        ],
      },
    });
  }

  sections.push(
    {
      title: "Affirming Official acknowledgment",
      content: metadata.selfCertification,
      signature: snapshot.typedSignature,
      signatureAfterContent: true,
      table: {
        headers: ["Field", "Value"],
        rows: [
          ["Affirming Official", snapshot.authorizedOfficialName],
          ["Title", snapshot.authorizedOfficialTitle],
          ["Email", snapshot.authorizedOfficialEmail],
          ["Self-certification signature (typed name)", snapshot.typedSignature],
          ["Signed date", snapshot.signedAt.toISOString()],
          ["Submission timestamp", snapshot.submittedAt.toISOString()],
        ],
      },
    },
    { title: "Sources", bullets: [...metadata.sourceCitations] },
  );
  return sections;
}

function docxSections(sections: PdfSection[]) {
  return sections.map((section) => ({
    heading: section.title,
    content: [section.highlight, section.content, ...(section.paragraphs || [])].filter(Boolean).join("\n"),
    signatureText: section.signature,
    signatureAfterContent: section.signatureAfterContent,
    bullets: section.bullets,
    table: section.table,
  }));
}

export async function generateCmmcReportPair(params: {
  tenantId: number;
  assessment: CmmcAssessment;
  snapshot: CmmcAssessmentSnapshot;
  forceRegenerate?: boolean;
}): Promise<CmmcReportExport> {
  const key = `cmmc-l1-${params.assessment.id}-r${params.snapshot.revision}-${params.snapshot.answerHash}`;
  const [existing] = await db.select().from(cmmcReportExports).where(and(
    eq(cmmcReportExports.tenantId, params.tenantId),
    eq(cmmcReportExports.idempotencyKey, key),
  )).limit(1);
  if (existing && ["generating", "delivering", "delivered"].includes(existing.status)) {
    return existing;
  }
  if (existing && !params.forceRegenerate && ["reports_ready", "delivery_failed"].includes(existing.status)) {
    return existing;
  }

  let record = existing;
  if (!record) {
    const [inserted] = await db.insert(cmmcReportExports).values({
      tenantId: params.tenantId,
      assessmentId: params.assessment.id,
      snapshotId: params.snapshot.id,
      revision: params.snapshot.revision,
      snapshotHash: params.snapshot.answerHash,
      idempotencyKey: key,
      status: "generating",
    }).onConflictDoNothing({
      target: [cmmcReportExports.tenantId, cmmcReportExports.idempotencyKey],
    }).returning();
    record = inserted;
  }
  if (!record) {
    const [concurrent] = await db.select().from(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, params.tenantId),
      eq(cmmcReportExports.idempotencyKey, key),
    )).limit(1);
    if (!concurrent) throw new Error("Concurrent CMMC report creation did not produce an export record");
    if (["generating", "reports_ready", "delivering", "delivery_failed", "delivered"].includes(concurrent.status)) {
      return concurrent;
    }
    record = concurrent;
  }
  if (record.status !== "generating") {
    const eligibleStates = params.forceRegenerate
      ? ["reports_ready", "delivery_failed", "failed"]
      : ["failed"];
    const [claimed] = await db.update(cmmcReportExports).set({
      status: "generating",
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(cmmcReportExports.id, record.id),
      eq(cmmcReportExports.tenantId, params.tenantId),
      inArray(cmmcReportExports.status, eligibleStates),
    )).returning();
    if (!claimed) {
      const [current] = await db.select().from(cmmcReportExports).where(and(
        eq(cmmcReportExports.id, record.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
      )).limit(1);
      if (current && ["generating", "reports_ready", "delivering", "delivered"].includes(current.status)) return current;
      throw new Error("CMMC report recovery could not be claimed safely");
    }
    record = claimed;
  }

  try {
    const sections = buildSections(params.assessment, params.snapshot);
    const metadata = resolveCmmcSnapshotMetadata(params.snapshot);
    const identity = resolveCmmcSnapshotIdentity(params.snapshot, params.assessment);
    const title = identity.companyName;
    const pdfName = artifactName(identity.companyName, params.snapshot.revision, "pdf");
    const docxName = artifactName(identity.companyName, params.snapshot.revision, "docx");
    const [pdf, docx] = await Promise.all([
    generateStyledPdf({
      title,
       subtitle: "CMMC Level 1 Self-Assessment Preparation Packet — signed customer-stated responses",
      coverStats: [
        { label: "Requirements", value: String(metadata.catalogRequirementCount) },
        { label: "Objectives", value: String(metadata.catalogObjectiveCount) },
        { label: "Revision", value: String(params.snapshot.revision) },
      ],
      sections,
      fileName: pdfName.replace(/\.pdf$/, ""),
      uploadToDrive: false,
      tenantId: params.tenantId,
      includePlatformBranding: false,
    }),
    createDocx({
      title: identity.companyName,
       subtitle: "CMMC Level 1 Self-Assessment Preparation Packet — signed customer-stated responses",
      headerText: identity.companyName,
      includeFooter: false,
      sections: docxSections(sections),
      fileName: docxName.replace(/\.docx$/, ""),
      uploadToDrive: false,
    }),
    ]);

    const pdfPath = pdf.localPath;
    const docxPath = docx.localPath;
    const docxValid = Boolean(docx.success && docxPath && readAndValidateDocxFile(docxPath.replace(/^\//, "")));
    if (!pdf.success || !pdfPath || !docxValid || !docxPath) {
      throw new Error(`Paired report generation failed: PDF=${pdf.error || "ok"}; DOCX=${docx.error || (docxValid ? "ok" : "invalid")}`);
    }
    const [pdfBytes, docxBytes] = await Promise.all([
      fs.promises.readFile(resolveCmmcDeliveryFilePath(pdfPath, pdfName)),
      fs.promises.readFile(resolveCmmcDeliveryFilePath(docxPath, docxName)),
    ]);
    const [pdfArtifact, docxArtifact] = await Promise.all([
      persistCmmcArtifact({
        tenantId: params.tenantId,
        reportId: record.id,
        snapshotHash: params.snapshot.answerHash,
        kind: "pdf",
        originalName: pdfName,
        bytes: pdfBytes,
      }),
      persistCmmcArtifact({
        tenantId: params.tenantId,
        reportId: record.id,
        snapshotHash: params.snapshot.answerHash,
        kind: "docx",
        originalName: docxName,
        bytes: docxBytes,
      }),
    ]);
    const ready = await db.transaction(async (tx) => {
      const [report] = await tx.update(cmmcReportExports).set({
        status: "reports_ready",
        pdfPath,
        docxPath,
        pdfArtifactKey: pdfArtifact.artifactKey,
        docxArtifactKey: docxArtifact.artifactKey,
        pdfSha256: pdfArtifact.sha256,
        docxSha256: docxArtifact.sha256,
        pdfSize: pdfArtifact.size,
        docxSize: docxArtifact.size,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(cmmcReportExports.id, record.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
        eq(cmmcReportExports.status, "generating"),
      )).returning();
      if (!report) return null;
      const [assessment] = await tx.update(cmmcAssessments).set({ status: "report_ready", updatedAt: new Date() })
        .where(and(
          eq(cmmcAssessments.id, params.assessment.id),
          eq(cmmcAssessments.tenantId, params.tenantId),
          inArray(cmmcAssessments.status, ["submitted", "report_ready"]),
        )).returning({ id: cmmcAssessments.id });
      if (!assessment) {
        const [currentAssessment] = await tx.select({ status: cmmcAssessments.status }).from(cmmcAssessments).where(and(
          eq(cmmcAssessments.id, params.assessment.id),
          eq(cmmcAssessments.tenantId, params.tenantId),
        )).limit(1);
        if (!currentAssessment || !["approved", "delivered"].includes(currentAssessment.status)) {
          throw new Error("Report generation completed but the assessment status could not be recorded for this tenant");
        }
      }
      return report;
    });
    if (ready) return ready;
    const [current] = await db.select().from(cmmcReportExports).where(and(
      eq(cmmcReportExports.id, record.id),
      eq(cmmcReportExports.tenantId, params.tenantId),
    )).limit(1);
    if (current?.status === "reports_ready" || current?.status === "delivering" || current?.status === "delivered") return current;
    throw new Error("Report generation completed but a newer report state prevented recording it");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "Paired report generation failed";
    const [failed] = await db.update(cmmcReportExports).set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(and(
        eq(cmmcReportExports.id, record.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
        eq(cmmcReportExports.status, "generating"),
      )).returning();
    if (!failed) {
      const [current] = await db.select().from(cmmcReportExports).where(and(
        eq(cmmcReportExports.id, record.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
      )).limit(1);
      if (current?.status === "reports_ready" || current?.status === "delivered") return current;
      throw new Error(`${message}; the report failure state could not be recorded for this tenant`, { cause: error });
    }
    throw error;
  }
}

function cmmcDocxDriveFileId(files: DeliveryResult["bundleFiles"]): string | null {
  return files?.find((file) => file.success && /\.docx$/i.test(file.fileName))?.driveFileId || null;
}

/**
 * A report left in `delivering` is normally untouchable: an active worker may
 * still own its side effects. The one safe exception is a completed,
 * tenant-scoped receipt for this report's deterministic delivery key. That
 * receipt lets a retry finish the local state transaction without re-sending
 * the customer packet.
 */
export async function reconcileCompletedCmmcDelivery(params: {
  tenantId: number;
  assessment: CmmcAssessment;
  report: CmmcReportExport;
  reviewedBy: string;
}): Promise<CmmcReportExport | null> {
  if (params.report.status !== "delivering") return null;
  const receiptKey = `cmmc-delivery-${params.assessment.id}-r${params.report.revision}`;
  const [receipt] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.tenantId, params.tenantId),
    eq(deliveryLogs.idempotencyKey, receiptKey),
    eq(deliveryLogs.status, "completed"),
    eq(deliveryLogs.emailSent, true),
  )).limit(1);
  const bundleFiles = readPersistedBundleFiles(receipt?.metadata);
  const docxDriveFileId = cmmcDocxDriveFileId(bundleFiles);
  if (!receipt?.driveFileId || !docxDriveFileId) return null;

  return db.transaction(async (tx) => {
    const [deliveredReport] = await tx.update(cmmcReportExports).set({
      status: "delivered",
      reviewedAt: new Date(),
      reviewedBy: params.reviewedBy.slice(0, 200),
      approvedAt: new Date(),
      deliveredAt: new Date(),
      deliveryLogId: receipt.id,
      pdfDriveFileId: receipt.driveFileId,
      docxDriveFileId,
      driveFolderId: receipt.folderLink || null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(cmmcReportExports.id, params.report.id),
      eq(cmmcReportExports.tenantId, params.tenantId),
      eq(cmmcReportExports.assessmentId, params.assessment.id),
      eq(cmmcReportExports.status, "delivering"),
    )).returning();
    if (!deliveredReport) {
      const [current] = await tx.select().from(cmmcReportExports).where(and(
        eq(cmmcReportExports.id, params.report.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
      )).limit(1);
      return current?.status === "delivered" ? current : null;
    }
    const [assessment] = await tx.update(cmmcAssessments).set({ status: "delivered", updatedAt: new Date() })
      .where(and(
        eq(cmmcAssessments.id, params.assessment.id),
        eq(cmmcAssessments.tenantId, params.tenantId),
        inArray(cmmcAssessments.status, ["approved", "delivered"]),
      )).returning({ id: cmmcAssessments.id });
    if (!assessment) throw new Error("Completed CMMC delivery receipt could not finalize the assessment for this tenant");
    return deliveredReport;
  });
}

export async function recoverStaleCmmcDeliveryForArtifactRegeneration(
  report: CmmcReportExport,
  tenantId: number,
): Promise<CmmcReportExport> {
  if (report.status !== "delivering") return report;

  const receiptKey = `cmmc-delivery-${report.assessmentId}-r${report.revision}`;
  const [receipt] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.tenantId, tenantId),
    eq(deliveryLogs.idempotencyKey, receiptKey),
  )).orderBy(desc(deliveryLogs.id)).limit(1);
  if (receipt?.status === "completed") {
    // The regular reconciliation path already ran. A completed but malformed
    // receipt is an operator-visible persistence problem, never permission to
    // resend a report and risk duplicate customer email.
    throw new CmmcDeliveryStatePersistenceError(
      "Completed CMMC delivery receipt could not be reconciled; refusing duplicate recovery",
    );
  }
  if (receipt && receipt.status !== "failed") {
    throw new CmmcDeliveryInProgressError();
  }

  const staleBefore = new Date(Date.now() - CMMC_STALE_DELIVERY_RECOVERY_MS);
  const recoveryWhere = [
    eq(cmmcReportExports.id, report.id),
    eq(cmmcReportExports.tenantId, tenantId),
    eq(cmmcReportExports.status, "delivering"),
    ...(receipt?.status === "failed" ? [] : [lte(cmmcReportExports.updatedAt, staleBefore)]),
  ];
  const [recovered] = await db.update(cmmcReportExports).set({
    status: "delivery_failed",
    errorMessage: "Stale CMMC delivery recovered for durable artifact regeneration",
    updatedAt: new Date(),
  }).where(and(...recoveryWhere)).returning();
  if (recovered) return recovered;

  const [current] = await db.select().from(cmmcReportExports).where(and(
    eq(cmmcReportExports.id, report.id),
    eq(cmmcReportExports.tenantId, tenantId),
  )).limit(1);
  if (current?.status === "delivered") return current;
  throw new CmmcDeliveryInProgressError();
}

export async function deliverCmmcReportPair(params: {
  tenantId: number;
  assessment: CmmcAssessment;
  report: CmmcReportExport;
  reviewedBy: string;
}): Promise<CmmcReportExport> {
  const [snapshot] = await db.select().from(cmmcAssessmentSnapshots).where(and(
    eq(cmmcAssessmentSnapshots.id, params.report.snapshotId),
    eq(cmmcAssessmentSnapshots.tenantId, params.tenantId),
  )).limit(1);
  if (!snapshot) throw new Error("Submitted assessment snapshot is unavailable");
  assertCmmcReportSnapshotIntegrity(params.assessment, params.report, snapshot);

  let currentReport = params.report;
  const identity = resolveCmmcSnapshotIdentity(snapshot, params.assessment);
  const reconciled = await reconcileCompletedCmmcDelivery({ ...params, report: currentReport });
  if (reconciled) return reconciled;
  // A failed receipt owns no external side effects, so recover it before
  // loading artifacts. Legacy no-receipt rows still require the stale CAS.
  currentReport = await recoverStaleCmmcDeliveryForArtifactRegeneration(
    currentReport,
    params.tenantId,
  );
  if (currentReport.status === "delivered") return currentReport;
  let artifacts: { pdf: Buffer; docx: Buffer } | null = null;
  try {
    artifacts = await loadCmmcReportPair(currentReport, params.tenantId);
  } catch {
    // Legacy exports and corrupted/missing durable pairs are regenerated from
    // the signed snapshot before any approval or delivery claim is taken. A
    currentReport = await generateCmmcReportPair({
      tenantId: params.tenantId,
      assessment: params.assessment,
      snapshot,
      forceRegenerate: true,
    });
    artifacts = await loadCmmcReportPair(currentReport, params.tenantId);
  }
  const claim = await claimCmmcDeliveryWithReservedReceipt(
    currentReport,
    params.assessment,
    snapshot,
    params.tenantId,
  );
  const report = claim.report;
  try {
    if (!artifacts) throw new Error("Durable report files are unavailable");
    const metadata = resolveCmmcSnapshotMetadata(snapshot);
    const delivery: DeliveryResult = await deliverDigitalProduct({
      tenantId: params.tenantId,
      customerName: identity.customerName,
      customerEmail: identity.customerEmail,
      productName: "CMMC Level 1 / FCI Preparation Packet",
      fileData: artifacts.pdf,
      fileName: artifactName(identity.companyName, report.revision, "pdf"),
      mimeType: "application/pdf",
      additionalFiles: [{
        fileData: artifacts.docx,
        fileName: artifactName(identity.companyName, report.revision, "docx"),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        description: "Word preparation packet",
      }],
      requireAllFiles: true,
      idempotencyKey: `cmmc-delivery-${params.assessment.id}-r${report.revision}`,
      reservedDeliveryId: claim.deliveryId,
      metadata: { cmmcReportId: report.id },
      sendEmail: true,
      emailSubject: `Your CMMC Level 1 / FCI preparation packet`,
      emailBody: metadata.disclaimer,
    });
    if (delivery.inProgress) {
      if (delivery.error?.includes("Do not retry automatically")) {
        throw new CmmcDeliveryStatePersistenceError(delivery.error);
      }
      throw new CmmcDeliveryInProgressError();
    }
    if (!hasVerifiedCmmcDelivery(delivery)) throw new Error(delivery.error || "Verified paired delivery did not complete");
    let delivered: CmmcReportExport | null;
    try {
      delivered = await db.transaction(async (tx) => {
    const docxDriveFileId = cmmcDocxDriveFileId(delivery.bundleFiles);
    const [deliveredReport] = await tx.update(cmmcReportExports).set({
      status: "delivered",
      reviewedAt: new Date(),
      reviewedBy: params.reviewedBy.slice(0, 200),
      approvedAt: new Date(),
      deliveredAt: new Date(),
      deliveryLogId: delivery.deliveryId,
      pdfDriveFileId: delivery.driveFileId || null,
      docxDriveFileId,
      driveFolderId: delivery.folderLink || null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(cmmcReportExports.id, report.id),
      eq(cmmcReportExports.tenantId, params.tenantId),
      eq(cmmcReportExports.status, "delivering"),
    )).returning();
    if (!deliveredReport) return null;
    const [assessment] = await tx.update(cmmcAssessments).set({ status: "delivered", updatedAt: new Date() })
      .where(and(
        eq(cmmcAssessments.id, params.assessment.id),
        eq(cmmcAssessments.tenantId, params.tenantId),
        inArray(cmmcAssessments.status, ["approved", "delivered"]),
      )).returning({ id: cmmcAssessments.id });
    if (!assessment) throw new Error("Verified delivery completed but the assessment status could not be recorded for this tenant");
        return deliveredReport;
      });
    } catch (error) {
      throw new CmmcDeliveryStatePersistenceError("Verified delivery completed but its final state could not be recorded", { cause: error });
    }
    if (!delivered) {
      const [current] = await db.select().from(cmmcReportExports).where(and(
        eq(cmmcReportExports.id, report.id),
        eq(cmmcReportExports.tenantId, params.tenantId),
      )).limit(1);
      if (current?.status === "delivered") return current;
      throw new CmmcDeliveryStatePersistenceError("Verified delivery completed but a newer report state prevented recording it");
    }
    return delivered;
  } catch (error) {
    if (error instanceof CmmcDeliveryInProgressError || error instanceof CmmcDeliveryStatePersistenceError) throw error;
    const message = error instanceof Error ? error.message : "CMMC delivery failed before completion";
    const completed = await recordCmmcDeliveryFailure(report, params.tenantId, message);
    if (completed) return completed;
    throw error;
  }
}

export async function listCmmcReports(tenantId: number, assessmentId: number): Promise<CmmcReportExport[]> {
  return db.select().from(cmmcReportExports).where(and(
    eq(cmmcReportExports.tenantId, tenantId),
    eq(cmmcReportExports.assessmentId, assessmentId),
  ));
}
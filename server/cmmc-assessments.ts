import crypto from "node:crypto";
import { and, desc, eq, exists, gt, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  cmmcAssessments,
  cmmcAssessmentInvitations,
  cmmcAssessmentSnapshots,
  type CmmcAssessment,
  type CmmcAssessmentInvitation,
  type CmmcAssessmentSnapshot,
} from "@shared/schema";
import {
  CMMC_L1_CATALOG_VERSION,
  CMMC_ASSESSMENT_LOCKED_STATUSES,
  CMMC_L1_DISCLAIMER,
  CMMC_L1_REVIEW_DATE,
  emptyCmmcDraft,
  CMMC_L1_REQUIREMENTS,
  CMMC_L1_SELF_CERTIFICATION_TEXT,
  CMMC_L1_SOURCE_CITATIONS,
  cmmcProhibitedContentFields,
  isCmmcLevel1SelfReady,
  isCmmcAssessmentLocked,
  resolveCmmcRetention,
  sanitizeCmmcDraft,
  validateCmmcSubmission,
  type CmmcDraft,
  type CmmcSubmission,
} from "@shared/cmmc-level1-fields";

const INVITE_BYTES = 32;
const INVITE_DAYS = 30;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function assertTenantId(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
}

function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function snapshotHash(snapshot: unknown): string {
  return crypto.createHash("sha256").update(stableJson(snapshot), "utf8").digest("hex");
}

function invitationExpiry(): Date {
  return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

export interface CreatedCmmcAssessment {
  assessment: CmmcAssessment;
  token: string;
  expiresAt: Date;
}

export async function createCmmcAssessment(params: {
  tenantId: number;
  customerId?: number | null;
  companyName: string;
  customerName: string;
  customerEmail: string;
}): Promise<CreatedCmmcAssessment> {
  assertTenantId(params.tenantId);
  const token = crypto.randomBytes(INVITE_BYTES).toString("hex");
  const expiresAt = invitationExpiry();
  const [assessment] = await db.insert(cmmcAssessments).values({
    tenantId: params.tenantId,
    customerId: params.customerId ?? null,
    companyName: params.companyName.trim().slice(0, 255),
    customerName: params.customerName.trim().slice(0, 255),
    customerEmail: params.customerEmail.trim().slice(0, 320),
    status: "invited",
    draft: emptyCmmcDraft(),
  }).returning();
  await db.insert(cmmcAssessmentInvitations).values({
    tenantId: params.tenantId,
    assessmentId: assessment.id,
    tokenHash: hashInviteToken(token),
    expiresAt,
  });
  return { assessment, token, expiresAt };
}

export async function createCmmcInvitation(tenantId: number, assessmentId: number): Promise<{ token: string; expiresAt: Date }> {
  assertTenantId(tenantId);
  const result = await db.transaction(async (tx) => {
    const [claim] = await tx.update(cmmcAssessments).set({
      status: "inviting",
      updatedAt: new Date(),
    }).where(and(
      eq(cmmcAssessments.tenantId, tenantId),
      eq(cmmcAssessments.id, assessmentId),
      notInArray(cmmcAssessments.status, [...CMMC_ASSESSMENT_LOCKED_STATUSES]),
    )).returning({ id: cmmcAssessments.id });
    if (!claim) return null;

    await tx.update(cmmcAssessmentInvitations)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(cmmcAssessmentInvitations.tenantId, tenantId),
        eq(cmmcAssessmentInvitations.assessmentId, assessmentId),
        isNull(cmmcAssessmentInvitations.revokedAt),
      ));
    const token = crypto.randomBytes(INVITE_BYTES).toString("hex");
    const expiresAt = invitationExpiry();
    await tx.insert(cmmcAssessmentInvitations).values({
      tenantId,
      assessmentId,
      tokenHash: hashInviteToken(token),
      expiresAt,
    });
    const [assessment] = await tx.update(cmmcAssessments).set({ status: "invited", updatedAt: new Date() })
      .where(and(
        eq(cmmcAssessments.tenantId, tenantId),
        eq(cmmcAssessments.id, assessmentId),
        eq(cmmcAssessments.status, "inviting"),
      )).returning({ id: cmmcAssessments.id });
    if (!assessment) throw new Error("CMMC invitation claim was lost");
    return { token, expiresAt };
  });
  if (!result) throw new Error("Submitted assessments cannot receive a new invitation");
  return result;
}

export async function revokeCmmcInvitation(tenantId: number, assessmentId: number): Promise<boolean> {
  assertTenantId(tenantId);
  const changed = await db.update(cmmcAssessmentInvitations)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(cmmcAssessmentInvitations.tenantId, tenantId),
      eq(cmmcAssessmentInvitations.assessmentId, assessmentId),
      isNull(cmmcAssessmentInvitations.revokedAt),
    )).returning({ id: cmmcAssessmentInvitations.id });
  return changed.length > 0;
}

export async function getCmmcAccessByToken(token: string): Promise<{
  assessment: CmmcAssessment;
  invitation: CmmcAssessmentInvitation;
} | null> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  const [row] = await db.select({ assessment: cmmcAssessments, invitation: cmmcAssessmentInvitations })
    .from(cmmcAssessmentInvitations)
    .innerJoin(cmmcAssessments, and(
      eq(cmmcAssessments.id, cmmcAssessmentInvitations.assessmentId),
      eq(cmmcAssessments.tenantId, cmmcAssessmentInvitations.tenantId),
    ))
    .where(and(
      eq(cmmcAssessmentInvitations.tokenHash, hashInviteToken(token)),
      isNull(cmmcAssessmentInvitations.revokedAt),
      gt(cmmcAssessmentInvitations.expiresAt, new Date()),
    )).limit(1);
  return row || null;
}

export async function touchCmmcInvitation(tenantId: number, assessmentId: number, invitationId: number): Promise<void> {
  await db.update(cmmcAssessmentInvitations).set({ lastUsedAt: new Date() })
    .where(and(
      eq(cmmcAssessmentInvitations.tenantId, tenantId),
      eq(cmmcAssessmentInvitations.assessmentId, assessmentId),
      eq(cmmcAssessmentInvitations.id, invitationId),
      isNull(cmmcAssessmentInvitations.revokedAt),
      gt(cmmcAssessmentInvitations.expiresAt, new Date()),
    ));
}

export async function getCmmcAssessmentById(tenantId: number, id: number): Promise<CmmcAssessment | null> {
  assertTenantId(tenantId);
  const [row] = await db.select().from(cmmcAssessments)
    .where(and(eq(cmmcAssessments.tenantId, tenantId), eq(cmmcAssessments.id, id))).limit(1);
  return row || null;
}

export async function listCmmcAssessments(tenantId: number): Promise<CmmcAssessment[]> {
  assertTenantId(tenantId);
  return db.select().from(cmmcAssessments)
    .where(eq(cmmcAssessments.tenantId, tenantId))
    .orderBy(desc(cmmcAssessments.createdAt)).limit(100);
}

export async function saveCmmcDraftByToken(token: string, rawDraft: unknown): Promise<{
  ok: boolean;
  assessment?: CmmcAssessment;
}> {
  const access = await getCmmcAccessByToken(token);
  if (!access || isCmmcAssessmentLocked(access.assessment.status)) return { ok: false };
  const draft = sanitizeCmmcDraft(rawDraft);
  const [assessment] = await db.update(cmmcAssessments).set({
    draft,
    status: "draft",
    updatedAt: new Date(),
  }).where(and(
    eq(cmmcAssessments.id, access.assessment.id),
    eq(cmmcAssessments.tenantId, access.assessment.tenantId),
    notInArray(cmmcAssessments.status, [...CMMC_ASSESSMENT_LOCKED_STATUSES]),
    exists(db.select({ one: sql`1` }).from(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.id, access.invitation.id),
      eq(cmmcAssessmentInvitations.tenantId, access.assessment.tenantId),
      eq(cmmcAssessmentInvitations.assessmentId, access.assessment.id),
      isNull(cmmcAssessmentInvitations.revokedAt),
      gt(cmmcAssessmentInvitations.expiresAt, new Date()),
    ))),
  )).returning();
  if (assessment) await touchCmmcInvitation(access.assessment.tenantId, access.assessment.id, access.invitation.id);
  return { ok: Boolean(assessment), assessment };
}

export async function submitCmmcAssessmentByToken(token: string, input: Omit<CmmcSubmission, "company" | "draft" | "typedSignature"> & { draft: unknown }): Promise<{
  ok: boolean;
  missing: string[];
  assessment?: CmmcAssessment;
  snapshot?: CmmcAssessmentSnapshot;
}> {
  const access = await getCmmcAccessByToken(token);
  if (!access) return { ok: false, missing: [] };
  if (isCmmcAssessmentLocked(access.assessment.status)) {
    return { ok: false, missing: ["assessmentAlreadySubmitted"] };
  }
  // Inspect the original request before cleanText can truncate it. A signed
  // snapshot must reject restricted material rather than silently dropping it.
  const prohibitedContent = cmmcProhibitedContentFields(input.draft);
  if (prohibitedContent.length > 0) {
    return { ok: false, missing: prohibitedContent.map((field) => `prohibitedContent.${field}`) };
  }
  const authorizedOfficialName = cleanRequired(input.authorizedOfficialName, 200);
  const submission: CmmcSubmission = {
    ...input,
    authorizedOfficialName,
    typedSignature: authorizedOfficialName,
    company: access.assessment.companyName,
    draft: sanitizeCmmcDraft(input.draft),
  };
  const validation = validateCmmcSubmission(submission);
  if (!validation.ok) return { ok: false, missing: validation.missing };
  const draft = sanitizeCmmcDraft(submission.draft);
  const signedAt = new Date(submission.signedAt);
  if (Number.isNaN(signedAt.getTime())) return { ok: false, missing: ["signedAt"] };
  const submittedAt = new Date();
  const retention = resolveCmmcRetention(draft.cmmcStatusDate, submittedAt);
  const snapshot = {
    company: access.assessment.companyName,
    customerName: access.assessment.customerName,
    customerEmail: access.assessment.customerEmail,
    systemDescription: draft.systemDescription,
    cageCodes: draft.cageCodes,
    cmmcStatusDate: draft.cmmcStatusDate || null,
    retention: {
      basis: retention.provisional ? "provisional-signed-date" : "cmmc-status-date",
      anchorDate: retention.provisional ? submittedAt.toISOString().slice(0, 10) : draft.cmmcStatusDate,
      provisional: retention.provisional,
    },
    level1SelfReady: isCmmcLevel1SelfReady(draft),
    controls: draft.controls,
    legacyControls: draft.legacyControls,
    catalog: CMMC_L1_REQUIREMENTS,
    catalogVersion: CMMC_L1_CATALOG_VERSION,
    catalogReviewDate: CMMC_L1_REVIEW_DATE,
    catalogRequirementCount: CMMC_L1_REQUIREMENTS.length,
    catalogObjectiveCount: CMMC_L1_REQUIREMENTS.reduce((total, requirement) => total + requirement.objectivePrompts.length, 0),
    disclaimer: CMMC_L1_DISCLAIMER,
    selfCertification: CMMC_L1_SELF_CERTIFICATION_TEXT,
    sourceCitations: CMMC_L1_SOURCE_CITATIONS,
  };
  const answerHash = snapshotHash(snapshot);
  let result: { assessment: CmmcAssessment; snapshot: CmmcAssessmentSnapshot } | null;
  try {
    result = await db.transaction(async (tx) => {
      const [claim] = await tx.update(cmmcAssessments).set({
        status: "submitting",
        updatedAt: new Date(),
      }).where(and(
        eq(cmmcAssessments.id, access.assessment.id),
        eq(cmmcAssessments.tenantId, access.assessment.tenantId),
        notInArray(cmmcAssessments.status, [...CMMC_ASSESSMENT_LOCKED_STATUSES]),
      )).returning({ id: cmmcAssessments.id });
      if (!claim) return null;
      const [activeInvitation] = await tx.select({ id: cmmcAssessmentInvitations.id })
        .from(cmmcAssessmentInvitations)
        .where(and(
          eq(cmmcAssessmentInvitations.id, access.invitation.id),
          eq(cmmcAssessmentInvitations.tenantId, access.assessment.tenantId),
          eq(cmmcAssessmentInvitations.assessmentId, access.assessment.id),
          isNull(cmmcAssessmentInvitations.revokedAt),
          gt(cmmcAssessmentInvitations.expiresAt, new Date()),
        )).limit(1);
      if (!activeInvitation) throw new CmmcInvitationBecameInactiveError();
      const latest = await tx.select({ revision: cmmcAssessmentSnapshots.revision })
      .from(cmmcAssessmentSnapshots)
      .where(and(
        eq(cmmcAssessmentSnapshots.tenantId, access.assessment.tenantId),
        eq(cmmcAssessmentSnapshots.assessmentId, access.assessment.id),
      )).orderBy(desc(cmmcAssessmentSnapshots.revision)).limit(1);
      const revision = (latest[0]?.revision || 0) + 1;
      const [newSnapshot] = await tx.insert(cmmcAssessmentSnapshots).values({
      tenantId: access.assessment.tenantId,
      assessmentId: access.assessment.id,
      revision,
      catalogVersion: CMMC_L1_CATALOG_VERSION,
      answerHash,
      snapshot,
      authorizedOfficialName: cleanRequired(submission.authorizedOfficialName, 200),
      authorizedOfficialTitle: cleanRequired(submission.authorizedOfficialTitle, 200),
      authorizedOfficialEmail: cleanRequired(submission.authorizedOfficialEmail, 320),
      typedSignature: authorizedOfficialName,
      signedAt,
       retentionUntil: retention.retentionUntil,
      }).returning();
      const [updated] = await tx.update(cmmcAssessments).set({
      draft,
      submittedRevision: revision,
      submittedAt: new Date(),
      status: "submitted",
       retentionUntil: retention.retentionUntil,
      updatedAt: new Date(),
      }).where(and(
      eq(cmmcAssessments.id, access.assessment.id),
      eq(cmmcAssessments.tenantId, access.assessment.tenantId),
      eq(cmmcAssessments.status, "submitting"),
      )).returning();
      if (!updated) throw new Error("Assessment submission claim was lost");
      await tx.update(cmmcAssessmentInvitations).set({ lastUsedAt: new Date() })
        .where(and(
          eq(cmmcAssessmentInvitations.tenantId, access.assessment.tenantId),
          eq(cmmcAssessmentInvitations.assessmentId, access.assessment.id),
          eq(cmmcAssessmentInvitations.id, access.invitation.id),
          isNull(cmmcAssessmentInvitations.revokedAt),
          gt(cmmcAssessmentInvitations.expiresAt, new Date()),
        ));
      return { assessment: updated, snapshot: newSnapshot };
    });
  } catch (error) {
    if (error instanceof CmmcInvitationBecameInactiveError) return { ok: false, missing: [] };
    throw error;
  }
  if (!result) return { ok: false, missing: ["assessmentAlreadySubmitted"] };
  return { ok: true, missing: [], ...result };
}

class CmmcInvitationBecameInactiveError extends Error {}

function cleanRequired(value: string, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

export async function getCmmcSnapshot(tenantId: number, assessmentId: number, revision: number): Promise<CmmcAssessmentSnapshot | null> {
  assertTenantId(tenantId);
  const [row] = await db.select().from(cmmcAssessmentSnapshots).where(and(
    eq(cmmcAssessmentSnapshots.tenantId, tenantId),
    eq(cmmcAssessmentSnapshots.assessmentId, assessmentId),
    eq(cmmcAssessmentSnapshots.revision, revision),
  )).limit(1);
  return row || null;
}

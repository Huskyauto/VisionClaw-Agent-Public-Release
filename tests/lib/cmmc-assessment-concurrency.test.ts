import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  createCmmcAssessment,
  createCmmcInvitation,
  getCmmcAccessByToken,
  getCmmcAssessmentById,
  saveCmmcDraftByToken,
  submitCmmcAssessmentByToken,
} from "../../server/cmmc-assessments";
import { db } from "../../server/db";
import {
  cmmcAssessmentInvitations,
  cmmcAssessmentSnapshots,
  cmmcAssessments,
  cmmcReportExports,
  deliveryLogs,
} from "../../shared/schema";
import { CMMC_L1_REQUIREMENTS } from "../../shared/cmmc-level1-fields";
import {
  CmmcDeliveryInProgressError,
  claimCmmcDelivery,
  claimCmmcDeliveryForAssessment,
  claimCmmcDeliveryWithReservedReceipt,
  deliverCmmcReportPair,
  recoverStaleCmmcDeliveryForArtifactRegeneration,
} from "../../server/cmmc-report";

const runDatabaseIntegration = process.env.RUN_CMMC_DB_INTEGRATION === "1";

function completeDraft() {
  return {
    systemDescription: "QA workstations and approved email services.",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((requirement) => [
      requirement.id,
      {
        status: "met",
        objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "met"])),
        owner: "QA owner",
        evidence: "QA reference marker",
      },
    ])),
  };
}

test("CMMC invitation refresh and submission cannot reopen a signed assessment", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Invitation Race Check",
    customerName: "QA",
    customerEmail: "qa-cmmc-invitation-race@example.invalid",
  });

  try {
    const draft = completeDraft();
    const [submission, invitation] = await Promise.allSettled([
      submitCmmcAssessmentByToken(created.token, {
        authorizedOfficialName: "QA Official",
        authorizedOfficialTitle: "QA",
        authorizedOfficialEmail: "qa-cmmc-invitation-race@example.invalid",
        signedAt: new Date().toISOString(),
        draft,
      }),
      createCmmcInvitation(1, created.assessment.id),
    ]);

    assert.equal(submission.status, "fulfilled");
    const snapshots = await db.select().from(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    const assessment = await getCmmcAssessmentById(1, created.assessment.id);
    const staleDraftSave = await saveCmmcDraftByToken(created.token, {
      ...draft,
      systemDescription: "This stale request must never overwrite a signed response.",
    });

    if (submission.value.ok) {
      assert.equal(invitation.status, "rejected");
      assert.equal(assessment?.status, "submitted");
      assert.equal(snapshots.length, 1);
      assert.equal(staleDraftSave.ok, false);
    } else {
      assert.equal(invitation.status, "fulfilled");
      assert.equal(assessment?.status, "invited");
      assert.equal(snapshots.length, 0);
      assert.equal(await getCmmcAccessByToken(created.token), null);
      assert.equal(staleDraftSave.ok, false);
      assert.ok(await getCmmcAccessByToken(invitation.value.token));
    }
  } finally {
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});

test("CMMC delivery lease allows exactly one external delivery owner", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Delivery Lease Check",
    customerName: "QA",
    customerEmail: "qa-cmmc-delivery-lease@example.invalid",
  });

  try {
    const submission = await submitCmmcAssessmentByToken(created.token, {
      authorizedOfficialName: "QA Official",
      authorizedOfficialTitle: "QA",
      authorizedOfficialEmail: "qa-cmmc-delivery-lease@example.invalid",
      signedAt: new Date().toISOString(),
      draft: completeDraft(),
    });
    assert.equal(submission.ok, true);
    assert.ok(submission.snapshot);
    const [report] = await db.insert(cmmcReportExports).values({
      tenantId: 1,
      assessmentId: created.assessment.id,
      snapshotId: submission.snapshot.id,
      revision: submission.snapshot.revision,
      snapshotHash: submission.snapshot.answerHash,
      idempotencyKey: `qa-cmmc-delivery-lease-${created.assessment.id}`,
      status: "reports_ready",
      pdfPath: "/uploads/qa-cmmc-delivery-lease.pdf",
      docxPath: "/uploads/qa-cmmc-delivery-lease.docx",
    }).returning();

    const claims = await Promise.allSettled([
      claimCmmcDelivery(report, 1),
      claimCmmcDelivery(report, 1),
    ]);
    const successful = claims.filter((claim) => claim.status === "fulfilled");
    const rejected = claims.filter((claim) => claim.status === "rejected");
    assert.equal(successful.length, 1);
    assert.equal(successful[0].value.status, "delivering");
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof CmmcDeliveryInProgressError);
  } finally {
    await db.delete(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});

test("CMMC delivery claims a ready report and approves a submitted assessment atomically", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Submitted Delivery Approval",
    customerName: "QA",
    customerEmail: "qa-cmmc-submitted-delivery@example.invalid",
  });

  try {
    const submission = await submitCmmcAssessmentByToken(created.token, {
      authorizedOfficialName: "QA Official",
      authorizedOfficialTitle: "QA",
      authorizedOfficialEmail: "qa-cmmc-submitted-delivery@example.invalid",
      signedAt: new Date().toISOString(),
      draft: completeDraft(),
    });
    assert.equal(submission.ok, true);
    assert.ok(submission.snapshot);
    const [report] = await db.insert(cmmcReportExports).values({
      tenantId: 1,
      assessmentId: created.assessment.id,
      snapshotId: submission.snapshot.id,
      revision: submission.snapshot.revision,
      snapshotHash: submission.snapshot.answerHash,
      idempotencyKey: `qa-cmmc-submitted-delivery-${created.assessment.id}`,
      status: "reports_ready",
      pdfPath: "/uploads/qa-cmmc-submitted-delivery.pdf",
      docxPath: "/uploads/qa-cmmc-submitted-delivery.docx",
    }).returning();

    const claimed = await claimCmmcDeliveryForAssessment(report, created.assessment.id, 1);
    const assessment = await getCmmcAssessmentById(1, created.assessment.id);

    assert.equal(claimed.status, "delivering");
    assert.equal(assessment?.status, "approved");
  } finally {
    await db.delete(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});

test("CMMC delivery reconciles a stalled delivery only from its completed paired-delivery receipt", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Delivery Reconciliation",
    customerName: "QA",
    customerEmail: "qa-cmmc-delivery-reconcile@example.invalid",
  });
  let deliveryLogId: number | null = null;

  try {
    const submission = await submitCmmcAssessmentByToken(created.token, {
      authorizedOfficialName: "QA Official",
      authorizedOfficialTitle: "QA",
      authorizedOfficialEmail: "qa-cmmc-delivery-reconcile@example.invalid",
      signedAt: new Date().toISOString(),
      draft: completeDraft(),
    });
    assert.equal(submission.ok, true);
    assert.ok(submission.snapshot);
    const [readyReport] = await db.insert(cmmcReportExports).values({
      tenantId: 1,
      assessmentId: created.assessment.id,
      snapshotId: submission.snapshot.id,
      revision: submission.snapshot.revision,
      snapshotHash: submission.snapshot.answerHash,
      idempotencyKey: `qa-cmmc-delivery-reconcile-${created.assessment.id}`,
      status: "reports_ready",
      pdfPath: "/uploads/qa-cmmc-delivery-reconcile.pdf",
      docxPath: "/uploads/qa-cmmc-delivery-reconcile.docx",
    }).returning();
    const claimed = await claimCmmcDeliveryForAssessment(readyReport, created.assessment.id, 1);
    const [receipt] = await db.insert(deliveryLogs).values({
      tenantId: 1,
      customerName: "QA",
      customerEmail: "qa-cmmc-delivery-reconcile@example.invalid",
      productName: "CMMC Level 1 / FCI Preparation Packet",
      fileName: "qa-cmmc-delivery-reconcile.pdf",
      status: "completed",
      emailSent: true,
      driveFileId: "pdfDriveFile123",
      folderLink: "https://drive.google.com/drive/folders/customer-folder-123",
      idempotencyKey: `cmmc-delivery-${created.assessment.id}-r${submission.snapshot.revision}`,
      metadata: {
        _deliveryBundleFiles: [{
          fileName: "qa-cmmc-delivery-reconcile.docx",
          description: "Word preparation packet",
          driveFileId: "docxDriveFile123",
        }],
      },
    }).returning();
    deliveryLogId = receipt.id;
    const approvedAssessment = await getCmmcAssessmentById(1, created.assessment.id);
    assert.ok(approvedAssessment);

    const delivered = await deliverCmmcReportPair({
      tenantId: 1,
      assessment: approvedAssessment!,
      report: claimed,
      reviewedBy: "QA",
    });
    const finalAssessment = await getCmmcAssessmentById(1, created.assessment.id);

    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.deliveryLogId, receipt.id);
    assert.equal(delivered.pdfDriveFileId, "pdfDriveFile123");
    assert.equal(delivered.docxDriveFileId, "docxDriveFile123");
    assert.equal(finalAssessment?.status, "delivered");
  } finally {
    if (deliveryLogId) {
      await db.delete(deliveryLogs).where(and(eq(deliveryLogs.tenantId, 1), eq(deliveryLogs.id, deliveryLogId)));
    }
    await db.delete(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});

test("CMMC stale delivery recovery cannot preempt a fresh lease but releases an abandoned lease for regeneration", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Stale Delivery Recovery",
    customerName: "QA",
    customerEmail: "qa-cmmc-stale-delivery@example.invalid",
  });

  try {
    const submission = await submitCmmcAssessmentByToken(created.token, {
      authorizedOfficialName: "QA Official",
      authorizedOfficialTitle: "QA",
      authorizedOfficialEmail: "qa-cmmc-stale-delivery@example.invalid",
      signedAt: new Date().toISOString(),
      draft: completeDraft(),
    });
    assert.equal(submission.ok, true);
    assert.ok(submission.snapshot);
    const [readyReport] = await db.insert(cmmcReportExports).values({
      tenantId: 1,
      assessmentId: created.assessment.id,
      snapshotId: submission.snapshot.id,
      revision: submission.snapshot.revision,
      snapshotHash: submission.snapshot.answerHash,
      idempotencyKey: `qa-cmmc-stale-delivery-${created.assessment.id}`,
      status: "reports_ready",
    }).returning();
    const claimed = await claimCmmcDeliveryForAssessment(readyReport, created.assessment.id, 1);
    await assert.rejects(
      () => recoverStaleCmmcDeliveryForArtifactRegeneration(claimed, 1),
      CmmcDeliveryInProgressError,
    );

    const staleAt = new Date(Date.now() - 11 * 60 * 1_000);
    const [stale] = await db.update(cmmcReportExports).set({ updatedAt: staleAt }).where(and(
      eq(cmmcReportExports.id, claimed.id),
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.status, "delivering"),
    )).returning();
    assert.ok(stale);
    const recovered = await recoverStaleCmmcDeliveryForArtifactRegeneration(stale, 1);
    assert.equal(recovered.status, "delivery_failed");
  } finally {
    await db.delete(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});

test("CMMC reserves a durable delivery receipt in the same claim transaction", { skip: !runDatabaseIntegration }, async () => {
  const created = await createCmmcAssessment({
    tenantId: 1,
    companyName: "QA CMMC Receipt Reservation",
    customerName: "QA",
    customerEmail: "qa-cmmc-reservation@example.invalid",
  });
  let receiptId: number | null = null;

  try {
    const submission = await submitCmmcAssessmentByToken(created.token, {
      authorizedOfficialName: "QA Official",
      authorizedOfficialTitle: "QA",
      authorizedOfficialEmail: "qa-cmmc-reservation@example.invalid",
      signedAt: new Date().toISOString(),
      draft: completeDraft(),
    });
    assert.equal(submission.ok, true);
    assert.ok(submission.snapshot);
    const [readyReport] = await db.insert(cmmcReportExports).values({
      tenantId: 1,
      assessmentId: created.assessment.id,
      snapshotId: submission.snapshot.id,
      revision: submission.snapshot.revision,
      snapshotHash: submission.snapshot.answerHash,
      idempotencyKey: `qa-cmmc-receipt-reservation-${created.assessment.id}`,
      status: "reports_ready",
    }).returning();
    const assessment = await getCmmcAssessmentById(1, created.assessment.id);
    assert.ok(assessment);
    const claim = await claimCmmcDeliveryWithReservedReceipt(readyReport, assessment!, 1);
    receiptId = claim.deliveryId;
    const [receipt] = await db.select().from(deliveryLogs).where(and(
      eq(deliveryLogs.id, claim.deliveryId),
      eq(deliveryLogs.tenantId, 1),
    )).limit(1);

    assert.equal(claim.report.status, "delivering");
    assert.equal(claim.report.deliveryLogId, claim.deliveryId);
    assert.equal(receipt?.status, "reserved");
    await assert.rejects(
      () => claimCmmcDeliveryWithReservedReceipt(readyReport, assessment!, 1),
      CmmcDeliveryInProgressError,
    );
    await db.update(deliveryLogs).set({ status: "failed" }).where(and(
      eq(deliveryLogs.id, claim.deliveryId),
      eq(deliveryLogs.tenantId, 1),
      eq(deliveryLogs.status, "reserved"),
    ));
    const recovered = await recoverStaleCmmcDeliveryForArtifactRegeneration(claim.report, 1);
    assert.equal(recovered.status, "delivery_failed");
    const retried = await claimCmmcDeliveryWithReservedReceipt(recovered, assessment!, 1);
    assert.equal(retried.report.status, "delivering");
    assert.equal(retried.deliveryId, claim.deliveryId);
  } finally {
    if (receiptId) {
      await db.update(cmmcReportExports).set({ deliveryLogId: null }).where(and(
        eq(cmmcReportExports.tenantId, 1),
        eq(cmmcReportExports.assessmentId, created.assessment.id),
      ));
      await db.delete(deliveryLogs).where(and(
        eq(deliveryLogs.tenantId, 1),
        eq(deliveryLogs.id, receiptId),
      ));
    }
    await db.delete(cmmcReportExports).where(and(
      eq(cmmcReportExports.tenantId, 1),
      eq(cmmcReportExports.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentSnapshots).where(and(
      eq(cmmcAssessmentSnapshots.tenantId, 1),
      eq(cmmcAssessmentSnapshots.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessmentInvitations).where(and(
      eq(cmmcAssessmentInvitations.tenantId, 1),
      eq(cmmcAssessmentInvitations.assessmentId, created.assessment.id),
    ));
    await db.delete(cmmcAssessments).where(and(
      eq(cmmcAssessments.tenantId, 1),
      eq(cmmcAssessments.id, created.assessment.id),
    ));
  }
});
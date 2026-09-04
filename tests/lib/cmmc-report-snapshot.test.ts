import test from "node:test";
import assert from "node:assert/strict";
import { readPersistedBundleFiles } from "../../server/delivery-pipeline";
import {
  assertCmmcReportSnapshotIntegrity,
  cmmcRetentionBasisLabel,
  cmmcReportPathsNeedRegeneration,
  hasVerifiedCmmcDelivery,
  resolveCmmcDeliveryFilePath,
  resolveCmmcSnapshotIdentity,
  resolveCmmcSnapshotMetadata,
} from "../../server/cmmc-report";
import type { CmmcAssessmentSnapshot } from "../../shared/schema";

test("CMMC report metadata uses the submitted snapshot instead of current catalog copy", () => {
  const snapshot = {
    catalogVersion: "cmmc-l1-fci-historical",
    snapshot: {
      catalog: [{
        id: "historical-control",
        number: "AC.HIST",
        title: "Historical control wording",
        practice: "Historical practice wording.",
        baseline: "Historical baseline wording.",
        objectivePrompts: ["Historical objective wording."],
      }],
      catalogVersion: "cmmc-l1-fci-historical",
      catalogReviewDate: "January 1, 2026",
      catalogRequirementCount: 1,
      catalogObjectiveCount: 1,
      disclaimer: "Historical preparation disclaimer.",
      selfCertification: "Historical self-certification wording.",
      sourceCitations: ["Historical source citation."],
    },
  } as unknown as CmmcAssessmentSnapshot;

  const metadata = resolveCmmcSnapshotMetadata(snapshot);

  assert.equal(metadata.catalogVersion, "cmmc-l1-fci-historical");
  assert.equal(metadata.catalogReviewDate, "January 1, 2026");
  assert.equal(metadata.catalogRequirementCount, 1);
  assert.equal(metadata.catalogObjectiveCount, 1);
  assert.equal(metadata.disclaimer, "Historical preparation disclaimer.");
  assert.equal(metadata.selfCertification, "Historical self-certification wording.");
  assert.deepEqual(metadata.sourceCitations, ["Historical source citation."]);
  assert.equal(metadata.catalog[0]?.title, "Historical control wording");
});

test("CMMC regenerated reports and delivery retain their frozen customer identity", () => {
  const snapshot = {
    snapshot: {
      company: "Frozen Company",
      customerName: "Frozen Contact",
      customerEmail: "frozen@example.com",
    },
  } as unknown as CmmcAssessmentSnapshot;
  const liveAssessment = {
    companyName: "Changed Company",
    customerName: "Changed Contact",
    customerEmail: "changed@example.com",
  };

  assert.deepEqual(resolveCmmcSnapshotIdentity(snapshot, liveAssessment as any), {
    companyName: "Frozen Company",
    customerName: "Frozen Contact",
    customerEmail: "frozen@example.com",
  });
});

test("CMMC reports describe provisional retention using the server-recorded submission anchor", () => {
  assert.equal(
    cmmcRetentionBasisLabel(true),
    "Provisional — server-recorded submission date until actual CMMC Status Date is known",
  );
  assert.equal(cmmcRetentionBasisLabel(false), "CMMC Status Date");
});

test("CMMC delivery accepts an idempotent completed delivery without repeated bundle metadata", () => {
  assert.equal(hasVerifiedCmmcDelivery({ success: true, emailSent: true, linkVerified: true }), true);
  assert.equal(hasVerifiedCmmcDelivery({
    success: true,
    emailSent: true,
    linkVerified: true,
    bundleFiles: [{ success: false }],
  }), false);
});

test("completed paired-delivery metadata restores the companion Drive file after a CMMC state-write retry", () => {
  const files = readPersistedBundleFiles({
    _deliveryBundleFiles: [{
      fileName: "CMMC-Level-1-FCI-Preparation-Example-R1.docx",
      description: "Word preparation packet",
      driveFileId: "docxDriveFile123",
      downloadLink: "https://drive.google.com/uc?id=docxDriveFile123",
      shareableLink: "https://drive.google.com/file/d/docxDriveFile123/view",
    }],
  });

  assert.deepEqual(files, [{
    fileName: "CMMC-Level-1-FCI-Preparation-Example-R1.docx",
    description: "Word preparation packet",
    success: true,
    driveFileId: "docxDriveFile123",
    downloadLink: "https://drive.google.com/uc?id=docxDriveFile123",
    shareableLink: "https://drive.google.com/file/d/docxDriveFile123/view",
  }]);
});

test("malformed persisted bundle metadata never becomes a Drive file result", () => {
  assert.equal(readPersistedBundleFiles({
    _deliveryBundleFiles: [{ fileName: "report.docx", driveFileId: null }],
  }), undefined);
});

test("CMMC delivery resolves current and legacy generated report paths safely", () => {
  const filename = "CMMC-Level-1-FCI-Preparation-Lake-County-Tool-Works-North-Inc-R1.pdf";
  assert.equal(
    resolveCmmcDeliveryFilePath(`/uploads/${filename}`),
    `${process.cwd()}/uploads/${filename}`,
  );
  assert.equal(
    resolveCmmcDeliveryFilePath(`deliverables/uploads/project-assets/attached_assets/stress-test-output/${filename}`),
    `${process.cwd()}/deliverables/uploads/project-assets/attached_assets/stress-test-output/${filename}`,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`deliverables/uploads/../uploads/${filename}`),
    /outside the generated report roots/,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`deliverables/${filename}`),
    /outside the generated report roots/,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`${process.cwd()}/deliverables/uploads/${filename}`),
    /outside the generated report roots/,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath("deliverables/uploads/not-a-cmmc-report.pdf"),
    /not a generated uploads file/,
  );
});

test("CMMC delivery regenerates ambiguous historical filename truncations before delivery", () => {
  const canonicalName = "CMMC-Level-1-FCI-Preparation-Lake-County-Tool-Works-North-Inc-R1.pdf";
  const historicalTruncation = "CMMC-Level-1-FCI-Preparation-Lake-County-Tool-Works-North-In.pdf";

  assert.equal(cmmcReportPathsNeedRegeneration({
    status: "delivery_failed",
    revision: 1,
    pdfPath: `/uploads/${historicalTruncation}`,
    docxPath: `/uploads/${historicalTruncation.replace(/\.pdf$/, ".docx")}`,
  }, "Lake County Tool Works North Inc."), true);
  assert.equal(cmmcReportPathsNeedRegeneration({
    status: "delivery_failed",
    revision: 1,
    pdfPath: "/uploads/CMMC-Level-1-FCI-Preparation-Example-R1.pdf",
    docxPath: "/uploads/CMMC-Level-1-FCI-Preparation-Example-R1.docx",
  }, "Example"), false);
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`/uploads/${historicalTruncation}`, canonicalName),
    /not a generated uploads file/,
  );
});

test("CMMC delivery binds expected report paths to the exact company, revision, and file type", () => {
  const expectedPdf = "CMMC-Level-1-FCI-Preparation-Lake-County-Tool-Works-North-Inc-R1.pdf";
  const otherCompanyPdf = "CMMC-Level-1-FCI-Preparation-Another-Company-R1.pdf";
  const sameReportDocx = "CMMC-Level-1-FCI-Preparation-Lake-County-Tool-Works-North-Inc-R1.docx";

  assert.equal(
    resolveCmmcDeliveryFilePath(`/uploads/${expectedPdf}`, expectedPdf),
    `${process.cwd()}/uploads/${expectedPdf}`,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`/uploads/${otherCompanyPdf}`, expectedPdf),
    /not a generated uploads file/,
  );
  assert.throws(
    () => resolveCmmcDeliveryFilePath(`/uploads/${sameReportDocx}`, expectedPdf),
    /not a generated uploads file/,
  );
});

test("CMMC delivery refuses a signed snapshot that does not match its report export", () => {
  const assessment = { id: 101 };
  const report = { assessmentId: 101, revision: 2, snapshotHash: "a".repeat(64) };
  const matchingSnapshot = { assessmentId: 101, revision: 2, answerHash: "a".repeat(64) };

  assert.doesNotThrow(() => assertCmmcReportSnapshotIntegrity(assessment, report, matchingSnapshot));
  assert.throws(
    () => assertCmmcReportSnapshotIntegrity(assessment, report, { ...matchingSnapshot, assessmentId: 102 }),
    /does not match the signed assessment export/,
  );
  assert.throws(
    () => assertCmmcReportSnapshotIntegrity(assessment, report, { ...matchingSnapshot, revision: 3 }),
    /does not match the signed assessment export/,
  );
  assert.throws(
    () => assertCmmcReportSnapshotIntegrity(assessment, report, { ...matchingSnapshot, answerHash: "b".repeat(64) }),
    /does not match the signed assessment export/,
  );
});
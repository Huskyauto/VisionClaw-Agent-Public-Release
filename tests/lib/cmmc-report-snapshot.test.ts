import test from "node:test";
import assert from "node:assert/strict";
import { readPersistedBundleFiles } from "../../server/delivery-pipeline";
import {
  assertCmmcReportSnapshotIntegrity,
  buildCmmcReportSections,
  cmmcDocxSections,
  cmmcRetentionBasisLabel,
  cmmcReportPathsNeedRegeneration,
  hasVerifiedCmmcDelivery,
  resolveCmmcDeliveryFilePath,
  resolveCmmcSnapshotIdentity,
  resolveCmmcSnapshotMetadata,
} from "../../server/cmmc-report";
import type { CmmcAssessmentSnapshot } from "../../shared/schema";
import { CMMC_L1_REQUIREMENTS } from "../../shared/cmmc-level1-fields";

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

test("CMMC report rejects a malformed frozen catalog with a controlled error", () => {
  const snapshot = {
    snapshot: { catalog: [{ id: "broken", practice: "AC.BAD" }] },
  } as unknown as CmmcAssessmentSnapshot;
  assert.throws(() => resolveCmmcSnapshotMetadata(snapshot), /Invalid frozen CMMC catalog in signed snapshot/);
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

test("historical ready flags cannot overstate support under the objective-support report format", () => {
  const historicalCatalog = [{
    id: "historical-control",
    number: "01",
    title: "Historical control",
    practice: "AC.HIST",
    baseline: "Historical baseline",
    objectivePrompts: ["historical users are identified;"],
    objectiveLabels: ["a"],
  }];
  const snapshot = {
    catalogVersion: "historical-version",
    answerHash: "b".repeat(64),
    typedSignature: "Jordan Smith",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    signedAt: new Date("2026-01-01T00:00:00.000Z"),
    submittedAt: new Date("2026-01-01T00:00:01.000Z"),
    retentionUntil: new Date("2032-01-01T00:00:00.000Z"),
    snapshot: {
      company: "Historical Company",
      level1SelfReady: true,
      catalogVersion: "historical-version",
      catalog: historicalCatalog,
      controls: {
        "historical-control": {
          status: "met",
          objectiveStatuses: { "0": "met" },
          owner: "Historical owner",
          evidence: "Historical evidence folder",
          evidenceDate: "2026-01-01",
        },
      },
    },
  } as unknown as CmmcAssessmentSnapshot;
  const sections = buildCmmcReportSections({ companyName: "Fallback", customerName: "Fallback", customerEmail: "fallback@example.com" } as any, snapshot);
  assert.match(sections.find((section) => section.title === "Customer-stated result")?.content || "", /NOT ready/);
  assert.ok(sections.flatMap((section) => section.table?.rows || []).some((row) => row[0] === "Calculated requirement result — not an additional assessment question" && row[1] === "Not met / incomplete"));
});

test("CMMC PDF and Word section models show all 59 objective supports, scope, FCI flow, evidence, gaps, and affirmations", () => {
  const controls = Object.fromEntries(CMMC_L1_REQUIREMENTS.map((requirement) => [requirement.id, {
    objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), index === 0 && requirement.id === "access-authorized" ? "not_met" : "met"])),
    objectiveRationales: {},
    objectiveImplementations: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), `Current implementation for ${requirement.practice} objective ${index + 1}.`])),
    objectiveEvidenceLocators: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), [`Evidence register / ${requirement.practice} / ${index + 1}`]])),
    objectiveAssessmentMethods: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "examine_test"])),
    objectiveEvidenceOwners: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "IT Manager"])),
    objectiveEvidenceDates: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "2026-09-01"])),
    objectiveGapStatements: { "0": requirement.id === "access-authorized" ? "The access review is overdue." : "" },
    objectiveCorrectiveActions: { "0": { action: "Complete the review.", owner: "IT Manager", targetDate: "2026-09-30", completionEvidenceLocator: "Corrective action register / item 1", reassessmentDate: "2026-10-01" } },
    owner: "IT Manager",
    implementationSummary: "The safeguard operates through documented procedures and managed controls.",
    systemsCovered: "All systems in the stated FCI enclave.",
    exceptions: requirement.id === "access-authorized" ? "Overdue review identified." : "None identified",
    evidenceRecords: [{ type: "Control record", locator: `Evidence register / ${requirement.practice}`, owner: "IT Manager", date: "2026-09-01", reviewFrequency: "Quarterly", objectiveIds: requirement.objectivePrompts.map((_, index) => String(index)) }],
  }]));
  const snapshot = {
    catalogVersion: "current",
    answerHash: "a".repeat(64),
    typedSignature: "Jordan Smith",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President — authorized corporate officer",
    authorizedOfficialEmail: "jordan@example.com",
    signedAt: new Date("2026-09-01T12:00:00.000Z"),
    submittedAt: new Date("2026-09-01T12:00:01.000Z"),
    retentionUntil: new Date("2032-09-01T00:00:00.000Z"),
    snapshot: {
      company: "Frozen Company",
      customerName: "Frozen Contact",
      customerEmail: "frozen@example.com",
      systemDescription: "Managed workstations, approved staff, main office, and approved cloud services form the FCI enclave.",
      scopeType: "Enclave",
      inScopeLocations: "Main office",
      inScopeAssetCategories: ["Workstations", "Email", "Cloud/SaaS"],
      assetInventoryLocator: "Asset register / CMMC scope view",
      fciFlowSummary: "Receive through approved email, process on managed workstations, store in approved cloud services, then archive or dispose under policy.",
      externalServiceProviders: "Approved cloud provider — storage and email — reviewed 2026-09-01.",
      assessmentStartDate: "2026-08-20",
      assessmentCompletionDate: "2026-09-01",
      assessmentParticipants: "IT Manager and President",
      controls,
      catalog: CMMC_L1_REQUIREMENTS,
      catalogRequirementCount: 15,
      catalogObjectiveCount: 59,
      affirmations: {
        scopeReviewed: true,
        objectivesReviewed: true,
        metSupportConfirmed: true,
        notApplicableRationalesConfirmed: true,
        notMetNotRepresentedAsCompliant: true,
        preparationOnlyUnderstood: true,
      },
    },
  } as unknown as CmmcAssessmentSnapshot;
  const assessment = { companyName: "Changed Company", customerName: "Changed", customerEmail: "changed@example.com" } as any;

  const pdfSections = buildCmmcReportSections(assessment, snapshot);
  const allRows = pdfSections.flatMap((section) => section.table?.rows || []);
  const requirementRows = pdfSections.filter((section) => CMMC_L1_REQUIREMENTS.some((requirement) => section.title.startsWith(`${requirement.number}. `))).flatMap((section) => section.table?.rows || []);
  const officialObjectiveLabels = new Set(CMMC_L1_REQUIREMENTS.flatMap((requirement) => requirement.objectivePrompts.map((prompt, index) => `${requirement.practice} [${requirement.objectiveLabels[index]}] ${prompt}`)));
  assert.equal(requirementRows.filter((row) => officialObjectiveLabels.has(row[0])).length, 59);
  assert.ok(pdfSections.some((section) => section.title === "Gaps and corrective actions"));
  assert.ok(pdfSections.some((section) => section.title === "Evidence index — locators only"));
  assert.ok(allRows.some((row) => row[0] === "FCI flow summary" && /Receive through approved email/.test(row[1])));
  assert.ok(allRows.some((row) => row[0] === "Calculated requirement summaries" && row[1] === "15"));
  assert.ok(allRows.some((row) => row[0] === "Met objectives" && row[1] === "58"));
  assert.ok(allRows.some((row) => row[0] === "Met objectives missing adequate narrative or locator" && row[1] === "0"));
  assert.ok(allRows.some((row) => row[0] === "Met support confirmed" && row[1] === "Confirmed"));
  assert.ok(allRows.some((row) => row[0].includes("AC.L1-b.1.i [a] gap") && row[1] === "The access review is overdue."));
  assert.ok(allRows.some((row) => row[0] === "Supports" || row[2]?.includes("Evidence register")));

  const wordSections = cmmcDocxSections(pdfSections);
  assert.equal(wordSections.length, pdfSections.length);
  assert.equal(wordSections.filter((section) => CMMC_L1_REQUIREMENTS.some((requirement) => section.heading.startsWith(`${requirement.number}. `))).flatMap((section) => section.table?.rows || []).filter((row) => officialObjectiveLabels.has(row[0])).length, 59);
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
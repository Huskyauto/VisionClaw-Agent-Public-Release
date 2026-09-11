import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CMMC_ASSESSMENT_LOCKED_STATUSES,
  CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES,
  CMMC_L1_REQUIREMENTS,
  CMMC_L1_OBJECTIVE_COUNT,
  CMMC_L1_SELF_CERTIFICATION_TEXT,
  cmmcProhibitedContentFields,
  cmmcNotApplicableCount,
  isCmmcAssessmentLocked,
  isCmmcLevel1SelfReady,
  resolveCmmcRetention,
  sanitizeCmmcDraft,
  validateCmmcSubmission,
  describeCmmcValidationIssues,
} from "../../shared/cmmc-level1-fields";

test("CMMC missing-answer guidance names the exact requirement support and jump section", () => {
  const issues = describeCmmcValidationIssues([
    "controls.access-authorized.objectiveEvidenceDate.0",
    "controls.access-authorized.objectiveCorrectiveAction.1",
    "controls.access-authorized.objectiveCorrectiveAction.1",
    "assessmentParticipants",
  ]);

  assert.deepEqual(issues.map((issue) => issue.sectionId), [
    "cmmc-objective-access-authorized-0",
    "cmmc-objective-access-authorized-1",
    "cmmc-profile",
  ]);
  assert.match(issues[0].label, /Requirement 01 Objective 1 \(a\).*valid last-verified date/i);
  assert.match(issues[1].label, /corrective action, owner, target date/i);
  assert.equal(issues[2].label, "List the people who participated in the assessment.");
});

test("CMMC prohibited content stays attached to its requirement and objective progress", () => {
  const issues = describeCmmcValidationIssues([
    "prohibitedContent.controls.access-authorized.objectiveImplementation.0",
    "prohibitedContent.controls.access-authorized.objectiveEvidenceLocator.1.2",
    "prohibitedContent.controls.access-authorized.objectiveCorrectiveAction.2.action",
  ]);

  assert.deepEqual(issues.map((issue) => issue.objectiveIndex), [0, 1, 2]);
  assert.deepEqual(issues.map((issue) => issue.sectionId), [
    "cmmc-objective-access-authorized-0",
    "cmmc-objective-access-authorized-1",
    "cmmc-objective-access-authorized-2",
  ]);
  assert.equal(issues[1].targetId, "cmmc-field-access-authorized-objectiveEvidenceLocators-1");
  assert.equal(issues[2].targetId, "cmmc-field-access-authorized-objectiveCorrectiveAction-action-2");
  assert.match(issues[0].label, /Requirement 01 Objective 1 \(a\).*prohibited content/i);
});

test("CMMC shared-evidence mapping guidance targets the exact evidence row", () => {
  const [issue, addIssue] = describeCmmcValidationIssues([
    "controls.access-authorized.objectiveEvidenceMapping.2.1",
    "controls.access-authorized.objectiveEvidenceMapping.3.add",
  ]);

  assert.equal(issue.objectiveIndex, 2);
  assert.equal(issue.sectionId, "cmmc-objective-access-authorized-2");
  assert.equal(issue.targetId, "cmmc-field-access-authorized-evidenceRecords-1-objectiveIds");
  assert.equal(addIssue.targetId, "cmmc-field-access-authorized-evidenceRecords");
});

test("CMMC indexed asset-category issues target the rendered category input", () => {
  const [issue] = describeCmmcValidationIssues([
    "prohibitedContent.inScopeAssetCategories.0",
  ]);

  assert.equal(issue.sectionId, "cmmc-profile");
  assert.equal(issue.targetId, "cmmc-field-inScopeAssetCategories");
});

function completeDraft() {
  return {
    systemDescription: "Office workstations and approved cloud email used for federal contract work.",
    scopeType: "enclave",
    inScopeLocations: "Main office and approved remote work locations.",
    inScopeAssetCategories: ["workstations", "email", "cloud_saas"],
    assetInventoryLocator: "Asset register / CMMC scope view",
    fciFlowSummary: "FCI is received through approved email, processed on managed workstations, stored in the approved cloud service, and disposed under the records procedure.",
    assessmentStartDate: "2026-08-20",
    assessmentCompletionDate: "2026-08-25",
    assessmentParticipants: "IT Manager and President",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((requirement) => [
      requirement.id,
      {
        objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "met"])),
        objectiveImplementations: Object.fromEntries(requirement.objectivePrompts.map((prompt, index) => [String(index), `The organization currently ensures ${prompt.replace(/[;.]$/, "")} through a documented process covering every in-scope asset and a scheduled review.`])),
        objectiveEvidenceLocators: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), [`Control record / ${requirement.practice} / objective ${index + 1}`]])),
        objectiveAssessmentMethods: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "examine_test"])),
        objectiveEvidenceOwners: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "IT Manager"])),
        objectiveEvidenceDates: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "2026-08-25"])),
        objectiveRationales: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), ""])),
        objectiveGapStatements: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), ""])),
        objectiveCorrectiveActions: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), {
          action: "",
          owner: "",
          targetDate: "",
          completionEvidenceLocator: "",
          reassessmentDate: "",
        }])),
        owner: "IT Manager",
        implementationSummary: "The organization operates this safeguard through documented procedures and managed technical controls.",
        systemsCovered: "All systems and locations in the stated FCI scope.",
        exceptions: "None identified",
        evidenceRecords: [{
          type: "Control record",
          locator: `Control record / ${requirement.practice}`,
          owner: "IT Manager",
          date: "2026-08-25",
          reviewFrequency: "Quarterly",
          objectiveIds: requirement.objectivePrompts.map((_, index) => String(index)),
        }],
      },
    ])),
    affirmations: {
      scopeReviewed: true,
      objectivesReviewed: true,
      metSupportConfirmed: true,
      notApplicableRationalesConfirmed: true,
      notMetNotRepresentedAsCompliant: true,
      preparationOnlyUnderstood: true,
    },
  };
}

test("CMMC Level 1 contract stays fixed at 15 requirements and 59 objective checks", () => {
  assert.equal(CMMC_L1_REQUIREMENTS.length, 15);
  assert.equal(CMMC_L1_OBJECTIVE_COUNT, 59);
  assert.equal(
    CMMC_L1_REQUIREMENTS.reduce((total, requirement) => total + requirement.objectivePrompts.length, 0),
    59,
  );
});

test("CMMC Level 1 catalog mirrors the official practice IDs and objective distribution", () => {
  assert.deepEqual(
    CMMC_L1_REQUIREMENTS.map((requirement) => ({
      id: requirement.id,
      practice: requirement.practice,
      objectives: requirement.objectivePrompts.length,
    })),
    [
      { id: "access-authorized", practice: "AC.L1-b.1.i", objectives: 6 },
      { id: "access-functions", practice: "AC.L1-b.1.ii", objectives: 2 },
      { id: "external-connections", practice: "AC.L1-b.1.iii", objectives: 6 },
      { id: "public-information", practice: "AC.L1-b.1.iv", objectives: 5 },
      { id: "identify-users", practice: "IA.L1-b.1.v", objectives: 3 },
      { id: "authenticate-users", practice: "IA.L1-b.1.vi", objectives: 3 },
      { id: "media-disposal", practice: "MP.L1-b.1.vii", objectives: 2 },
      { id: "physical-access", practice: "PE.L1-b.1.viii", objectives: 4 },
      { id: "physical-visitors", practice: "PE.L1-b.1.ix", objectives: 6 },
      { id: "communications", practice: "SC.L1-b.1.x", objectives: 8 },
      { id: "subnetworks", practice: "SC.L1-b.1.xi", objectives: 2 },
      { id: "flaw-remediation", practice: "SI.L1-b.1.xii", objectives: 6 },
      { id: "malicious-code", practice: "SI.L1-b.1.xiii", objectives: 2 },
      { id: "malicious-code-updates", practice: "SI.L1-b.1.xiv", objectives: 1 },
      { id: "security-alerts", practice: "SI.L1-b.1.xv", objectives: 3 },
    ],
  );
  assert.equal(CMMC_L1_REQUIREMENTS[0]!.objectivePrompts[0], "authorized users are identified;");
  assert.equal(CMMC_L1_REQUIREMENTS[8]!.objectivePrompts[0], "visitors are escorted;");
  assert.match(CMMC_L1_REQUIREMENTS[14]!.objectivePrompts[2]!, /real-time malicious code scans/i);
  assert.equal(CMMC_L1_REQUIREMENTS[0]!.objectiveGuidance.length, 6);
});

test("CMMC terminal assessment states remain locked after a response is signed", () => {
  assert.deepEqual(CMMC_ASSESSMENT_LOCKED_STATUSES, ["inviting", "submitting", "submitted", "report_ready", "approved", "delivered"]);
  for (const status of CMMC_ASSESSMENT_LOCKED_STATUSES) assert.equal(isCmmcAssessmentLocked(status), true);
  assert.equal(isCmmcAssessmentLocked("draft"), false);
  assert.equal(isCmmcAssessmentLocked("invited"), false);
  assert.equal(isCmmcAssessmentLocked(undefined), false);
});

test("CMMC delivery can approve a freshly submitted assessment after claiming its report", () => {
  assert.deepEqual(CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES, ["submitted", "report_ready", "approved"]);
});

test("CMMC draft sanitizer accepts only declared controls, supported findings, and capped owner/evidence/rationale fields", () => {
  const draft = sanitizeCmmcDraft({
    ...completeDraft(),
    controls: {
      ...completeDraft().controls,
      "access-authorized": {
        ...completeDraft().controls["access-authorized"],
        objectiveStatuses: { "0": "met", "1": "partial", "2": "not_met", "3": "not_applicable", "999": "met" },
        objectiveRationales: { "3": "C".repeat(700), "999": "Should not persist" },
        owner: "A".repeat(500),
        evidence: "B".repeat(2_000),
      },
      "unapproved-control": { status: "met", owner: "Attacker", evidence: "Should not persist" },
    },
  });

  assert.equal(Object.keys(draft.controls).length, 15);
  assert.equal(draft.controls["unapproved-control"], undefined);
  assert.equal(draft.controls["access-authorized"].objectiveStatuses["1"], "");
  assert.equal(draft.controls["access-authorized"].objectiveStatuses["3"], "not_applicable");
  assert.equal(draft.controls["access-authorized"].objectiveStatuses["999"], undefined);
  assert.equal(draft.controls["access-authorized"].objectiveRationales["3"].length, 500);
  assert.equal(draft.controls["access-authorized"].objectiveRationales["999"], undefined);
  assert.equal(draft.controls["access-authorized"].owner.length, 200);
  assert.equal(draft.controls["access-authorized"].evidence.length, 1_000);
});

test("CMMC submission rejects missing objective answers and requires an authorized-official typed signature", () => {
  const draft = completeDraft();
  draft.controls["access-authorized"].objectiveStatuses["0"] = "";

  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "",
    signedAt: "",
    draft,
  });

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("controls.access-authorized.objective.0"));
  assert.ok(result.missing.includes("typedSignature"));
  assert.ok(result.missing.includes("signedAt"));
});

test("every Met objective requires implementation, locator, method, owner, and current evidence date", () => {
  const draft = completeDraft();
  const answer = draft.controls["access-authorized"];
  answer.objectiveImplementations["0"] = "";
  answer.objectiveEvidenceLocators["1"] = [];
  answer.objectiveAssessmentMethods["2"] = "";
  answer.objectiveEvidenceOwners["3"] = "";
  answer.objectiveEvidenceDates["4"] = "";
  answer.objectiveEvidenceDates["5"] = "2099-01-01";
  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("controls.access-authorized.objectiveImplementation.0"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveEvidenceLocators.1"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveAssessmentMethod.2"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveEvidenceOwner.3"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveEvidenceDate.4"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveEvidenceDate.5"));
});

test("Not Met requires a gap and corrective action while Not Applicable requires a scope rationale", () => {
  const draft = completeDraft();
  draft.controls["access-authorized"].objectiveStatuses["0"] = "not_met";
  draft.controls["access-authorized"].objectiveStatuses["1"] = "not_applicable";
  let result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  });
  assert.ok(result.missing.includes("controls.access-authorized.objectiveGapStatement.0"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveCorrectiveAction.0.action"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveCorrectiveAction.0.owner"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveRationale.1"));

  draft.controls["access-authorized"].objectiveGapStatements["0"] = "The quarterly review was not completed.";
  draft.controls["access-authorized"].objectiveCorrectiveActions["0"] = {
    action: "Complete and document the review.",
    owner: "IT Manager",
    targetDate: "2026-09-30",
    completionEvidenceLocator: "Corrective action register / item 1",
    reassessmentDate: "2026-10-01",
  };
  draft.controls["access-authorized"].objectiveRationales["1"] = "This process type cannot occur within the defined FCI enclave, and policy prevents it from entering the boundary.";
  result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  });
  assert.equal(result.ok, true, result.missing.join(", "));
  assert.equal(isCmmcLevel1SelfReady(draft), false);
});

test("CMMC preparation accepts an optional Status Date only in ISO calendar form", () => {
  const invalidDraft = { ...completeDraft(), cageCodes: "1A2B3, 4C5D6", cmmcStatusDate: "August 25, 2026" };
  const invalid = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft: invalidDraft,
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.missing.includes("cmmcStatusDate"));

  const valid = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft: { ...invalidDraft, cmmcStatusDate: "2026-08-25" },
  });
  assert.equal(valid.ok, true);
});

test("CMMC draft migration preserves old split physical-access answers without treating them as official answers", () => {
  const { ["physical-visitors"]: _newPhysicalVisitors, ...legacyOnlyControls } = completeDraft().controls;
  const migrated = sanitizeCmmcDraft({
    ...completeDraft(),
    controls: {
      ...legacyOnlyControls,
      "visitor-escort": {
        status: "met",
        objectiveStatuses: { "0": "met", "1": "met", "2": "met", "3": "met" },
        owner: "Facilities lead",
        evidence: "Visitor ledger location",
        evidenceDate: "2026-08-24",
      },
      "physical-logs": {
        status: "not_met",
        objectiveStatuses: { "0": "not_met", "1": "met", "2": "met", "3": "met" },
        owner: "Facilities lead",
        evidence: "Badge reader location",
      },
    },
  });

  assert.equal(migrated.controls["physical-visitors"].status, "");
  assert.equal(migrated.legacyControls?.["visitor-escort"]?.evidence, "Visitor ledger location");
  assert.equal(migrated.legacyControls?.["physical-logs"]?.objectiveStatuses["0"], "not_met");
});

test("a Not met response cannot be represented as Final Level 1 self readiness", () => {
  const draft = sanitizeCmmcDraft(completeDraft());
  assert.equal(isCmmcLevel1SelfReady(draft), true);
  draft.controls["access-authorized"].objectiveStatuses["0"] = "not_met";
  assert.equal(isCmmcLevel1SelfReady(draft), false);
});

test("a documented Not applicable objective can be ready, while an unsupported one blocks submission and readiness", () => {
  const draft = sanitizeCmmcDraft(completeDraft());
  draft.controls["subnetworks"].objectiveStatuses["0"] = "not_applicable";
  assert.equal(isCmmcLevel1SelfReady(draft), false);
  assert.equal(cmmcNotApplicableCount(draft), 1);

  const invalid = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.missing.includes("controls.subnetworks.objectiveRationale.0"));

  draft.controls["subnetworks"].objectiveRationales["0"] = "The assessed FCI environment has no publicly accessible system components; the external website is outside this FCI scope.";
  assert.equal(isCmmcLevel1SelfReady(draft), true);
  assert.equal(validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  }).ok, true);
});

test("CMMC submission requires a meaningful multi-part FCI scope", () => {
  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft: { ...completeDraft(), systemDescription: "Workstations" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("systemDescription"));
});

test("CMMC rejects restricted content before it can become a draft or signed packet", () => {
  const draft = completeDraft();
  draft.controls["access-authorized"].evidence = `${"x".repeat(1_100)} api_key=sk-this-must-not-be-stored`;
  draft.controls["subnetworks"].objectiveRationales = {
    "0": "CUI — do not store this restricted material in the assessment packet.",
  };
  (draft.controls as Record<string, any>)["visitor-escort"] = {
    status: "met",
    owner: "Facilities",
    evidence: "GET /restricted HTTP/1.1",
  };
  assert.deepEqual(cmmcProhibitedContentFields(draft), [
    "controls.access-authorized.evidence",
    "controls.subnetworks.objectiveRationale.0",
    "legacyControls.visitor-escort.evidence",
  ]);
  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-08-25T14:30:00.000Z",
    draft,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("prohibitedContent.controls.access-authorized.evidence"));
  assert.ok(result.missing.includes("prohibitedContent.controls.subnetworks.objectiveRationale.0"));
  assert.ok(result.missing.includes("prohibitedContent.legacyControls.visitor-escort.evidence"));
});

test("CMMC rejects prohibited evidence content across every new objective support field", () => {
  const draft = completeDraft();
  const control = draft.controls["access-authorized"];
  control.objectiveImplementations["0"] = "password=hunter2";
  control.objectiveEvidenceLocators["1"] = ["10.0.0.12"];
  control.objectiveGapStatements["2"] = "CUI must not be pasted here";
  control.objectiveCorrectiveActions["3"] = {
    action: "See GET /private HTTP/1.1",
    owner: "IT Manager",
    targetDate: "2026-09-30",
    completionEvidenceLocator: "Ticket queue",
    reassessmentDate: "2026-10-01",
  };
  const blocked = cmmcProhibitedContentFields(draft);
  assert.ok(blocked.includes("controls.access-authorized.objectiveImplementation.0"));
  assert.ok(blocked.includes("controls.access-authorized.objectiveEvidenceLocator.1.0"));
  assert.ok(blocked.includes("controls.access-authorized.objectiveGapStatement.2"));
  assert.ok(blocked.includes("controls.access-authorized.objectiveCorrectiveAction.3.action"));
});

test("CMMC raw-content gate covers profile categories and every requirement evidence text field", () => {
  const draft = completeDraft();
  draft.scopeType = "password=do-not-store";
  draft.inScopeAssetCategories = ["Workstations", "10.0.0.12"];
  const evidence = draft.controls["access-authorized"].evidenceRecords[0];
  evidence.type = "CUI document";
  evidence.reviewFrequency = "GET /private HTTP/1.1";
  const blocked = cmmcProhibitedContentFields(draft);
  assert.ok(blocked.includes("scopeType"));
  assert.ok(blocked.includes("inScopeAssetCategories.1"));
  assert.ok(blocked.includes("controls.access-authorized.evidenceRecords.0.type"));
  assert.ok(blocked.includes("controls.access-authorized.evidenceRecords.0.reviewFrequency"));
});

test("material exceptions and generic support prevent a calculated Met result", () => {
  const draft = completeDraft();
  draft.controls["access-authorized"].exceptions = "Quarterly access review is overdue.";
  draft.controls["access-functions"].objectiveImplementations["0"] = "We comply.";
  draft.controls["external-connections"].objectiveEvidenceLocators["0"] = ["computer"];
  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-09-01T14:30:00.000Z",
    draft,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("controls.access-authorized.exceptionsConflict"));
  assert.ok(result.missing.includes("controls.access-functions.objectiveImplementation.0"));
  assert.ok(result.missing.includes("controls.external-connections.objectiveEvidenceLocators.0"));
  assert.equal(isCmmcLevel1SelfReady(draft), false);
});

test("eight-word compliance slogans and opaque locator strings cannot support Met", () => {
  const draft = completeDraft();
  draft.controls["access-authorized"].objectiveImplementations["0"] = "We comply with this control policy every day always.";
  draft.controls["access-authorized"].objectiveEvidenceLocators["0"] = ["abcdefgh1234"];
  const result = validateCmmcSubmission({
    company: "Lake County Tool Works North",
    authorizedOfficialName: "Jordan Smith",
    authorizedOfficialTitle: "President",
    authorizedOfficialEmail: "jordan@example.com",
    typedSignature: "Jordan Smith",
    signedAt: "2026-09-01T14:30:00.000Z",
    draft,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("controls.access-authorized.objectiveImplementation.0"));
  assert.ok(result.missing.includes("controls.access-authorized.objectiveEvidenceLocators.0"));
});

test("a material exception blocks readiness even when one objective is validly Not Applicable", () => {
  const draft = completeDraft();
  draft.controls["subnetworks"].objectiveStatuses["0"] = "not_applicable";
  draft.controls["subnetworks"].objectiveRationales["0"] = "The defined FCI enclave has no publicly accessible components, and policy prevents those components from entering this boundary.";
  draft.controls["subnetworks"].exceptions = "The annual separation review is overdue.";
  assert.equal(isCmmcLevel1SelfReady(draft), false);
});

test("CMMC evidence retention is provisional until an actual Status Date is supplied", () => {
  const signedAt = new Date("2026-08-25T14:30:00.000Z");
  const provisional = resolveCmmcRetention("", signedAt);
  assert.equal(provisional.provisional, true);
  assert.equal(provisional.retentionUntil.toISOString().slice(0, 10), "2032-08-25");

  const confirmed = resolveCmmcRetention("2026-09-01", signedAt);
  assert.equal(confirmed.provisional, false);
  assert.equal(confirmed.retentionUntil.toISOString().slice(0, 10), "2032-09-01");
});

test("CMMC self-certification language stays scoped to customer preparation documentation", () => {
  assert.match(CMMC_L1_SELF_CERTIFICATION_TEXT, /complete and truthful/i);
  assert.match(CMMC_L1_SELF_CERTIFICATION_TEXT, /not a CMMC certification/i);
  assert.match(CMMC_L1_SELF_CERTIFICATION_TEXT, /notary service/i);
});
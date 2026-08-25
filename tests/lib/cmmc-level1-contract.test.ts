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
} from "../../shared/cmmc-level1-fields";

function completeDraft() {
  return {
    systemDescription: "Office workstations and approved cloud email used for federal contract work.",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((requirement) => [
      requirement.id,
      {
        status: "met",
        objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "met"])),
        owner: "IT Manager",
        evidence: "Access-review folder / 2026-Q3 review record",
      },
    ])),
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
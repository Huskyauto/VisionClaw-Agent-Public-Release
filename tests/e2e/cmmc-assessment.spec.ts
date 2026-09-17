import { test, expect, type Page } from "@playwright/test";
import {
  CMMC_AFFIRMATION_KEYS,
  CMMC_L1_REQUIREMENTS,
  CMMC_L1_SELF_CERTIFICATION_TEXT,
} from "../../shared/cmmc-level1-fields";

const TOKEN = "questionnaire-validation-test";
const CURRENT_DATE = "2026-09-06";
const FUTURE_DATE = "2026-09-07";
const FIXED_NOW = new Date(`${CURRENT_DATE}T12:00:00.000Z`);
const AFFIRMATION_LABELS = [
  "I reviewed the complete assessment scope.",
  "I reviewed all 59 objective findings.",
  "Each Met finding has a truthful implementation explanation and retrievable supporting evidence.",
  "Not Applicable findings have scope-based rationales.",
  "Known Not Met findings are not being represented as compliant.",
  "I understand this packet is not an SPRS submission or third-party certification.",
] as const;

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_NOW });
});

function completeDraft() {
  const evidenceDate = CURRENT_DATE;
  return {
    systemDescription: "Office workstations and approved cloud email used for federal contract work.",
    scopeType: "enclave",
    inScopeLocations: "Main office and approved remote work locations.",
    inScopeAssetCategories: ["workstations", "email", "cloud_saas"],
    assetInventoryLocator: "Asset register / CMMC scope view",
    fciFlowSummary: "FCI is received through approved email, processed on managed workstations, stored in the approved cloud service, and disposed under the records procedure.",
    externalServiceProviders: "None",
    assessmentStartDate: evidenceDate,
    assessmentCompletionDate: evidenceDate,
    assessmentParticipants: "IT Manager and President",
    cageCodes: "",
    cmmcStatusDate: "",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((requirement) => [
      requirement.id,
      {
        objectiveStatuses: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "met"])),
        objectiveImplementations: Object.fromEntries(requirement.objectivePrompts.map((prompt, index) => [
          String(index),
          `The organization currently ensures ${prompt.replace(/[;.]$/, "")} through a documented process covering every in-scope asset and a scheduled review.`,
        ])),
        objectiveEvidenceLocators: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [
          String(index),
          [`Control record / ${requirement.practice} / objective ${index + 1}`],
        ])),
        objectiveAssessmentMethods: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "examine_test"])),
        objectiveAssessmentNotes: {},
        objectiveEvidenceOwners: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), "IT Manager"])),
        objectiveEvidenceDates: Object.fromEntries(requirement.objectivePrompts.map((_, index) => [String(index), evidenceDate])),
        objectiveGapStatements: {},
        objectiveCorrectiveActions: {},
        objectiveConfidence: {},
        objectiveRationales: {},
        owner: "IT Manager",
        implementationSummary: "The organization operates this safeguard through documented procedures and managed technical controls.",
        systemsCovered: "All systems and locations in the stated FCI scope.",
        exceptions: "None identified",
        evidenceRecords: [{
          type: "Control record",
          locator: `Control record / ${requirement.practice}`,
          owner: "IT Manager",
          date: evidenceDate,
          reviewFrequency: "Quarterly",
          objectiveIds: requirement.objectivePrompts.map((_, index) => String(index)),
        }],
      },
    ])),
    affirmations: Object.fromEntries(CMMC_AFFIRMATION_KEYS.map((key) => [key, true])),
  };
}

function completeCorrectiveAction() {
  return {
    action: "Complete and document the overdue account review.",
    owner: "IT Manager",
    targetDate: "2026-09-20",
    completionEvidenceLocator: "Corrective action register / item 1",
    reassessmentDate: "2026-09-21",
  };
}

async function openQuestionnaire(
  page: Page,
  draft = completeDraft(),
  requirements = CMMC_L1_REQUIREMENTS,
) {
  await page.route(`**/api/public/cmmc/${TOKEN}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assessment: { status: "draft", draft },
        requirements,
        disclaimer: "Customer-prepared assessment.",
        selfCertification: CMMC_L1_SELF_CERTIFICATION_TEXT,
      }),
    });
  });
  await page.goto(`/cmmc/assessment/${TOKEN}`);
  await expect(page.getByText("CMMC Level 1 self-assessment preparation questionnaire", { exact: true })).toBeVisible();
}

async function fillAffirmingOfficial(page: Page, email = "jordan@example.com") {
  await page.getByTestId("input-authorizedOfficialName").fill("Jordan Smith");
  await page.getByTestId("input-authorizedOfficialTitle").fill("President");
  await page.getByTestId("input-authorizedOfficialEmail").fill(email);
}

function submitButton(page: Page) {
  return page.getByTestId("button-submit-cmmc");
}

async function jumpToIssue(page: Page, issueLabel: RegExp, targetId: string) {
  const progressPanel = page.getByText("Assessment progress", { exact: true }).locator("xpath=ancestor::div[contains(@class,'sticky')]");
  await progressPanel.locator("summary").click();
  await progressPanel.getByRole("button", { name: issueLabel }).click();

  const target = page.locator(`[id="${targetId}"]`);
  await expect(target).toBeVisible();
  await expect.poll(async () => target.evaluate((element) => (
    element === document.activeElement || element.contains(document.activeElement)
  ))).toBe(true);
  await expect.poll(async () => {
    const panelBox = await progressPanel.boundingBox();
    const targetBox = await target.boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    return Boolean(
      panelBox
      && targetBox
      && targetBox.y >= panelBox.y + panelBox.height
      && targetBox.y + targetBox.height <= viewportHeight,
    );
  }).toBe(true);
}

test("unfinished-answer jumps focus every stable target below the sticky progress panel", async ({ page }) => {
  test.setTimeout(900_000);
  const unexpectedWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET"
      && request.url().includes(`/api/public/cmmc/${TOKEN}`)
    ) unexpectedWrites.push(`${request.method()} ${request.url()}`);
  });
  const cases: Array<{
    name: string;
    prepare: (draft: ReturnType<typeof completeDraft>) => void;
    prepareAfterOpen?: (page: Page) => Promise<void>;
    issueLabel: RegExp;
    targetId: string;
    requirementId?: string;
  }> = [
    ...([
      ["systemDescription", /Describe the FCI assessment scope/i],
      ["scopeType", /Select the assessment-scope type/i],
      ["inScopeLocations", /List the locations included/i],
      ["inScopeAssetCategories", /List at least one in-scope asset category/i],
      ["assetInventoryLocator", /Enter where the asset inventory/i],
      ["fciFlowSummary", /Describe how FCI is received/i],
      ["assessmentStartDate", /Enter the assessment start date/i],
      ["assessmentCompletionDate", /Enter the assessment completion date/i],
      ["assessmentParticipants", /List the people who participated/i],
      ["cmmcStatusDate", /Enter the CMMC Status Date/i],
    ] as const).map(([field, issueLabel]) => ({
      name: `profile ${field}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => {
        if (field === "inScopeAssetCategories") draft.inScopeAssetCategories = [];
        else (draft as Record<string, unknown>)[field] = field === "cmmcStatusDate" ? "not-a-date" : "";
      },
      issueLabel,
      targetId: `cmmc-field-${field}`,
    })),
    ...([
      ["authorizedOfficialName", /^Enter the Affirming Official's name\.$/i],
      ["authorizedOfficialTitle", /Enter the Affirming Official's title/i],
      ["authorizedOfficialEmail", /Enter a valid business email/i],
    ] as const).map(([field, issueLabel]) => ({
      name: `official ${field}`,
      prepare: () => {},
      prepareAfterOpen: async (currentPage: Page) => {
        await currentPage.getByTestId(`input-${field}`).fill(field === "authorizedOfficialEmail" ? "invalid" : "");
      },
      issueLabel,
      targetId: `cmmc-field-${field}`,
    })),
    ...([
      ["owner", /accountable control owner/i],
      ["systemsCovered", /systems and locations covered/i],
      ["implementationSummary", /how the requirement is implemented/i],
      ["exceptions", /state any exceptions/i],
    ] as const).map(([field, issueLabel]) => ({
      name: `requirement ${field}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => { draft.controls["access-authorized"][field] = ""; },
      issueLabel: new RegExp(`Requirement 01.*${issueLabel.source}`, "i"),
      targetId: `cmmc-field-access-authorized-${field}`,
      requirementId: "access-authorized",
    })),
    {
      name: "requirement evidenceRecords",
      prepare: (draft) => { draft.controls["access-authorized"].evidenceRecords = []; },
      issueLabel: /Requirement 01.*primary evidence record/i,
      targetId: "cmmc-field-access-authorized-evidenceRecords",
      requirementId: "access-authorized",
    },
    {
      name: "requirement exceptions conflict",
      prepare: (draft) => { draft.controls["access-authorized"].exceptions = "Quarterly access review is overdue."; },
      issueLabel: /Requirement 01.*change the exceptions/i,
      targetId: "cmmc-field-access-authorized-exceptions",
      requirementId: "access-authorized",
    },
    {
      name: "objective status",
      prepare: (draft) => { draft.controls["access-authorized"].objectiveStatuses["0"] = ""; },
      issueLabel: /Requirement 01 Objective 1 \(a\).*choose Met/i,
      targetId: "cmmc-field-access-authorized-objective-0",
      requirementId: "access-authorized",
    },
    ...([
      ["objectiveImplementations", "objectiveImplementation", /implementation explanation/i],
      ["objectiveEvidenceLocators", "objectiveEvidenceLocators", /evidence locator/i],
      ["objectiveAssessmentMethods", "objectiveAssessmentMethod", /select how the evidence was assessed/i],
      ["objectiveEvidenceOwners", "objectiveEvidenceOwner", /owner of the evidence/i],
      ["objectiveEvidenceDates", "objectiveEvidenceDate", /last-verified date/i],
    ] as const).map(([draftField, targetField, issueLabel]) => ({
      name: `Met support ${targetField}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => {
        (draft.controls["access-authorized"][draftField] as Record<string, unknown>)["0"] = draftField === "objectiveEvidenceLocators" ? [] : "";
      },
      issueLabel: new RegExp(`Requirement 01 Objective 1 \\(a\\).*${issueLabel.source}`, "i"),
      targetId: `cmmc-field-access-authorized-${targetField}-0`,
      requirementId: "access-authorized",
    })),
    {
      name: "Not Applicable rationale",
      prepare: (draft) => {
        draft.controls["access-authorized"].objectiveStatuses["0"] = "not_applicable";
        draft.controls["access-authorized"].objectiveRationales["0"] = "";
      },
      issueLabel: /Requirement 01 Objective 1 \(a\).*scope facts/i,
      targetId: "cmmc-field-access-authorized-objectiveRationale-0",
      requirementId: "access-authorized",
    },
    {
      name: "Not Met factual gap",
      prepare: (draft) => {
        const control = draft.controls["access-authorized"];
        control.objectiveStatuses["0"] = "not_met";
        control.objectiveGapStatements["0"] = "";
        control.objectiveCorrectiveActions["0"] = completeCorrectiveAction();
      },
      issueLabel: /Requirement 01 Objective 1 \(a\).*factual gap/i,
      targetId: "cmmc-field-access-authorized-objectiveGapStatement-0",
      requirementId: "access-authorized",
    },
    ...(["action", "owner", "targetDate", "completionEvidenceLocator", "reassessmentDate"] as const).map((field) => ({
      name: `corrective action ${field}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => {
        const control = draft.controls["access-authorized"];
        control.objectiveStatuses["0"] = "not_met";
        control.objectiveGapStatements["0"] = "The quarterly account review was not completed.";
        control.objectiveCorrectiveActions["0"] = { ...completeCorrectiveAction(), [field]: "" };
      },
      issueLabel: /Requirement 01 Objective 1 \(a\).*corrective action/i,
      targetId: `cmmc-field-access-authorized-objectiveCorrectiveAction-${field}-0`,
      requirementId: "access-authorized",
    })),
    ...(["type", "locator", "owner", "reviewFrequency"] as const).map((field) => ({
      name: `existing evidence record ${field}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => {
        draft.controls["access-authorized"].evidenceRecords[0][field] = "CUI content must not be stored";
      },
      issueLabel: /Requirement 01.*prohibited content/i,
      targetId: `cmmc-field-access-authorized-evidenceRecords-0-${field}`,
      requirementId: "access-authorized",
    })),
    {
      name: "shared evidence mapping add",
      prepare: (draft) => {
        const control = draft.controls["access-authorized"];
        control.objectiveEvidenceLocators["1"] = [...control.objectiveEvidenceLocators["0"]];
      },
      issueLabel: /Requirement 01 Objective 1 \(a\).*map the shared evidence/i,
      targetId: "cmmc-field-access-authorized-evidenceRecords",
      requirementId: "access-authorized",
    },
    {
      name: "shared evidence mapping existing row",
      prepare: (draft) => {
        const control = draft.controls["access-authorized"];
        control.objectiveEvidenceLocators["1"] = [...control.objectiveEvidenceLocators["0"]];
        control.evidenceRecords[0].locator = control.objectiveEvidenceLocators["0"][0];
        control.evidenceRecords[0].objectiveIds = ["0"];
      },
      issueLabel: /Requirement 01 Objective 1 \(a\).*map the shared evidence/i,
      targetId: "cmmc-field-access-authorized-evidenceRecords-0-objectiveIds",
      requirementId: "access-authorized",
    },
    ...CMMC_AFFIRMATION_KEYS.map((key) => ({
      name: `affirmation ${key}`,
      prepare: (draft: ReturnType<typeof completeDraft>) => { draft.affirmations[key] = false; },
      issueLabel: /Review and check this required acknowledgment/i,
      targetId: `cmmc-field-affirmations.${key}`,
    })),
  ];

  for (const scenario of cases) {
    await test.step(scenario.name, async () => {
      const draft = completeDraft();
      scenario.prepare(draft);
      await page.unroute(`**/api/public/cmmc/${TOKEN}`).catch(() => {});
      await openQuestionnaire(page, draft, [CMMC_L1_REQUIREMENTS[0]]);
      await fillAffirmingOfficial(page);
      await scenario.prepareAfterOpen?.(page);

      if (scenario.requirementId) {
        const requirementHeading = page.locator(`#cmmc-requirement-${scenario.requirementId} button[aria-expanded]`);
        await requirementHeading.click();
        await expect(requirementHeading).toHaveAttribute("aria-expanded", "false");
      }

      await jumpToIssue(page, scenario.issueLabel, scenario.targetId);

      if (scenario.requirementId) {
        await expect(page.locator(`#cmmc-requirement-${scenario.requirementId} button[aria-expanded]`))
          .toHaveAttribute("aria-expanded", "true");
      }
    });
  }
  expect(unexpectedWrites).toEqual([]);
});

test("each blank or malformed Affirming Official field independently keeps signing disabled", async ({ page }) => {
  await openQuestionnaire(page);
  await expect(submitButton(page)).toBeDisabled();

  await fillAffirmingOfficial(page);
  await expect(submitButton(page)).toBeEnabled();

  await page.getByTestId("input-authorizedOfficialName").fill(" ");
  await expect(submitButton(page)).toBeDisabled();
  await page.getByTestId("input-authorizedOfficialName").fill("Jordan Smith");
  await expect(submitButton(page)).toBeEnabled();

  await page.getByTestId("input-authorizedOfficialTitle").fill(" ");
  await expect(submitButton(page)).toBeDisabled();
  await page.getByTestId("input-authorizedOfficialTitle").fill("President");
  await expect(submitButton(page)).toBeEnabled();

  await page.getByTestId("input-authorizedOfficialEmail").fill(" ");
  await expect(submitButton(page)).toBeDisabled();
  await page.getByTestId("input-authorizedOfficialEmail").fill("not-an-email");
  await expect(submitButton(page)).toBeDisabled();
});

test("Met objective support, material exceptions, future evidence, and duplicate mappings match shared validation", async ({ page }) => {
  const draft = completeDraft();
  const control = draft.controls["access-authorized"];

  await test.step("valid objective support permits signing", async () => {
    await openQuestionnaire(page, draft);
    await fillAffirmingOfficial(page);
    await expect(submitButton(page)).toBeEnabled();
  });

  await test.step("a material exception blocks signing", async () => {
    control.exceptions = "The quarterly access review is overdue.";
    await page.reload();
    await fillAffirmingOfficial(page);
    await expect(submitButton(page)).toBeDisabled();
  });

  await test.step("a future evidence date blocks signing", async () => {
    control.exceptions = "None identified";
    control.objectiveEvidenceDates["0"] = FUTURE_DATE;
    await page.reload();
    await fillAffirmingOfficial(page);
    await expect(submitButton(page)).toBeDisabled();
  });

  await test.step("an unmapped duplicate locator blocks signing", async () => {
    control.objectiveEvidenceDates["0"] = CURRENT_DATE;
    control.objectiveEvidenceLocators["1"] = [...control.objectiveEvidenceLocators["0"]];
    await page.reload();
    await fillAffirmingOfficial(page);
    await expect(submitButton(page)).toBeDisabled();
  });
});

test("complete Not Met and Not Applicable branches permit signing with the correct readiness result", async ({ page }) => {
  const notMetDraft = completeDraft();
  const notMetControl = notMetDraft.controls["access-authorized"];
  notMetControl.objectiveStatuses["0"] = "not_met";
  notMetControl.objectiveGapStatements["0"] = "The quarterly account review was not completed by the required deadline.";
  notMetControl.objectiveCorrectiveActions["0"] = {
    action: "Complete and document the overdue account review.",
    owner: "IT Manager",
    targetDate: "2026-09-20",
    completionEvidenceLocator: "Corrective action register / item 1",
    reassessmentDate: "2026-09-21",
  };
  await openQuestionnaire(page, notMetDraft);
  await expect(page.getByText("Factual gap statement", { exact: true })).toBeVisible();
  await fillAffirmingOfficial(page);
  await expect(submitButton(page)).toBeEnabled();
  await expect(page.getByText("Not ready for Final Level 1 (Self).", { exact: true })).toBeVisible();

  const notApplicableDraft = completeDraft();
  const notApplicableControl = notApplicableDraft.controls["subnetworks"];
  notApplicableControl.objectiveStatuses["0"] = "not_applicable";
  notApplicableControl.objectiveRationales["0"] = "The assessed FCI enclave has no publicly accessible components, and policy prevents those components from entering this boundary.";
  await page.unroute(`**/api/public/cmmc/${TOKEN}`);
  await openQuestionnaire(page, notApplicableDraft);
  await expect(page.getByText("Not applicable rationale", { exact: true })).toBeVisible();
  await fillAffirmingOfficial(page);
  await expect(submitButton(page)).toBeEnabled();
  await expect(page.getByText("Not ready for Final Level 1 (Self).", { exact: true })).toHaveCount(0);
});

test("all six affirmations are required and valid complete data enables signing", async ({ page }) => {
  await openQuestionnaire(page);
  await fillAffirmingOfficial(page);
  await expect(submitButton(page)).toBeEnabled();

  for (const label of AFFIRMATION_LABELS) {
    await page.getByText(label, { exact: true }).click();
    await expect(submitButton(page), `${label} should be required`).toBeDisabled();
    await page.getByText(label, { exact: true }).click();
    await expect(submitButton(page), `${label} should restore eligibility`).toBeEnabled();
  }
});

test("questionnaire controls are discoverable by accessible role and name", async ({ page }) => {
  await openQuestionnaire(page);

  await expect(page.getByRole("textbox", { name: "FCI assessment scope" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assessment-scope type" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Limit information system access.*: Met/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "AC.L1-b.1.i objective 1: Evidence locators", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "AC.L1-b.1.i objective 2: Evidence locators", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "AC.L1-b.1.i evidence record 1: Locator only", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Affirming Official name used as signature" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: AFFIRMATION_LABELS[0] })).toBeVisible();
});
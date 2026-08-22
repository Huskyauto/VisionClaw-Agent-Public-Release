import { test, expect } from "@playwright/test";

const CONCEPT_ID = "compliance-evidence-desk-abc123";
const CONCEPT_TITLE = "Compliance Evidence Desk";

const conceptSummary = {
  id: CONCEPT_ID,
  title: CONCEPT_TITLE,
  targetBuyer: "Small regulated service firms",
  paidOffer: "A fixed-scope evidence-readiness desk.",
  buildDelta: "A scoped evidence register.",
  scores: {
    novelty: 82,
    buyerPain: 78,
    willingnessToPay: 70,
    buildEffort: 40,
    timeToProof: 45,
    evidenceQuality: 55,
    operationalRisk: 35,
  },
  noveltyStatus: "new",
  humanReviewState: "needs_review",
  createdAt: "2026-08-22T12:00:00.000Z",
  sourceRunCount: 1,
};

const conceptDetail = {
  ...conceptSummary,
  candidate: {
    painfulJob: "Prepare recurring evidence without recreating the same documents.",
    proofExperiment: "Offer a paid readiness sprint to five qualified firms.",
    priceCostModel: "$750 setup; under $75 delivery cost.",
    evidencePlan: "Verify renewal deadlines and buyer interviews.",
    operationalRisks: "Customer documents require tenant isolation and human approval.",
    killCriterion: "No paid sprint after five qualified conversations.",
  },
  sourceRunIds: ["frontier-run-1"],
  briefMarkdown: "# Compliance Evidence Desk\n\nHuman decision required.\n",
  urls: {
    concept: `/api/frontier-revenue/discoveries/${CONCEPT_ID}/files/concept`,
    brief: `/api/frontier-revenue/discoveries/${CONCEPT_ID}/files/brief`,
    sourceRun: `/api/frontier-revenue/discoveries/${CONCEPT_ID}/files/source`,
  },
};

test("owner can open an archived frontier concept and each evidence file", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fileHits: string[] = [];

  await context.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const requestPath = requestUrl.pathname;
    if (requestPath === "/api/auth/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "browser-test-owner",
          email: "owner@example.com",
          firstName: "Owner",
          lastName: "Test",
          profileImageUrl: null,
          tenant: {
            id: 1,
            name: "Admin",
            email: "owner@example.com",
            plan: "enterprise",
            trialConversationsUsed: 0,
            trialMaxConversations: 5,
            isAdmin: true,
          },
        }),
      });
      return;
    }
    if (requestPath === "/api/setup/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ needsSetup: false, isFreshDeploy: false }),
      });
      return;
    }
    if (requestPath === "/api/projects") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (requestPath === "/api/frontier-revenue/discoveries") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([conceptSummary]),
      });
      return;
    }
    if (requestPath === `/api/frontier-revenue/discoveries/${CONCEPT_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(conceptDetail),
      });
      return;
    }
    const fileMatch = requestPath.match(new RegExp(`/api/frontier-revenue/discoveries/${CONCEPT_ID}/files/(concept|brief|source)$`));
    if (fileMatch) {
      const kind = fileMatch[1];
      fileHits.push(kind);
      await route.fulfill({
        status: 200,
        contentType: kind === "brief" ? "text/markdown" : "application/json",
        body: kind === "brief"
          ? "# Compliance Evidence Desk\n\nHuman decision required.\n"
          : JSON.stringify({ kind, conceptId: CONCEPT_ID }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("projects-page")).toBeVisible();
    await expect(page.getByTestId("card-frontier-concepts-folder")).toBeVisible();

    await page.getByTestId("card-frontier-concepts-folder").click();
    await expect(page.getByTestId("frontier-concepts-folder-view")).toBeVisible();
    await page.getByTestId(`card-frontier-concept-${CONCEPT_ID}`).click();

    await expect(page.getByTestId("frontier-concept-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: CONCEPT_TITLE })).toBeVisible();
    await expect(page.getByText("Human review required")).toBeVisible();
    await expect(page.getByTestId("button-frontier-brief")).toBeVisible();
    await expect(page.getByTestId("button-frontier-concept-json")).toBeVisible();
    await expect(page.getByTestId("button-frontier-source-run")).toBeVisible();

    for (const [testId, kind] of [
      ["button-frontier-brief", "brief"],
      ["button-frontier-concept-json", "concept"],
      ["button-frontier-source-run", "source"],
    ] as const) {
      const popupPromise = page.waitForEvent("popup");
      await page.getByTestId(testId).click();
      const popup = await popupPromise;
      await expect.poll(() => popup.url(), { timeout: 10_000 }).toMatch(/^blob:/);
      await popup.close();
      await expect.poll(() => fileHits.filter((hit) => hit === kind).length).toBe(1);
    }
  } finally {
    await context.close();
  }
});
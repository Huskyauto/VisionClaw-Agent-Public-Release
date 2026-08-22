import { test, expect } from "@playwright/test";

const RUN_ID = "frontier-income-premium-fallback-2026-08-22T08-00-23-443Z";
const RUN_TITLE = "Frontier revenue jury — Aug 22, 2026";

const runSummary = {
  id: RUN_ID,
  title: RUN_TITLE,
  createdAt: "2026-08-22T08:00:23.443Z",
  status: "complete",
  aggregatorModel: "google/gemini-3.7-flash",
  concordance: 0.73,
  shouldEscalate: false,
  proposerCount: 3,
  successfulProposers: 3,
};

test("owner can find and open a saved frontier jury monetization report", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let sourceFileRequests = 0;

  await context.route("**/api/**", async (route) => {
    const requestPath = new URL(route.request().url()).pathname;
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
    if (requestPath === "/api/projects" || requestPath === "/api/frontier-revenue/discoveries") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (requestPath === "/api/frontier-revenue/runs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([runSummary]) });
      return;
    }
    if (requestPath === `/api/frontier-revenue/runs/${RUN_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...runSummary,
          prompt: "Find practical income opportunities within current VisionClaw capabilities.",
          aggregated: "## Practical Opportunity Comparison\n\nLocal SMB Audit & Website Refresh Package",
          proposers: [
            { modelId: "deepseek/deepseek-v4-pro-0813", providerLane: "openference", provider: "openference", ok: true, error: null },
            { modelId: "z-ai/glm-5.2", providerLane: "profundo", provider: "profundo", ok: true, error: null },
            { modelId: "google/gemini-3.7-flash", providerLane: "google", provider: "google", ok: true, error: null },
          ],
          sourceUrl: `/api/frontier-revenue/runs/${RUN_ID}/file`,
        }),
      });
      return;
    }
    if (requestPath === `/api/frontier-revenue/runs/${RUN_ID}/file`) {
      sourceFileRequests++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runId: RUN_ID, aggregated: "Saved source jury run" }),
      });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("card-frontier-jury-research-folder")).toBeVisible();

    await page.getByTestId("card-frontier-jury-research-folder").click();
    await expect(page.getByTestId("frontier-jury-research-folder-view")).toBeVisible();
    await page.getByTestId(`card-frontier-jury-run-${RUN_ID}`).click();

    await expect(page.getByTestId("frontier-jury-run-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: RUN_TITLE })).toBeVisible();
    await expect(page.getByTestId("text-frontier-jury-report")).toContainText("Local SMB Audit & Website Refresh Package");

    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("button-frontier-jury-source").click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url(), { timeout: 10_000 }).toMatch(/^blob:/);
    await popup.close();
    await expect.poll(() => sourceFileRequests).toBe(1);
  } finally {
    await context.close();
  }
});
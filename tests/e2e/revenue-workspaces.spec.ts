import { test, expect } from "@playwright/test";

// Browser-level regression for the owner-only Revenue Launchpad and Fable 5
// surfaces. API responses are stubbed with an authenticated owner identity so
// this test is deterministic and never creates a real conversation or reads
// customer data. The server-side auth, tenant, lock, and path protections are
// covered by the route/unit suites.

const LAUNCHPAD_ID = 349;
const FABLE_PARENT_ID = 308;
const FABLE_CHILD_IDS = [309, 310, 311, 312, 313];
const CONVERSATION_ID = 901;

const launchpadIdeas = [
  ["ai-visibility-trust-audit", "AI Visibility & Trust Audit"],
  ["hvac-service-growth-pack", "HVAC Service Growth Pack"],
  ["marketing-agency-client-operations-pack", "Marketing Agency Client Operations Pack"],
  ["executive-intelligence-subscription", "Executive Intelligence Subscription"],
  ["marketplace-gigs-tenant-subscriptions", "Marketplace Gigs + Tenant Subscriptions"],
] as const;

const starterPrompt =
  "Help me plan one bounded first-proof test. Keep this evidence-led and manually approved.";

function project(id: number, name: string, tags: string[]) {
  return {
    id,
    name,
    description: `${name} description`,
    status: "active",
    customer_name: null,
    customer_email: null,
    tags,
    primary_conversation_id: null,
    drive_folder_id: null,
    drive_folder_url: null,
    file_count: 0,
    note_count: 0,
    conversation_count: 0,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
  };
}

const projects = [
  project(LAUNCHPAD_ID, "Customer Revenue Launchpad", ["revenue", "launchpad", "owner-only"]),
  project(FABLE_PARENT_ID, "5 Money Making Ideas (Fable 5 Review — 2026-07-23)", ["fable-5", "owner-only"]),
  ...FABLE_CHILD_IDS.map((id, index) =>
    project(id, `Idea ${index + 1}: Fable revenue path ${index + 1}`, ["fable-5-idea", "owner-only"]),
  ),
];

const revenueIdeas = launchpadIdeas.map(([slug, title]) => ({
  slug,
  title,
  summary: `${title} summary`,
  targetBuyer: "A focused small-business buyer",
  validationState: "Planned",
  briefPath: `project-assets/customer-revenue-launchpad/offers/${slug}.md`,
  starterPrompt,
  linkedProjectName: title,
  linkedProjectId: LAUNCHPAD_ID,
  briefUrl: `/api/projects/${LAUNCHPAD_ID}/revenue-ideas/${slug}/brief`,
}));

test("owner can browse both revenue workspaces and start a draft-only idea session", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const originalReplaceState = window.history.replaceState.bind(window.history);
    (window as typeof window & {
      __draftCleanupSnapshots?: Array<{ url: string; composerValue: string | null }>;
    }).__draftCleanupSnapshots = [];
    window.history.replaceState = function (data, title, url) {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-testid="input-message"]');
      (window as typeof window & {
        __draftCleanupSnapshots?: Array<{ url: string; composerValue: string | null }>;
      }).__draftCleanupSnapshots?.push({
        url: typeof url === "string" ? url : url?.toString() || "",
        composerValue: composer?.value ?? null,
      });
      return originalReplaceState(data, title, url);
    };
  });
  const page = await context.newPage();
  const briefRequests: string[] = [];
  const conversationStarts: string[] = [];
  const unexpectedApiRequests: string[] = [];
  let messageRequests = 0;

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (/\/messages$/.test(path) || path === "/api/chat")) {
      messageRequests += 1;
    }
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/user") {
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

    if (path === "/api/setup/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ needsSetup: false, isFreshDeploy: false }),
      });
      return;
    }

    if (path === "/api/projects" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
      return;
    }

    if (path === `/api/projects/${LAUNCHPAD_ID}` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          project: projects[0],
          files: [],
          notes: [],
          conversations: [],
        }),
      });
      return;
    }

    if (path === `/api/projects/${LAUNCHPAD_ID}/revenue-ideas` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspaceKey: "customer-revenue-launchpad",
          projectId: LAUNCHPAD_ID,
          ownerOnly: true,
          ideas: revenueIdeas,
        }),
      });
      return;
    }

    const briefMatch = path.match(new RegExp(`/api/projects/${LAUNCHPAD_ID}/revenue-ideas/([^/]+)/brief$`));
    if (briefMatch && request.method() === "GET") {
      briefRequests.push(path);
      await route.fulfill({
        status: 200,
        contentType: "text/markdown",
        body: `# ${briefMatch[1]}\\n\\nManual validation brief.`,
      });
      return;
    }

    const startMatch = path.match(new RegExp(`/api/projects/${LAUNCHPAD_ID}/revenue-ideas/([^/]+)/conversation$`));
    if (startMatch && request.method() === "POST") {
      conversationStarts.push(startMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: CONVERSATION_ID, projectId: LAUNCHPAD_ID }),
      });
      return;
    }

    if (path === `/api/conversations/${CONVERSATION_ID}` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: CONVERSATION_ID,
          title: "Revenue idea [AI Visibility & Trust Audit]",
          messages: [],
          model: "gpt-5-mini",
          thinkingLevel: "off",
          linkedProject: projects[0],
        }),
      });
      return;
    }

    if (path === "/api/models") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [] }) });
      return;
    }
    if (path === "/api/settings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agentName: "VisionClaw", defaultModel: "gpt-5-mini", thinkingEnabled: false }),
      });
      return;
    }
    if (path === "/api/personas") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path === "/api/voice/wake") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ triggers: [] }) });
      return;
    }
    if (path === "/api/context/summary") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          greeting: "",
          lastConversations: [],
          activePersona: null,
          recentMemories: [],
          todayNotes: null,
        }),
      });
      return;
    }
    if (path.endsWith("/pending-deliveries")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deliveries: [] }) });
      return;
    }
    if (path === "/api/frontier-revenue/discoveries" || path === "/api/frontier-revenue/runs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path === "/api/gdrive/folder") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rootUrl: "" }) });
      return;
    }
    if (path === "/api/settings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agentName: "VisionClaw", defaultModel: "gpt-5-mini", thinkingEnabled: false }),
      });
      return;
    }
    if (path === "/api/notifications/count" || path === "/api/inbox/unread-count") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      return;
    }
    if (path === "/api/conversations") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path === "/api/admin/system-state" || path === "/api/activity/pulse") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (path === "/api/auth/csrf-token") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "browser-test-csrf" }) });
      return;
    }
    if (path === "/api/video-jobs/active") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path === "/api/delegation-events/stream" || path === `/api/conversations/${CONVERSATION_ID}/sync`) {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }

    unexpectedApiRequests.push(`${request.method()} ${path}`);
    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unexpected browser API request: ${request.method()} ${path}` }),
    });
  });

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("projects-page")).toBeVisible();

    await expect(page.getByTestId("card-fable-5-folder")).toBeVisible();
    await page.getByTestId("card-fable-5-folder").click();
    await expect(page.getByTestId("fable-5-folder-view")).toBeVisible();
    for (const id of [FABLE_PARENT_ID, ...FABLE_CHILD_IDS]) {
      await expect(page.getByTestId(`card-project-${id}`)).toBeVisible();
    }
    await page.getByTestId("button-close-fable-5-folder").click();

    await page.getByTestId(`card-project-${LAUNCHPAD_ID}`).click();
    await expect(page.getByTestId(`card-revenue-ideas-customer-revenue-launchpad`)).toBeVisible();
    const ideaCards = page.locator('[data-testid^="card-revenue-idea-"]');
    await expect(ideaCards).toHaveCount(5);

    const firstIdea = launchpadIdeas[0][0];
    const briefPopup = page.waitForEvent("popup");
    await page.getByTestId(`button-open-revenue-brief-${firstIdea}`).click();
    const popup = await briefPopup;
    await expect.poll(() => popup.url()).toMatch(/^blob:/);
    await popup.close();
    expect(briefRequests).toEqual([
      `/api/projects/${LAUNCHPAD_ID}/revenue-ideas/${firstIdea}/brief`,
    ]);

    const startButton = page.getByTestId(`button-start-revenue-idea-${firstIdea}`);
    const box = await startButton.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await startButton.click();

    await expect.poll(() => conversationStarts).toEqual([firstIdea]);
    await expect(page.getByTestId("input-message")).toHaveValue(starterPrompt);
    await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}$`));
    const cleanupSnapshots = await page.evaluate(() => (
      (window as typeof window & {
        __draftCleanupSnapshots?: Array<{ url: string; composerValue: string | null }>;
      }).__draftCleanupSnapshots || []
    ));
    expect(cleanupSnapshots).toContainEqual({
      url: `/chat/${CONVERSATION_ID}`,
      composerValue: starterPrompt,
    });
    await page.waitForTimeout(500);
    expect(messageRequests, "Start working must not send an automatic message").toBe(0);
    expect(unexpectedApiRequests, "Every browser API request must be explicitly contract-mocked").toEqual([]);
  } finally {
    await context.close();
  }
});

test("non-owner cannot see Fable 5 or Launchpad workstream controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const unexpectedApiRequests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "browser-test-non-owner",
          email: "member@example.com",
          firstName: "Member",
          lastName: "Test",
          profileImageUrl: null,
          tenant: {
            id: 2,
            name: "Member tenant",
            email: "member@example.com",
            plan: "starter",
            trialConversationsUsed: 0,
            trialMaxConversations: 5,
            isAdmin: false,
          },
        }),
      });
      return;
    }
    if (path === "/api/setup/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ needsSetup: false }) });
      return;
    }
    if (path === "/api/projects") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
      return;
    }
    if (path === `/api/projects/${LAUNCHPAD_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ project: projects[0], files: [], notes: [], conversations: [] }),
      });
      return;
    }
    if (path === "/api/gdrive/folder") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rootUrl: "" }) });
      return;
    }
    if (path === "/api/settings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agentName: "VisionClaw", defaultModel: "gpt-5-mini", thinkingEnabled: false }),
      });
      return;
    }
    if (path === "/api/notifications/count" || path === "/api/inbox/unread-count") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
      return;
    }
    if (path === "/api/conversations" || path === "/api/video-jobs/active") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (path === "/api/admin/system-state" || path === "/api/activity/pulse") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (path === "/api/auth/csrf-token") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "browser-test-csrf" }) });
      return;
    }
    if (path === "/api/delegation-events/stream") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }

    unexpectedApiRequests.push(`${request.method()} ${path}`);
    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unexpected browser API request: ${request.method()} ${path}` }),
    });
  });

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("projects-page")).toBeVisible();
    await expect(page.getByTestId("card-fable-5-folder")).toHaveCount(0);

    await page.getByTestId(`card-project-${LAUNCHPAD_ID}`).click();
    await expect(page.getByTestId(`card-revenue-ideas-customer-revenue-launchpad`)).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(unexpectedApiRequests, "Non-owner view must not request owner-only revenue ideas").toEqual([]);
  } finally {
    await context.close();
  }
});
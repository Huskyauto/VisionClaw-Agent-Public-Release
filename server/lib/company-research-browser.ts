import puppeteer from "puppeteer-core";
import { loadBrowserConfig } from "../browser-config";
import { packagePageUrl } from "./company-report-research";
import type { ResearchBrowserLane } from "./company-report-research-batch";

/** Separate stateless remote Chromium lane. Never reuses owner tabs/cookies,
 * takes screenshots, narrates, clicks, submits forms or calls a model. */
export async function renderCompanyResearchPage(url: string, dependencies?: {
  loadConfig: typeof loadBrowserConfig;
  connect: typeof puppeteer.connect;
  fetch: typeof import("../audit-engine").safeFetchText;
}): Promise<any> {
  const config = (dependencies?.loadConfig ?? loadBrowserConfig)(), profile = config.profiles[config.defaultProfile];
  if (!config.enabled || !profile?.cdpUrl) return { ok: false };
  // The app's established fetcher revalidates and PINs every redirect's socket.
  // Chromium never fetches website URLs: it renders only that verified HTML,
  // with JavaScript disabled and every network request aborted. URL validation
  // followed by ordinary Chromium navigation would permit DNS rebinding.
  const fetch = dependencies?.fetch ?? (await import("../audit-engine")).safeFetchText;
  const fetched = await fetch(url, { timeoutMs: 6000, maxBytes: 300_000, maxRedirects: 2 });
  if (!fetched.ok || !fetched.finalUrl || !packagePageUrl(fetched.finalUrl, url) || !fetched.text)
    return { ok: false };
  const browser = await (dependencies?.connect ?? puppeteer.connect)({
    ...(profile.cdpUrl.startsWith("ws") ? { browserWSEndpoint: profile.cdpUrl } : { browserURL: profile.cdpUrl }),
    protocolTimeout: 20_000,
  });
  let context: Awaited<ReturnType<typeof browser.createBrowserContext>> | undefined;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", request => {
      void request.abort("blockedbyclient").catch(() => {
        console.warn("[company-package] closed blocked browser resource");
      });
    });
    await page.setContent(fetched.text, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const result = await page.evaluate(() => ({
      snapshot: (document.body?.innerText || "").slice(0, 48_000),
      html: (document.documentElement?.outerHTML || "").slice(0, 300_000),
    }));
    return { ok: result.snapshot.length >= 100, tabId: "isolated-remote", url: fetched.finalUrl, ...result };
  } finally {
    try { await context?.close(); } finally { await browser.disconnect(); }
  }
}

export function companyResearchBrowserLanes(camofox: ResearchBrowserLane["browse"], dependencies?: {
  config: ReturnType<typeof loadBrowserConfig>;
  render: typeof renderCompanyResearchPage;
  workspace: Pick<import("./browser-workspace").WorkspaceCoordinator, "agent">;
}): ResearchBrowserLane[] {
  const config = dependencies?.config ?? loadBrowserConfig();
  const remoteConfigured = config.enabled && !!config.profiles[config.defaultProfile]?.cdpUrl;
  const lanes: ResearchBrowserLane[] = [
    // The workspace coordinator holds a tenant-wide exclusive browser lock.
    // Two Camofox lanes race that lock and count "busy" as website failures.
    { engine: "camofox", exclusiveGroup: "tenant-browser", browse: camofox },
  ];
  if (remoteConfigured) lanes.push({ engine: "remote-chromium-networkless", exclusiveGroup: "tenant-browser",
    browse: async params => {
      if (params.action === "close_session") return { ok: true };
      const workspace = dependencies?.workspace ?? (await import("./browser-workspace-store")).browserWorkspace;
      // Human control applies to EVERY browser engine, including networkless
      // rendering. Group scheduling above avoids racing this tenant-wide lock.
      return workspace.agent(params._tenantId, params,
        () => (dependencies?.render ?? renderCompanyResearchPage)(params.url));
    } });
  return lanes;
}

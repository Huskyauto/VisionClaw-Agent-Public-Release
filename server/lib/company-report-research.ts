import { load } from "cheerio";
import { logSilentCatch } from "./silent-catch";
import { hashReportBytes, minimizeReportText, type ReportEvidence } from "./business-report-evidence";
import type { PackageIntake } from "./company-report-package-core";
import { isReviewBearingPublicText } from "./report-customer-feedback";

const MAX_URLS = 500, MAX_PAGES = 30, MAX_MS = 8 * 60_000;
/** Public GET targets only. Never traverse account, action, query or off-site URLs. */
export function packagePageUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base), root = new URL(base);
    if (!["http:", "https:"].includes(u.protocol) || u.origin !== root.origin ||
        u.username || u.password || u.search ||
        /(?:^|\/)(?:logout|login|signout|signin|admin|account|delete|remove|unsubscribe|checkout|cart)(?:\/|$)/i.test(u.pathname) ||
        /\.(?:pdf|jpe?g|png|gif|svg|mp4|zip|css|js|xml|ico|woff2?)$/i.test(u.pathname)) return null;
    u.hash = ""; return u.href;
  } catch { return null; }
}
export function pagePriority(url: string) {
  return /product|service|solution|book|contact|quote|price|pricing|part|support|resource|document|about/i.test(url) ? 0 : 1;
}
/** Camofox snapshots expose rendered link targets as /url:, href or Markdown.
 * This covers JS-created navigation that is absent from fetched HTML. */
export function packageSnapshotLinks(snapshot: string, base: string): string[] {
  const found = new Set<string>();
  for (const expression of [
    /\/url:\s*["']?([^\s"'<>]+)/g,
    /href=["']([^"']+)["']/g,
    /\]\(([^)\s]+)\)/g,
    /https?:\/\/[^\s"'<>)[\]]+/g,
  ]) {
    for (const match of snapshot.matchAll(expression)) {
      const url = packagePageUrl(match[1] || match[0], base);
      if (url) found.add(url);
    }
  }
  return [...found];
}
type Dependencies = {
  collect(intake: Record<string, unknown>, opts: { allowPaidExtraction: boolean; retainMeasuredScore: boolean }): Promise<ReportEvidence>;
  fetch(url: string): Promise<{ ok: true; text: string; finalUrl?: string } | { ok: false; text?: string; finalUrl?: string }>;
  browse(params: any): Promise<any>;
  live(): Promise<void>;
};
export async function researchCompanyPackage(intake: PackageIntake, tenantId: number, runId: number, deps?: Dependencies) {
  const production: Dependencies = deps ?? {
    collect: (await import("./business-report-evidence")).collectBusinessReportEvidence,
    fetch: url => import("../audit-engine").then(m => m.safeFetchText(url, { timeoutMs: 6000, maxBytes: 300_000, maxRedirects: 2 })),
    browse: (await import("../camofox-tool")).executeCamofoxAction,
    live: async () => {
      if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") throw new Error("Report research stopped");
    },
  };
  await production.live();
  const started = Date.now();
  // No browser/LLM extraction fallback is allowed to turn missing rendering into success.
  const evidence = await production.collect(intake, { allowPaidExtraction: false, retainMeasuredScore: true });
  const root = new URL(intake.website);
  if (!["https:", "http:"].includes(root.protocol) || root.username || root.password) throw new Error("Public website required");
  root.hash = ""; root.search = "";
  const urls = new Set<string>([root.href]), rendered = new Set<string>();
  const pages: Array<{ url: string; finalUrl?: string; status: string; text?: string; sha256?: string; truncated?: boolean }> = [];
  let capped = false;
  const add = (raw: string, base = root.href) => {
    const url = packagePageUrl(raw, base);
    if (url && urls.size < MAX_URLS) urls.add(url);
    else if (url && !urls.has(url)) capped = true;
  };
  const links = (html: string, base: string) => {
    const $ = load(html);
    $("a[href]").each((_, node) => { add($(node).attr("href")!, base); });
  };
  const home = await production.fetch(root.href);
  if (home.ok) {
    if (home.finalUrl) {
      const final = new URL(home.finalUrl);
      if (final.origin !== root.origin) {
        // Canonical redirect (e.g. www) becomes the only inventory origin.
        root.href = final.href; root.search = ""; root.hash = "";
        urls.clear(); urls.add(root.href);
      }
    }
    links(home.text, root.href);
  }
  const sitemapQueue = [new URL("/sitemap.xml", root).href];
  const robots = await production.fetch(new URL("/robots.txt", root).href);
  if (robots.ok) for (const match of robots.text.matchAll(/^sitemap:\s*(\S+)/gim)) {
    try { const u = new URL(match[1]); if (u.origin === root.origin && sitemapQueue.length < 4) sitemapQueue.push(u.href); } catch (error) { logSilentCatch("company-report-research:robots-url", error, "expected"); }
  }
  const seenMaps = new Set<string>();
  while (sitemapQueue.length && seenMaps.size < 6 && Date.now() - started < MAX_MS) {
    await production.live();
    const url = sitemapQueue.shift()!;
    if (seenMaps.has(url)) continue;
    seenMaps.add(url);
    const fetched = await production.fetch(url);
    if (!fetched.ok) continue;
    const xml = load(fetched.text, { xmlMode: true });
    xml("loc").each((_, node) => {
      const loc = xml(node).text().trim();
      try {
        const u = new URL(loc);
        if (u.origin !== root.origin || u.username || u.password || u.search) return;
        if (/\.xml$/i.test(u.pathname) && sitemapQueue.length < 6) sitemapQueue.push(u.href);
        else add(u.href);
      } catch (error) { logSilentCatch("company-report-research:sitemap-url", error, "expected"); }
    });
  }
  const sessionKey = `report-package-${runId}`, suffix = `pkg-${runId}`;
  let tabId: string | undefined;
  try {
    while (rendered.size < MAX_PAGES && Date.now() - started < MAX_MS) {
      await production.live();
      const next = [...urls].filter(url => !rendered.has(url))
        .sort((a, b) => (a === root.href ? -1 : b === root.href ? 1 : pagePriority(a) - pagePriority(b)))[0];
      if (!next) break;
      rendered.add(next);
      const result = await production.browse({
        action: tabId ? "navigate" : "open", url: next, tabId, sessionKey,
        userIdSuffix: suffix, _tenantId: tenantId,
      });
      if (result.tabId) tabId = result.tabId;
      let snapshot = result;
      if (result.ok && (!result.snapshot || result.snapshot.length < 100)) snapshot = await production.browse({
        action: "snapshot", tabId, sessionKey, userIdSuffix: suffix, _tenantId: tenantId,
      });
      const finalUrl = result.url || snapshot.url || next;
      const sameOrigin = packagePageUrl(finalUrl, root.href);
      const text = typeof snapshot.snapshot === "string" ? minimizeReportText(snapshot.snapshot).trim() : "";
      if (!result.ok || !snapshot.ok || !sameOrigin || text.length < 100) {
        pages.push({ url: next, status: "browser_failed_or_out_of_scope" });
        if (!tabId) throw new Error("Rendered browser research is unavailable; package not generated from a homepage-only substitute.");
        continue;
      }
      const retained = text.slice(0, 6500);
      for (const link of packageSnapshotLinks(snapshot.snapshot, sameOrigin)) add(link, sameOrigin);
      const browserLinks = result.data?.links ?? snapshot.data?.links;
      if (Array.isArray(browserLinks)) for (const link of browserLinks.slice(0, MAX_URLS)) {
        const target = typeof link === "string" ? link : link?.href ?? link?.url;
        if (typeof target === "string") add(target, sameOrigin);
      }
      pages.push({ url: next, finalUrl: sameOrigin, status: "rendered", text: retained,
        sha256: hashReportBytes(retained), truncated: text.length > retained.length || !!snapshot.snapshotTruncated });
      const excerpt = retained.slice(0, 1800);
      if (!isReviewBearingPublicText(retained)) {
        evidence.sources.push({ id: `S${evidence.sources.length + 1}`, title: `Rendered browser review: ${String(result.title || next).slice(0, 150)}`,
          url: sameOrigin, kind: "public", text: excerpt, sha256: hashReportBytes(excerpt), retrievedAt: new Date().toISOString() });
      } else evidence.limitations.push(`Review-bearing browser prose excluded from company evidence: ${sameOrigin}. Only the separately bound customer-feedback evidence may support reputation claims.`);
      // Link discovery is static; the evidence above is actual browser rendering.
      const html = await production.fetch(next);
      if (html.ok && (!html.finalUrl || packagePageUrl(html.finalUrl, root.href))) links(html.text, next);
    }
  } finally {
    if (tabId) await production.browse({ action: "close_session", sessionKey, userIdSuffix: suffix, _tenantId: tenantId })
      .catch(() => console.warn("[company-package] isolated browser cleanup failed"));
  }
  const reviewed = pages.filter(p => p.status === "rendered").length;
  if (!reviewed) throw new Error("No rendered pages verified; package research blocked.");
  const failed = pages.length - reviewed;
  capped ||= urls.size > rendered.size || sitemapQueue.length > 0;
  // Keep original captures privately, but bound the *shared* compiler evidence
  // before drafting so the existing 180k handoff ceiling remains enforceable.
  const originalSources = evidence.sources;
  const totalChars = originalSources.reduce((sum, source) => sum + source.text.length, 0);
  if (totalChars > 65_000) {
    const ratio = 65_000 / totalChars;
    evidence.sources = originalSources.map(source => {
      const text = source.text.slice(0, Math.floor(source.text.length * ratio));
      return { ...source, text, sha256: hashReportBytes(text) };
    });
    evidence.limitations.push("Shared report evidence excerpts were proportionally bounded to 65,000 characters before drafting. Original captures remain in the private research record. Omitted text was not passed to report compilation.");
  }
  const map = { capturedAt: new Date().toISOString(), urls: [...urls], pages, sitemapFiles: [...seenMaps],
    ...(evidence.sources !== originalSources ? { originalSources } : {}) };
  const coverage = { discovered: urls.size, reviewed, failed, capped };
  const statement = `Website coverage: ${urls.size} discovered public URLs; ${reviewed} rendered browser pages; ${failed} browser failures; ${capped ? "partial, bounded coverage" : "all discovered in-scope URLs reviewed"}. Inventory is not proof of undiscovered-page completeness. No forms were submitted, purchases made, private systems entered or device-specific end-to-end tests performed. Browser source excerpts are capped at 1,800 characters; longer retained captures are in the private research map.`;
  evidence.limitations.push(statement);
  if (intake.intakeText?.trim()) {
    const text = minimizeReportText(intake.intakeText).slice(0, 9000);
    evidence.sources.push({ id: `S${evidence.sources.length + 1}`, title: "Prospect intake profile (supplied, not independently verified)", kind: "customer",
      text, sha256: hashReportBytes(text), retrievedAt: new Date().toISOString() });
    if (intake.intakeText.length > 9000) evidence.limitations.push("Supplied prospect intake excerpt limited to 9,000 characters; original input retained privately.");
  }
  return { evidence, coverage, map };
}

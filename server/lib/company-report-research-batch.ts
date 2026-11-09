import { load } from "cheerio";
import { randomUUID } from "node:crypto";
import { hashReportBytes, minimizeReportText, type ReportEvidence } from "./business-report-evidence";
import { packagePageUrl, packageSnapshotLinks, pagePriority } from "./company-report-research";
import { renderedCompanyFacts } from "./company-report-page-facts";
import type { PackageIntake } from "./company-report-package-core";
import { companyResearchDeadline } from "./company-research-deadline";

type Page = { url: string; finalUrl?: string; status: string; attempts?: number; text?: string; sha256?: string;
  factsVersion?: 1; factText?: string; engine?: string };
export type ResearchBrowserLane = { engine: string; exclusiveGroup?: string; browse(params: any): Promise<any> };
export type ResearchBatch = {
  complete: boolean; evidence: ReportEvidence;
  coverage: { discovered: number; reviewed: number; failed: number; pending: number; capped: boolean;
    evidencePages: number; factsPending: number };
  map: { resumeVersion: 1; root: string; urls: string[]; pages: Page[];
    sitemapFiles: string[]; sitemapQueue: string[]; discoveryComplete: boolean;
    overflow?: boolean; failedSitemaps?: string[]; sitemapAttempts?: Record<string, number>;
    originalSources?: ReportEvidence["sources"]; nextSourceNumber?: number; capturedAt: string };
};
export type BatchPorts = {
  collect(intake: Record<string, unknown>, opts: { allowPaidExtraction: boolean; retainMeasuredScore: boolean }): Promise<ReportEvidence>;
  fetch(url: string): Promise<{ ok: boolean; text?: string; finalUrl?: string }>;
  browse(params: any): Promise<any>;
  live(): Promise<void>;
  checkpoint?(value: ResearchBatch): Promise<void>;
  prior?: any;
  backfillOnly?: boolean;
  browserLanes?: ResearchBrowserLane[];
};
const MAX_URLS = 5000, MAX_MAPS = 500;

/** One bounded batch; every successful page is committed before the next request.
 * Pending URLs survive worker restarts. Rendering failure never becomes evidence. */
export async function researchCompanyPackageBatch(
  intake: PackageIntake, tenantId: number, runId: number, ports: BatchPorts,
): Promise<ResearchBatch> {
  const clock = companyResearchDeadline();
  const original = ports;
  const groups = new Map<string, Promise<unknown>>();
  const boundedBrowse = (browse: ResearchBrowserLane["browse"], group?: string) => (params: any) =>
    clock.read(params.action === "close_session" ? "browser cleanup" : "page rendering",
      params.action === "close_session" ? 10_000 : 75_000, assertCurrent => {
        const invoke = () => {
          // Cleanup has its own deadline too: never dispatch an expired
          // queued delete after a timed-out browser operation finally settles.
          assertCurrent();
          return browse(params);
        };
        if (!group) return invoke();
        const task = (groups.get(group) ?? Promise.resolve()).then(invoke);
        groups.set(group, task.then(() => undefined, () => undefined));
        return task;
      }, params.action === "close_session");
  ports = { ...original,
    collect: (value, options) => clock.read("initial evidence collection", 180_000, () => original.collect(value, options)),
    fetch: url => clock.read("public page retrieval", 25_000, () => original.fetch(url)),
    browse: boundedBrowse(original.browse),
    browserLanes: original.browserLanes?.map(lane => ({ ...lane, browse: boundedBrowse(lane.browse, lane.exclusiveGroup) })),
  };
  await ports.live();
  const prior = ports.prior;
  if (ports.backfillOnly && !prior?.evidence) throw new Error("Saved research required for factual refresh");
  const root = new URL(prior?.map?.root || intake.website);
  if (!["https:", "http:"].includes(root.protocol) || root.username || root.password) throw new Error("Public website required");
  root.hash = ""; root.search = "";
  const evidence: ReportEvidence = structuredClone(prior?.evidence ??
    await ports.collect(intake, { allowPaidExtraction: false, retainMeasuredScore: true }));
  if (prior?.map?.originalSources) evidence.sources = structuredClone(prior.map.originalSources);
  let nextSourceNumber = Math.max(prior?.map?.nextSourceNumber || 1,
    1 + Math.max(0, ...evidence.sources.map(s => Number(/^S(\d+)$/.exec(s.id)?.[1]) || 0)));
  const urls = new Set<string>((prior?.map?.urls || [root.href]).filter((url: string) => packagePageUrl(url, root.href)));
  const pages: Page[] = structuredClone((prior?.map?.pages || []).filter((page: Page) => urls.has(page.url)));
  const seenMaps = new Set<string>(prior?.map?.sitemapFiles || []);
  const sitemapQueue: string[] = prior?.map?.resumeVersion === 1
    ? [...prior.map.sitemapQueue] : [new URL("/sitemap.xml", root).href];
  let discoveryComplete = prior?.map?.resumeVersion === 1 && prior.map.discoveryComplete;
  if (ports.backfillOnly && (!discoveryComplete || sitemapQueue.length ||
      [...urls].some(url => !pages.some(page => page.url === url &&
        (page.status === "rendered" || (page.attempts ?? 1) >= 2)))))
    throw new Error("Factual refresh requires completed discovery and no pending browser pages");
  let limited = prior?.map?.overflow === true;
  const failedSitemaps = new Set<string>(prior?.map?.failedSitemaps || []);
  const sitemapAttempts: Record<string, number> = { ...(prior?.map?.sitemapAttempts || {}) };
  const add = (raw: string, base = root.href) => {
    const url = packagePageUrl(raw, base);
    if (!url || urls.has(url)) return;
    if (urls.size >= MAX_URLS) { limited = true; return; }
    urls.add(url);
  };
  const addLinks = (html: string, base: string) => {
    const $ = load(html);
    $("a[href]").each((_, node) => { add($(node).attr("href")!, base); });
  };
  const state = (): ResearchBatch => {
    const reviewed = pages.filter(p => p.status === "rendered").length;
    const failed = pages.filter(p => p.status !== "rendered" && (p.attempts ?? 1) >= 2).length;
    const pending = urls.size - reviewed - failed;
    const factsPending = pages.filter(p => p.status === "rendered" && p.factsVersion !== 1).length;
    const evidencePages = pages.filter(p => p.status === "rendered" && !!p.factText).length;
    return { complete: !!discoveryComplete && pending === 0 && factsPending === 0 && !limited, evidence,
      coverage: { discovered: urls.size, reviewed, failed, pending, evidencePages, factsPending,
        capped: !discoveryComplete || pending > 0 || failed > 0 || limited || failedSitemaps.size > 0 },
      map: { resumeVersion: 1, root: root.href, urls: [...urls], pages, sitemapFiles: [...seenMaps],
        sitemapQueue: [...sitemapQueue], discoveryComplete: !!discoveryComplete, capturedAt: evidence.capturedAt,
        overflow: limited, failedSitemaps: [...failedSitemaps], sitemapAttempts, nextSourceNumber } };
  };
  let writes = Promise.resolve();
  const checkpoint = () => {
    writes = writes.then(async () => { await ports.live(); await ports.checkpoint?.(state()); });
    return writes;
  };
  const nextSourceId = () => `S${nextSourceNumber++}`;
  const retainFacts = (page: Page, snapshot: string, html: string, requireMain = false) => {
    const text = renderedCompanyFacts(snapshot, html, requireMain);
    page.factsVersion = 1; page.factText = text;
    const title = `Rendered browser page: ${page.url}`;
    const previous = evidence.sources.find(s => s.title === title && s.url === page.url);
    // Refresh is a new projection, not an append beside stale browser prose.
    // Retain IDs for replacements; removed sources leave intentional gaps.
    evidence.sources = evidence.sources.filter(s => !(s.title === title && s.url === page.url));
    if (text) {
      const excerpt = text.slice(0, 1800);
      evidence.sources.push({ id: previous?.id || nextSourceId(), title, kind: "public",
        url: page.url, text: excerpt, sha256: hashReportBytes(excerpt), retrievedAt: new Date().toISOString() });
      evidence.limitations = evidence.limitations.filter(s => s !== `Review-bearing prose excluded from company facts: ${page.url}`);
    }
    if (!text) {
      const note = `No safely separated browser-confirmed company content: ${page.url}`;
      if (!evidence.limitations.includes(note)) evidence.limitations.push(note);
    }
  };
  if (!prior) {
    const home = await ports.fetch(root.href);
    if (home.ok) {
      if (home.finalUrl) {
        const canonical = new URL(home.finalUrl);
        if (!["http:", "https:"].includes(canonical.protocol) || canonical.username || canonical.password)
          throw new Error("Unsafe canonical website");
        root.href = canonical.href; root.hash = ""; root.search = "";
        urls.clear(); urls.add(root.href);
        sitemapQueue.splice(0, sitemapQueue.length, new URL("/sitemap.xml", root).href);
      }
      addLinks(home.text || "", root.href);
    }
    const robots = await ports.fetch(new URL("/robots.txt", root).href);
    if (robots.ok) for (const match of (robots.text || "").matchAll(/^sitemap:\s*(\S+)/gim)) {
      try {
        const u = new URL(match[1]);
        if (u.origin === root.origin && !u.username && !u.password && !u.search && !sitemapQueue.includes(u.href))
          sitemapQueue.push(u.href);
      } catch { continue; /* Malformed public metadata is not a crawl target. */ }
    }
    await checkpoint();
  }
  const started = Date.now();
  // Upgrade retained captures without revisiting them in the browser. Old
  // captures are truncated, so require an independently bounded main region.
  for (const page of pages.filter(p => p.status === "rendered" && p.factsVersion !== 1).slice(0, 10)) {
    await ports.live();
    const html = await ports.fetch(page.finalUrl || page.url);
    retainFacts(page, page.text || "", html.ok && (!html.finalUrl || packagePageUrl(html.finalUrl, root.href)) ? html.text || "" : "", true);
    await checkpoint();
  }
  for (let count = 0; !ports.backfillOnly && sitemapQueue.length && count < 10 && Date.now() - started < 180_000; count++) {
    await ports.live();
    const url = sitemapQueue.shift()!;
    if (seenMaps.has(url)) continue;
    if (seenMaps.size >= MAX_MAPS) {
      limited = true; await checkpoint();
      throw new Error("Website exceeds the 500-sitemap safety limit; research remains incomplete");
    }
    const fetched = await ports.fetch(url);
    sitemapAttempts[url] = (sitemapAttempts[url] || 0) + 1;
    if (fetched.ok || sitemapAttempts[url] >= 2) seenMaps.add(url);
    if (fetched.ok) {
      const xml = load(fetched.text || "", { xmlMode: true });
      xml("loc").each((_, node) => {
        try {
          const u = new URL(xml(node).text().trim());
          if (u.origin !== root.origin || u.username || u.password || u.search) return;
          if (/\.xml$/i.test(u.pathname)) {
            if (!seenMaps.has(u.href) && !sitemapQueue.includes(u.href)) sitemapQueue.push(u.href);
          } else add(u.href);
        } catch { return; /* Invalid sitemap entries cannot expand scope. */ }
      });
    } else {
      if (sitemapAttempts[url] < 2) sitemapQueue.push(url);
      else {
        failedSitemaps.add(url);
        if (!evidence.limitations.includes(`Sitemap unavailable after two attempts: ${url}`))
          evidence.limitations.push(`Sitemap unavailable after two attempts: ${url}`);
      }
    }
    await checkpoint();
  }
  discoveryComplete = sitemapQueue.length === 0;
  const attempted = new Set<string>();
  const lanes = (ports.browserLanes?.length ? ports.browserLanes :
    [{ engine: "camofox", browse: ports.browse }]).slice(0, 3);
  // Remote cancellation is not guaranteed. Never let a late action/cleanup
  // target a session that a later durable batch has started using.
  const batchSession = randomUUID().slice(0, 8);
  const workers = lanes.map(async (lane, index) => {
    const sessionKey = `report-package-${runId}-${batchSession}-w${index}`, suffix = `pkg-${runId}-${batchSession}-w${index}`;
    let tabId: string | undefined;
    try {
    while (!ports.backfillOnly && attempted.size < 10 && Date.now() - started < 180_000) {
      clock.assertOpen();
      const next = [...urls].filter(url => {
        const p = pages.find(p => p.url === url);
        if (lane.engine.startsWith("remote-chromium") && p?.engine?.startsWith("remote-chromium") &&
            p.status !== "rendered") return false; // Retry dynamic-only pages in Camofox, not static rendering again.
        return !attempted.has(url) && (!p || p.status !== "rendered" && (p.attempts ?? 1) < 2);
      }).sort((a, b) => a === root.href ? -1 : b === root.href ? 1 : pagePriority(a) - pagePriority(b))[0];
      if (!next) break;
      // Claim synchronously before any await: one shared URL inventory.
      attempted.add(next); await ports.live();
      const previous = pages.findIndex(p => p.url === next);
      const page: Page = { url: next, status: "browser_failed", engine: lane.engine,
        attempts: previous < 0 ? 1 : (pages[previous].attempts ?? 1) + 1 };
      let result: any;
      try {
        result = await lane.browse({ action: tabId ? "navigate" : "open", url: next, tabId,
          sessionKey, userIdSuffix: suffix, _tenantId: tenantId });
        if (result.tabId) tabId = result.tabId;
        let snapshot = result;
        if (result.ok && (!result.snapshot || result.snapshot.length < 100))
          snapshot = await lane.browse({ action: "snapshot", tabId, sessionKey, userIdSuffix: suffix, _tenantId: tenantId });
        const finalUrl = result.url || snapshot.url || next;
        const text = typeof snapshot.snapshot === "string" ? minimizeReportText(snapshot.snapshot).trim() : "";
        if (result.ok && snapshot.ok && packagePageUrl(finalUrl, root.href) && text.length >= 100) {
          Object.assign(page, { status: "rendered", finalUrl, text: text.slice(0, 12000), sha256: hashReportBytes(text.slice(0, 12000)) });
          for (const link of packageSnapshotLinks(snapshot.snapshot, next)) add(link);
          const html = typeof result.html === "string" ? { ok: true, text: result.html, finalUrl } : await ports.fetch(next);
          retainFacts(page, text, html.ok && (!html.finalUrl || packagePageUrl(html.finalUrl, root.href)) ? html.text || "" : "");
          if (html.ok && (!html.finalUrl || packagePageUrl(html.finalUrl, root.href))) addLinks(html.text || "", next);
        }
      } catch (error) {
        if ((error as any)?.code === "COMPANY_RESEARCH_TIMEOUT") throw error;
        console.warn(`[company-package] browser page failed; run=${runId}; attempt=${page.attempts}`);
      }
      if (previous < 0) pages.push(page); else pages[previous] = page;
      await checkpoint();
    }
  } finally {
    if (tabId) await lane.browse({ action: "close_session", sessionKey, userIdSuffix: suffix, _tenantId: tenantId })
      .catch(error => {
        if ((error as any)?.code === "COMPANY_RESEARCH_TIMEOUT") throw error;
        console.warn("[company-package] isolated browser cleanup failed");
      });
  }
  });
  // Drain all workers before returning/throwing, so successful siblings persist.
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find(result => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  if (limited) throw new Error("Website exceeds the 5,000-page safety limit; research remains incomplete");
  const output = state();
  if (output.complete) {
    if (!output.coverage.reviewed) throw new Error("No rendered pages verified; package research blocked");
    if (!output.coverage.evidencePages) throw new Error("No safely separated rendered company facts; saved research needs attention before paid drafting");
    const originalSources = structuredClone(evidence.sources);
    const total = originalSources.reduce((sum, s) => sum + s.text.length, 0);
    if (total > 65_000) {
      evidence.sources = originalSources.map(s => {
        const text = s.text.slice(0, Math.floor(s.text.length * 65_000 / total));
        return { ...s, text, sha256: hashReportBytes(text) };
      });
      output.map.originalSources = originalSources;
      evidence.limitations.push("Compiler source excerpts bounded to 65,000 characters; longer captures retained in private research. Full captures are not all passed to the compiler.");
    }
    if (intake.intakeText?.trim()) {
      const text = minimizeReportText(intake.intakeText).slice(0, 9000);
      evidence.sources.push({ id: nextSourceId(), title: "Supplied prospect intake (unverified)",
        kind: "customer", text, sha256: hashReportBytes(text), retrievedAt: new Date().toISOString() });
    }
    evidence.limitations.push(`Website research: ${urls.size} discovered URLs; ${output.coverage.reviewed} reviewed; ${output.coverage.failed} unresolved failures. Discovery cannot prove absence of unlinked/private pages. No forms submitted or purchases made.`);
  }
  await ports.live(); await ports.checkpoint?.(output);
  return output;
}

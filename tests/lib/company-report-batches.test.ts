import test from "node:test";
import assert from "node:assert/strict";
import { researchCompanyPackage } from "../../server/lib/company-report-research";
import { advancePackage, initialPackage } from "../../server/lib/company-report-package-core";
import { packagePageUrl } from "../../server/lib/company-report-research";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

test("research-only backfill replaces stale excerpts, preserves source IDs and never browses", async () => {
  const url = "https://example.test/";
  const paragraph = "Our technicians install and maintain residential heating equipment. Scheduled service is available for homeowners throughout our service area.";
  const stale = "Old footer reviews and customer opinions must not reach the report writer.";
  const prior: any = { complete: true, evidence: { version: 1, capturedAt: "now", limitations: [], sources: [
    { id: "S4", kind: "public", title: `Rendered browser page: ${url}`, url, text: stale, sha256: hashReportBytes(stale) },
  ] }, map: { resumeVersion: 1, root: url, urls: [url], sitemapFiles: [], sitemapQueue: [], discoveryComplete: true,
    pages: [{ url, status: "rendered", text: paragraph + " Google reviews", sha256: hashReportBytes(paragraph + " Google reviews") }] } };
  const deps: any = { prior, backfillOnly: true, live: async () => {}, checkpoint: async () => {},
    collect: async () => { throw Error("No new research collection"); },
    browse: async () => { throw Error("No browser during factual refresh"); },
    fetch: async () => ({ ok: true, text: `<main><p>${paragraph}</p></main><footer>Google reviews</footer>` }) };
  const result: any = await researchCompanyPackage({ company: "Fixture", website: url }, 1, 55, deps);
  assert.equal(result.evidence.sources.length, 1);
  assert.equal(result.evidence.sources[0].id, "S4");
  assert.equal(result.evidence.sources[0].text, paragraph);
  assert.notEqual(result.evidence.sources[0].sha256, prior.evidence.sources[0].sha256);
  deps.prior = { ...prior, map: { ...prior.map, sitemapQueue: [url + "pending.xml"], discoveryComplete: false } };
  await assert.rejects(researchCompanyPackage({ company: "Fixture", website: url }, 1, 55, deps), /completed discovery/);
});

test("browser-confirmed main facts reach writers despite shared review footers", async () => {
  const paragraph = "We install and maintain furnaces and air conditioners for residential homes. Our technicians provide scheduled service visits.";
  const result: any = await researchCompanyPackage({ company: "Fixture", website: "https://example.test/" }, 1, 44, {
    live: async () => {}, checkpoint: async () => {},
    collect: async () => ({ version: 1, capturedAt: "now", sources: [], limitations: [] }),
    fetch: async url => ({ ok: true, finalUrl: url, text: url.endsWith("sitemap.xml") ? "<urlset/>" :
      `<nav>Google reviews</nav><main><h1>Heating services</h1><p>${paragraph}</p></main><footer>Google reviews</footer>` }),
    browse: async p => p.action === "close_session" ? { ok: true } :
      { ok: true, tabId: "fixture", url: p.url, snapshot: `Google reviews\nHeating services\n${paragraph}\nGoogle reviews` },
  });
  assert.equal(result.complete, true);
  assert.ok(result.evidence.sources.some((s: any) => s.text.includes(paragraph)));
  assert.equal(result.coverage.evidencePages, 1);
  assert.equal(packagePageUrl("/locations.kml", "https://example.test/"), null);
});

test("more than thirty public pages finish across durable batches without repeating successful pages", async () => {
  const root = "https://example.test/";
  const urls = Array.from({ length: 35 }, (_, i) => `${root}service-${i}`);
  const visits: string[] = [];
  let saved: any;
  const deps: any = {
    live: async () => {},
    collect: async () => ({ version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] }),
    fetch: async (url: string) => ({ ok: true, finalUrl: url,
      text: url.endsWith("sitemap.xml") ? `<urlset>${urls.map(u => `<url><loc>${u}</loc></url>`).join("")}</urlset>` : "<html></html>" }),
    browse: async (p: any) => {
      if (p.action === "close_session") return { ok: true };
      visits.push(p.url);
      return { ok: true, tabId: "fixture", url: p.url,
        snapshot: "Public service evidence and practical customer information. ".repeat(8) };
    },
    checkpoint: async (value: any) => { saved = structuredClone(value); },
  };
  for (let batch = 0; batch < 10; batch++) {
    const result: any = await researchCompanyPackage({ company: "Fixture", website: root }, 1, 42,
      { ...deps, prior: saved });
    saved = structuredClone(result);
    if (result.complete) break;
  }
  assert.equal(saved.complete, true);
  assert.equal(saved.coverage.reviewed, 36);
  assert.equal(saved.coverage.pending, 0);
  assert.equal(new Set(visits).size, visits.length);
});

test("unfinished research checkpoints and never starts a report", async () => {
  const state = initialPackage({ company: "Fixture", website: "https://example.test/" });
  let drafts = 0;
  const partial = { complete: false, evidence: { version: 1 as const, sources: [], limitations: [], capturedAt: "2026-10-20" },
    coverage: { discovered: 40, reviewed: 10, failed: 0, pending: 30, capped: true } };
  const ports: any = { checkpoint: async () => {}, research: async () => partial,
    draft: async () => { drafts++; return 1; }, recover: async () => null,
    review: async () => ({ status: "pending" }), assemble: async () => [], combine: async () => {} };
  await advancePackage(state, ports);
  await advancePackage(state, ports);
  assert.equal(drafts, 0);
  assert.equal(state.phase, "researching");
});

test("temporary browser failures are retried in a later batch and successful pages are retained", async () => {
  let snapshot: any;
  let attempts = 0;
  const deps: any = { live: async () => {}, checkpoint: async (s: any) => { snapshot = structuredClone(s); },
    collect: async () => ({ version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] }),
    fetch: async (url: string) => ({ ok: true, finalUrl: url, text: "<html></html>" }),
    browse: async (p: any) => p.action === "close_session" ? { ok: true } :
      ++attempts === 1 ? { ok: false } : { ok: true, tabId: "t", url: p.url, snapshot: "Observed public business information. ".repeat(10) } };
  const first: any = await researchCompanyPackage({ company: "Fixture", website: "https://example.test/" }, 1, 4, deps);
  assert.equal(first.complete, false);
  assert.equal(first.coverage.pending, 1);
  assert.equal(snapshot.map.pages[0].attempts, 1);
  const second: any = await researchCompanyPackage({ company: "Fixture", website: "https://example.test/" }, 1, 4,
    { ...deps, prior: snapshot });
  assert.equal(second.complete, true);
  assert.equal(second.coverage.reviewed, 1);
  assert.equal(second.coverage.pending, 0);
  assert.equal(attempts, 2);
});

test("discovery overflow remains durable after interruption and cannot become completed research", async () => {
  let saved: any;
  const prior = { evidence: { version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] },
    map: { resumeVersion: 1, root: "https://example.test/", urls: ["https://example.test/"],
      pages: [], sitemapFiles: [], sitemapQueue: [], discoveryComplete: true, overflow: true } };
  await assert.rejects(researchCompanyPackage({ company: "Fixture", website: "https://example.test/" }, 1, 4, {
    prior, checkpoint: async (s: any) => { saved = structuredClone(s); }, live: async () => {},
    collect: async () => { throw new Error("must not recollect"); },
    fetch: async () => ({ ok: true, text: "" }),
    browse: async (p: any) => ({ ok: true, tabId: "fixture", url: p.url,
      snapshot: "Observed public business information. ".repeat(10) }),
  }), /5,000-page safety limit/);
  assert.equal(saved.complete, false);
  assert.equal(saved.map.overflow, true);
});

test("unavailable sitemaps are retried and always remain a disclosed discovery limitation", async () => {
  let saved: any;
  const result: any = await researchCompanyPackage({ company: "Fixture", website: "https://example.test/" }, 1, 4, {
    checkpoint: async (s: any) => { saved = structuredClone(s); }, live: async () => {},
    collect: async () => ({ version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] }),
    fetch: async url => ({ ok: !url.endsWith("sitemap.xml"), text: "", finalUrl: url }),
    browse: async (p: any) => ({ ok: true, tabId: "fixture", url: p.url, snapshot: "Observed public business information. ".repeat(10) }),
  });
  assert.equal(result.complete, true);
  assert.equal(result.coverage.capped, true);
  assert.equal(saved.map.sitemapAttempts["https://example.test/sitemap.xml"], 2);
  assert.ok(result.evidence.limitations.some((s: string) => /Sitemap unavailable after two attempts/.test(s)));
});

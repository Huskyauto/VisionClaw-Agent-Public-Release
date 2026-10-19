import test from "node:test";
import assert from "node:assert/strict";
import { advancePackage, initialPackage, REPORT_KINDS } from "../../server/lib/company-report-package-core";
import { createPackageTeaser, combinePackageTeasers } from "../../server/lib/company-report-teasers";
import { packagePageUrl, packageSnapshotLinks, researchCompanyPackage } from "../../server/lib/company-report-research";
import { PDFDocument } from "pdf-lib";

test("one retained investigation produces three full reports before any teaser, without repeating research", async () => {
  const state = initialPackage({ company: "Fictional Example", website: "https://example.test" });
  let research = 0;
  const drafts: string[] = [], teasers: string[] = [];
  const ports = {
    checkpoint: async () => {},
    research: async () => { research++; return { evidence: { version: 1, sources: [], limitations: [], capturedAt: new Date().toISOString() }, coverage: { discovered: 5, reviewed: 4, failed: 0, capped: false } }; },
    draft: async (kind: string) => { drafts.push(kind); return drafts.length; },
    recover: async () => null,
    review: async () => ({ status: "pending" }),
    assemble: async (kind: string) => { teasers.push(kind); return []; },
    combine: async () => {},
  };
  for (let i = 0; i < 6; i++) await advancePackage(state, ports);
  assert.equal(research, 1);
  assert.deepEqual(drafts, [...REPORT_KINDS]);
  assert.deepEqual(teasers, []);
  ports.review = async () => ({ status: "done", sections: [{ heading: "Executive Summary", body: "Approved evidence and specific recommendations." }] }) as any;
  for (let i = 0; i < 5; i++) await advancePackage(state, ports);
  assert.equal(state.phase, "done");
  assert.deepEqual(teasers, [...REPORT_KINDS]);
  assert.equal(research, 1);
  assert.equal(drafts.length, 3);
});

test("a failed first draft does not discard research or prevent the other two reports", async () => {
  const state = initialPackage({ company: "Fictional Example", website: "https://example.test" });
  const drafts: string[] = [];
  const ports = {
    checkpoint: async () => {},
    research: async () => ({ evidence: { version: 1 as const, sources: [], limitations: [], capturedAt: new Date().toISOString() },
      coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false } }),
    draft: async (kind: string) => { drafts.push(kind); if (kind === "readiness") throw new Error("draft failed"); return 12; },
    recover: async () => null, review: async () => ({ status: "pending" }),
    assemble: async () => [], combine: async () => {},
  };
  for (let i = 0; i < 5; i++) await advancePackage(state, ports);
  assert.deepEqual(drafts, [...REPORT_KINDS]);
  assert.equal(state.reports.readiness?.status, "error");
  assert.ok(state.research);
});

test("a blocked report blocks the package even while serialized siblings are waiting", async () => {
  const state = initialPackage({ company: "Fixture", website: "https://example.test" });
  state.phase = "reviewing";
  state.research = { evidence: { version: 1, sources: [], limitations: [], capturedAt: "2026-10-18" },
    coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false } };
  state.reports = { readiness: { status: "pending", jobId: 1 },
    executive: { status: "pending", jobId: 2 }, opportunities: { status: "pending", jobId: 3 } };
  await advancePackage(state, {
    checkpoint: async () => {}, research: async () => { throw new Error("no new research"); },
    draft: async () => { throw new Error("no redraft"); }, recover: async () => null,
    review: async id => ({ status: id === 1 ? "error" : "pending" }),
    assemble: async () => [], combine: async () => { throw new Error("no incomplete assembly"); },
  });
  assert.equal(state.phase, "blocked");
  assert.ok(state.research, "retained evidence survives the stop");
  assert.equal(state.reports.executive?.jobId, 2, "waiting sibling identity is retained");
});

test("teasers are exactly one page each and combined pack is exactly three, with no model calls", async () => {
  const sections = [
    { heading: "Website & Sales Improvements", body: "Recommendation: Make the existing service pages easier to use. " + "Prioritize the visible quote path and clearly explain the next step. ".repeat(8) },
    { heading: "Creative & Profitable Growth Ideas", body: "Recommendation: Test a service follow-up offer using the existing customer workflow. " + "Confirm the owner, dependencies and how a small pilot will be measured. ".repeat(8) },
    { heading: "Quick-Win Revenue Moves", body: "Recommendation: Clarify the service request process and measure qualified enquiries. ".repeat(9) },
  ];
  const pdfs = [];
  for (const kind of REPORT_KINDS) {
    const bytes = await createPackageTeaser({ kind, company: "Fictional Example Services", sections,
      coverage: "4 rendered / 5 discovered. Partial coverage.", capturedAt: "2026-10-18" });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1); pdfs.push(bytes);
  }
  assert.equal((await PDFDocument.load(await combinePackageTeasers(pdfs))).getPageCount(), 3);
});

test("browser research maps discovered pages, records rendering, and rejects unsafe/action URLs", async () => {
  const root = "https://example.test/";
  for (const url of ["https://evil.test/", "http://127.0.0.1/", "/account", "/logout", "/delete/a", "/quote?token=secret", "javascript:alert(1)"])
    assert.equal(packagePageUrl(url, root), null);
  assert.deepEqual(packageSnapshotLinks('- link "Products":\n  - /url: /products\n[Help](/support)\n<a href="/logout">exit</a>', root),
    [`${root}products`, `${root}support`]);
  const visited: string[] = [];
  const result = await researchCompanyPackage({ company: "Fictional Example", website: root }, 1, 123, {
    live: async () => {},
    collect: async () => ({ version: 1, capturedAt: "2026-10-18", sources: [], limitations: [] }),
    fetch: async url => ({ ok: true, finalUrl: url, text: url.endsWith("sitemap.xml")
      ? '<urlset><url><loc>https://example.test/services</loc></url></urlset>'
      : '<html><a href="/about">About</a><a href="/logout">Logout</a><a href="https://evil.test">External</a></html>' }),
    browse: async p => {
      if (p.action === "close_session") return { ok: true };
      visited.push(p.url);
      return { ok: true, tabId: "isolated", url: p.url, title: "Fictional public page",
        snapshot: "Rendered, public company service information and customer quotation journey. ".repeat(5) };
    },
  });
  assert.equal(result.coverage.reviewed, 3);
  assert.deepEqual(new Set(visited), new Set([root, `${root}about`, `${root}services`]));
  assert.ok(result.evidence.sources.every(s => s.title.startsWith("Rendered browser")));
  assert.equal(result.map.pages.length, 3);
});

test("an interrupted draft recovers the exact accepted child instead of starting synthesis again", async () => {
  const state = initialPackage({ company: "Fictional Example", website: "https://example.test" });
  state.phase = "drafting";
  state.research = { evidence: { version: 1, sources: [], limitations: [], capturedAt: "2026-10-18" },
    coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false } };
  state.reports.readiness = { status: "starting" };
  let synthesis = 0, research = 0, recovery = 0;
  await advancePackage(state, {
    checkpoint: async () => {},
    research: async () => { research++; throw new Error("must not investigate again"); },
    draft: async () => { synthesis++; return 99; },
    recover: async kind => { assert.equal(kind, "readiness"); recovery++; return 45; },
    review: async () => ({ status: "pending" }), assemble: async () => [], combine: async () => {},
  });
  assert.equal(state.reports.readiness.jobId, 45);
  assert.equal(state.reports.readiness.status, "pending");
  assert.deepEqual([research, synthesis, recovery], [0, 0, 1]);
});

test("missing rendered browser evidence fails closed rather than producing a homepage-only package", async () => {
  await assert.rejects(researchCompanyPackage({ company: "Fictional Example", website: "https://example.test" }, 1, 321, {
    live: async () => {},
    collect: async () => ({ version: 1, capturedAt: "2026-10-18", sources: [], limitations: [] }),
    fetch: async url => ({ ok: true, text: "<html>Fetched homepage only</html>", finalUrl: url }),
    browse: async () => ({ ok: false, error: "browser unavailable" }),
  }), /Rendered browser research is unavailable/);
});

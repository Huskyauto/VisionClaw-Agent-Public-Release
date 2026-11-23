import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// The adapter anchors its optional config path at import time. Keep the suite
// independent from both saved workspace credentials and real network access.
const fixture = mkdtempSync(join(tmpdir(), "firecrawl-test-"));
const cwd = process.cwd();
const firecrawl = await (async () => {
  process.chdir(fixture);
  try { return await import("../../server/firecrawl"); }
  finally { process.chdir(cwd); }
})();
Object.assign(firecrawl.loadFirecrawlConfig(), {
  apiKey: "offline-firecrawl-fixture",
  baseUrl: "https://api.firecrawl.dev/v1/",
  maxAgeMs: 0,
  enabled: true,
});
after(() => rmSync(fixture, { force: true, recursive: true }));

const target = "https://93.184.216.34/docs";
const json = (data: unknown) => Response.json(data);

test("scrape uses v2, honors freshness, and normalizes array titles", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.firecrawl.dev/v2/scrape");
    assert.equal(JSON.parse(String(init.body)).maxAge, 0);
    return json({ success: true, data: { markdown: "# Page", metadata: { title: ["Page"], sourceURL: target } } });
  });
  const result = await firecrawl.firecrawlScrape(target);
  assert.equal(result.error, undefined);
  assert.equal(result.title, "Page");
  assert.equal(result.content, "# Page");
});

test("map returns URL strings and search returns only normalized web results", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/v2/map")) return json({ success: true, links: [{ url: target }, null, {}] });
    assert.equal(url, "https://api.firecrawl.dev/v2/search");
    assert.equal(JSON.parse(String(init.body)).limit, 5);
    return json({ success: true, data: {
      web: [{ url: target, title: "Top-level title", markdown: "Found it" }, { title: "No URL" }],
      news: [{ url: "https://example.com/news" }],
    } });
  });
  assert.deepEqual(await firecrawl.firecrawlMapSite(target), { success: true, urls: [target] });
  assert.deepEqual(await firecrawl.firecrawlSearch("test query"), {
    success: true, results: [{ url: target, title: "Top-level title", markdown: "Found it" }],
  });
});

test("crawl preserves path depth, polls v2, and constrains pagination to the same job", async (t) => {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn: () => void, delay?: number) => timeout(fn, delay === 5_000 ? 0 : delay));
  const calls: string[] = [];
  const base = "https://api.firecrawl.dev/v2/crawl";
  for (const variant of ["normal", "foreignCursor", "filters"] as const) {
    calls.length = 0;
    const mocked = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url === base) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.maxDepth, undefined);
        assert.equal(body.maxDiscoveryDepth, undefined);
        assert.equal(body.regexOnFullURL, false);
        if (variant === "filters") {
          assert.deepEqual(body.includePaths, ["^/docs"]);
          assert.deepEqual(body.excludePaths, ["^/about", "^(/+[^/]+){2}"]);
        } else {
          assert.deepEqual(body.includePaths, ["^(/+[^/]+){0,1}/*$", "^(/+[^/]+){0,1}/+index\\.(html|php)/*$"]);
        }
        return json({ success: true, id: "fixture-job" });
      }
      assert.equal(init.redirect, "error");
      if (url === `${base}/fixture-job`) return json({
        status: "completed", data: [],
        next: variant === "foreignCursor" ? "https://example.com/v2/crawl/fixture-job?skip=1" : `${base}/fixture-job?skip=1`,
      });
      assert.equal(url, `${base}/fixture-job?skip=1`);
      return json({ status: "completed", data: [] });
    });
    const result = await firecrawl.firecrawlCrawlSite(target, 7, {
      maxDepth: 1,
      ...(variant === "filters" ? { includePaths: ["^/docs"], excludePaths: ["^/about"] } : {}),
    });
    assert.equal(result.success, false);
    if (variant === "foreignCursor") {
      assert.match(result.error ?? "", /pagination/i);
      assert.deepEqual(calls, [base, `${base}/fixture-job`]);
    } else {
      assert.match(result.error ?? "", /no pages/i);
      assert.deepEqual(calls, [base, `${base}/fixture-job`, `${base}/fixture-job?skip=1`]);
    }
    mocked.mock.restore();
  }
});

test("crawl persists both pages for the requested tenant after a transient continuation failure", async (t) => {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn: () => void, delay?: number) => timeout(fn, delay === 5_000 ? 0 : delay));
  const { db } = await import("../../server/db");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const inserted: unknown[] = [];
  t.mock.method(db, "select", () => ({
    from: () => ({ where: (filter: Parameters<typeof dialect.sqlToQuery>[0]) => {
      assert.ok(dialect.sqlToQuery(filter).params.includes(7), "existing page lookup is tenant scoped");
      return { limit: async () => [] };
    } }),
  }));
  t.mock.method(db, "insert", () => ({ values: async (row: unknown) => { inserted.push(row); } }));
  const status = "https://api.firecrawl.dev/v2/crawl/fixture-job";
  let continuationCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/v2/crawl")) return json({ success: true, id: "fixture-job" });
    const next = url.endsWith("?skip=1");
    if (next && ++continuationCalls === 1) {
      return new Response(null, { status: 503, headers: { "retry-after": "0" } });
    }
    return json({
      status: "completed",
      data: [{ markdown: "# Page", metadata: { title: [next ? "Page Two" : "Page One"], sourceURL: next ? `${target}/two` : target } }],
      ...(next ? {} : { next: `${status}?skip=1` }),
    });
  });
  const result = await firecrawl.firecrawlCrawlSite(target, 7, { limit: 2, maxDepth: 2 });
  assert.equal(result.error, undefined);
  assert.equal(continuationCalls, 2);
  assert.equal(result.pagesScraped, 2);
  assert.deepEqual(inserted.map((r) => {
    const { tenantId, title } = r as { tenantId: number; title: string };
    return { tenantId, title };
  }), [{ tenantId: 7, title: "Page One" }, { tenantId: 7, title: "Page Two" }]);
});

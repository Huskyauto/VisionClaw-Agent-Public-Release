import test from "node:test";
import assert from "node:assert/strict";
import { collectPublicReportSupplement } from "../../server/lib/report-public-research";

test("outside research retains fetched pages, not search snippets, and captures actual llms.txt", async () => {
  const reads: string[] = [];
  const result = await collectPublicReportSupplement("https://example.com/", "Example Company", {
    search: async () => ({ success: true, results: [
      { url: "https://outside.example/news", text: "Search snippet promises a 50% profit gain." },
      { url: "https://wrong.example/news", text: "Example Company" },
    ] }),
    fetchText: async (url) => {
      reads.push(url);
      return { ok: true, finalUrl: url, text: url.endsWith("llms.txt") ? "# Example Company\nSee /products."
        : url.includes("wrong.") ? "<body>A completely different company.</body>"
        : "<title>Industry news</title><body>Example Company supplies industrial tools. These are public statements from a third-party source, not an internal operational audit.</body>" };
    },
  });
  assert.equal(reads.length, 3);
  assert.equal(result.sources.length, 2);
  assert.match(result.sources[0].text, /See \/products/);
  assert.doesNotMatch(JSON.stringify(result.sources), /50% profit|different company/);
  assert.match(result.limitations.join(" "), /corroborat/i);
});

test("unsuccessful free search is explicitly disclosed, not represented as completed outside research", async () => {
  const result = await collectPublicReportSupplement("https://example.com/", "Example Company", {
    search: async () => ({ success: false, results: [] }),
    fetchText: async () => ({ ok: false }),
  });
  assert.deepEqual(result.sources, []);
  assert.match(result.limitations.join(" "), /outside-company search.*unavailable/i);
});

test("generic outside research cannot bypass customer-feedback exclusions or retain full review pages", async () => {
  const reads: string[] = [];
  const result = await collectPublicReportSupplement("https://example.com/", "Example Company", {
    search: async () => ({ success: true, results: [
      { url: "https://www.google.com/maps/reviews" }, { url: "https://www.facebook.com/example" },
      { url: "https://directory.example/reviews" },
    ] }),
    fetchText: async url => {
      reads.push(url);
      return { ok: true, finalUrl: url, text: url.endsWith("llms.txt") ? "# Example Company\nSee /products."
        : `<title>Example Company reviews</title><body>Example Company ${"private review content ".repeat(50)}
          <script type="application/ld+json">{"@type":"Review","reviewBody":"Exclude full review page"}</script></body>` };
    },
  });
  assert.ok(reads.every(url => !/google\.com|facebook\.com/.test(url)));
  assert.doesNotMatch(JSON.stringify(result.sources), /private review content|Exclude full review/);
  assert.match(result.limitations.join(" "), /feedback collector/i);
});

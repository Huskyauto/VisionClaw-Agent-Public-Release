import test from "node:test";
import assert from "node:assert/strict";
import { collectReportCustomerFeedback } from "../../server/lib/report-customer-feedback";
import { collectBusinessReportEvidence, hashReportBytes, reportEvidenceAppendices } from "../../server/lib/business-report-evidence";

const website = "https://www.example.com/";
const page = (reviews: unknown[] = []) => `<title>Example Company reviews</title><body>
  <a href="${website}">Example Company website</a>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "LocalBusiness", name: "Example Company", url: website,
    review: reviews,
  })}</script></body>`;
const review = { "@type": "Review", reviewBody: "The team explained the product choices clearly.",
  datePublished: "2026-10-01", author: { name: "Private customer name" }, reviewRating: { ratingValue: 5 } };

test("feedback retains attributed buyer opinions, dates and bounded sample, not search snippets or reviewer identity", async () => {
  const result = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text: page([review]) }),
  });
  assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].text, /customer review.*not independently verified/i);
  assert.match(result.sources[0].text, /2026-10-01/);
  assert.match(result.sources[0].text, /explained the product choices/);
  assert.doesNotMatch(result.sources[0].text, /Private customer name|ratingValue/);
  assert.match(result.limitations.join(" "), /not representative/i);
});

test("the shared report collector preserves feedback and access limits through hashes and the customer appendix", async () => {
  const result = await collectBusinessReportEvidence({ company: "Example Company", website }, { allowPaidExtraction: false }, {
    runAudit: async () => ({ checks: [], finalUrl: website }) as any,
    safeFetchText: async (url: string) => ({ ok: true, finalUrl: url, text: url === website
      ? '<title>Example Company</title><body>Rail tools <a href="https://www.facebook.com/example">Facebook</a></body>'
      : url.includes("directory.example") ? page([review]) : "# Example Company\nRail tools." }) as any,
    fallback: async () => { throw new Error("Must not spend"); },
    publicSearch: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }) as any,
  });
  const feedback = result.sources.find(source => source.title === "Matched public customer-review sample");
  assert.ok(feedback, "Both report types share the collector; reviews must reach its retained evidence");
  assert.equal(feedback.sha256, hashReportBytes(feedback.text));
  assert.match(result.sources.find(source => /social profile links/.test(source.title))!.text, /not.*customer|do not establish/i);
  const appendices = reportEvidenceAppendices(result, [], { digest: "fixture", round: 1, juryVerdict: "fixture", museRequestId: "fixture" }, true);
  assert.match(appendices[0].body, /explained the product choices/);
  assert.match(appendices[1].body, /Google review content was not collected/);
});

test("repeated schema records do not inflate the review sample, and Google-syndicated reviews are excluded", async () => {
  const result = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text: page([review, review,
      { ...review, reviewBody: "Google-only customer opinion must not be retained.", publisher: { name: "Google" } }]) }),
  });
  assert.match(result.sources[0].text, /Sample: 1 review/);
  assert.equal(result.sources[0].text.match(/explained the product/g)?.length, 1);
  assert.doesNotMatch(JSON.stringify(result.sources), /Google-only/);
  assert.match(result.limitations.join(" "), /Google-attributed review was excluded/);
});

test("same-name businesses, unrelated embedded reviews and login walls cannot establish customer feedback", async () => {
  for (const html of [
    page([review]).replaceAll(website, "https://unrelated.example/"),
    page([review]).replace('"name":"Example Company"', '"name":"Other Business"'),
    `<body>Example Company <a href="${website}">Website</a>Log in to continue</body>`,
  ]) {
    const result = await collectReportCustomerFeedback(website, "Example Company", "", {
      search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
      fetchText: async url => ({ ok: true, finalUrl: url, text: html }),
    });
    assert.ok(result.sources.every(source => !source.text.includes("explained the product choices")));
    assert.match(result.limitations.join(" "), /satisfaction.*unassessed/i);
  }
});

test("Google/social candidates and redirect content are excluded; searches and reads remain bounded", async () => {
  let searches = 0;
  const reads: string[] = [];
  const result = await collectReportCustomerFeedback(website, "Example Company",
    `<a href="https://www.facebook.com/example">Company Facebook</a>`, {
      search: async () => { searches++; return { success: true, results: [
        { url: "https://google.com/maps/reviews" }, { url: "https://x.com/example" },
        { url: "https://directory.example/one" }, { url: "https://directory.example/two" },
        { url: "https://directory.example/ignored" },
      ] }; },
      fetchText: async url => { reads.push(url); return { ok: true,
        finalUrl: "https://www.google.com/maps/reviews", text: page([review]) }; },
    });
  assert.equal(searches, 2);
  assert.ok(reads.length <= 3);
  assert.ok(reads.every(url => !/google\.com|x\.com/.test(url)));
  assert.equal(result.sources.length, 1);
  assert.doesNotMatch(JSON.stringify(result.sources), /explained the product choices/);
  assert.match(result.sources[0].title, /not customer reviews/);
  assert.match(result.limitations.join(" "), /excluded source/);
});

test("review samples have a fixed total quotation bound and failed discovery never becomes a satisfaction claim", async () => {
  const result = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text: page(Array.from({ length: 20 }, (_, i) =>
      ({ ...review, reviewBody: `${i} ` + "A detailed customer's opinion about this supplier. ".repeat(10) }))) }),
  });
  assert.match(result.sources[0].text, /Sample: 2 review/);
  const quotes = [...result.sources[0].text.matchAll(/not independently verified\): (.*)/g)].map(m => m[1]);
  assert.ok(quotes.join("").length <= 300);
  const unavailable = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => { throw new Error("Unavailable"); },
    fetchText: async () => { throw new Error("Must not fetch"); },
  });
  assert.deepEqual(unavailable.sources, []);
  assert.match(unavailable.limitations.join(" "), /search failed/);
  assert.match(unavailable.limitations.join(" "), /not evidence of good or bad service/);
});

test("unsupported plain-text reviews are not copied as directory descriptions", async () => {
  const result = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text:
      `<body>Example Company <a href="${website}">Official website</a>
      Google reviews: A private customer's long review must not be disguised as a directory excerpt.</body>` }),
  });
  assert.equal(result.sources.length, 1);
  assert.doesNotMatch(JSON.stringify(result.sources), /private customer's long review/);
  assert.match(result.limitations.join(" "), /unassessed/);
});

test("malformed review data and shared-host business paths are disclosed, never treated as matched feedback", async () => {
  const malformed = await collectReportCustomerFeedback(website, "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text: page([review]).replace('"reviewBody":', '"reviewBody": invalid ') }),
  });
  assert.deepEqual(malformed.sources, []);
  assert.match(malformed.limitations.join(" "), /structured.*pars|pars.*structured/i);
  const otherPath = await collectReportCustomerFeedback("https://example.com/business/one", "Example Company", "", {
    search: async () => ({ success: true, results: [{ url: "https://directory.example/example" }] }),
    fetchText: async url => ({ ok: true, finalUrl: url, text: page([review]).replaceAll(website, "https://example.com/business/two") }),
  });
  assert.deepEqual(otherPath.sources, []);
});

test("homepage and generic prose cannot smuggle attributed reviews through alternate phrasing", async () => {
  const result = await collectBusinessReportEvidence({ company: "Example Company", website }, { allowPaidExtraction: false }, {
    runAudit: async () => ({ checks: [], finalUrl: website }) as any,
    safeFetchText: async (url: string) => ({ ok: true, finalUrl: url, text:
      url.endsWith("llms.txt") ? "# Example Company\nProduct information."
      : `<body>Example Company. Customer feedback on Google: A copied opinion must not enter the report.</body>` }) as any,
    fallback: async () => { throw new Error("Must not spend"); },
    publicSearch: async () => ({ success: true, results: [{ url: "https://directory.example/news" }] }) as any,
  });
  assert.doesNotMatch(JSON.stringify(result.sources), /A copied opinion/);
  assert.match(result.limitations.join(" "), /review-bearing.*omitted/i);
});

/**
 * Fix Kit validators — pure fail-closed checks behind the DFY ($1,997) audit
 * remediation package. No DB, no network (pg-pool hang rule).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLlmsTxt,
  validateJsonLd,
  validateMetaTags,
  stripHtmlToText,
} from "../../server/audit-fix-kit";

const goodLlms =
  "# Acme Plumbing\n\n> Acme Plumbing serves Springfield with 24/7 emergency plumbing.\n\n## Services\n- [Home](https://acmeplumbing.com/)\n" +
  "Acme Plumbing is a local plumbing company offering drain cleaning, water heater repair, and emergency service across Springfield. ".repeat(2);

test("llms.txt: accepts a grounded, well-formed file", () => {
  assert.equal(validateLlmsTxt(goodLlms, "acmeplumbing.com", "Acme Plumbing"), null);
});

test("llms.txt: rejects too-short output", () => {
  assert.match(validateLlmsTxt("# Acme", "acmeplumbing.com", "Acme Plumbing")!, /too short/);
});

test("llms.txt: rejects ungrounded output (no domain or business name)", () => {
  const generic = "# Some Business\n" + "Generic text about a business that never names anyone in particular. ".repeat(5);
  assert.match(validateLlmsTxt(generic, "acmeplumbing.com", "Acme Plumbing")!, /ungrounded/);
});

test("llms.txt: rejects missing heading start", () => {
  const noHeading = "Acme Plumbing acmeplumbing.com " + "text ".repeat(60);
  assert.match(validateLlmsTxt(noHeading, "acmeplumbing.com", "Acme Plumbing")!, /heading/);
});

test("json-ld: accepts a valid LocalBusiness node", () => {
  const jsonld = JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Acme", url: "https://acmeplumbing.com" });
  assert.equal(validateJsonLd(jsonld), null);
});

test("json-ld: accepts an array of nodes", () => {
  const arr = JSON.stringify([
    { "@context": "https://schema.org", "@type": "LocalBusiness", name: "Acme" },
    { "@context": "https://schema.org", "@type": "FAQPage" },
  ]);
  assert.equal(validateJsonLd(arr), null);
});

test("json-ld: rejects invalid JSON (fail closed)", () => {
  assert.match(validateJsonLd("{not json")!, /not valid JSON/);
});

test("json-ld: rejects node missing @context/@type", () => {
  assert.match(validateJsonLd(JSON.stringify({ name: "Acme" }))!, /@context or @type/);
});

test("validateJsonLd rejects a url pointing at a foreign domain (grounding)", () => {
  const node = JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Acme", url: "https://evil.example.org" });
  assert.match(validateJsonLd(node, "acmeplumbing.com")!, /ungrounded/);
  const good = JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Acme", url: "https://www.acmeplumbing.com" });
  assert.equal(validateJsonLd(good, "acmeplumbing.com"), null);
});

test("validateMetaTags rejects foreign-domain URLs when domain is given (grounding)", () => {
  const bad = `<title>Acme Plumbing Co</title>\n<meta name="description" content="Plumbing services in town, licensed and insured for you.">\n<link rel="canonical" href="https://other-site.net/">`;
  assert.match(validateMetaTags(bad, "acmeplumbing.com")!, /foreign domain/);
  const good = `<title>Acme Plumbing Co</title>\n<meta name="description" content="Plumbing services in town, licensed and insured for you.">\n<link rel="canonical" href="https://acmeplumbing.com/">`;
  assert.equal(validateMetaTags(good, "acmeplumbing.com"), null);
});

test("meta tags: accepts a proper head fragment", () => {
  const meta = `<title>Acme Plumbing — Springfield</title>\n<meta name="description" content="24/7 plumbing in Springfield.">\n<link rel="canonical" href="https://acmeplumbing.com/">`;
  assert.equal(validateMetaTags(meta), null);
});

test("meta tags: rejects missing title / description", () => {
  assert.match(validateMetaTags(`<meta name="description" content="x">`)!, /<title>/);
  assert.match(validateMetaTags(`<title>Acme Plumbing Co</title>`)!, /description/);
});

test("meta tags: rejects body/script content (head tags only)", () => {
  const bad = `<title>Acme Plumbing Co</title>\n<meta name="description" content="x">\n<script>alert(1)</script>`;
  assert.match(validateMetaTags(bad)!, /head tags only/);
});

test("stripHtmlToText: strips scripts/styles/tags and caps length", () => {
  const html = `<html><head><style>.x{}</style><script>evil()</script></head><body><h1>Acme</h1><p>Plumbing &amp; heating</p></body></html>`;
  const text = stripHtmlToText(html);
  assert.ok(text.includes("Acme"));
  assert.ok(text.includes("Plumbing"));
  assert.ok(!text.includes("evil"));
  assert.ok(!text.includes("<"));
  assert.ok(stripHtmlToText("a".repeat(10000)).length <= 6000);
});

import test from "node:test";
import assert from "node:assert/strict";
import { teaserSelections, structuredTeaserSelections } from "../../server/lib/company-report-teasers";
import { isPackageFileKey } from "../../server/lib/company-report-package-core";

test("private package keys admit bounded teaser revisions without broadening file access", () => {
  for (const key of ["readiness-full", "readiness-full-v4", "executive-teaser", "opportunities-teaser-v3", "teaser-pack-v3"])
    assert.equal(isPackageFileKey(key), true, key);
  for (const key of ["../secret", "readiness-full-v0", "readiness-teaser-v0", "teaser-pack-v10000", "teaser-pack\n"])
    assert.equal(isPackageFileKey(key), false, key);
});

test("a practical-priorities teaser selects approved advice, not the site's sales quote", () => {
  const rows = teaserSelections("readiness", [{ heading: "Priority Roadmap",
    body: "Source excerpt: Call today for the best HVAC service.\n\nOur recommendation: **Track booked calls** before choosing a new `CRM`.\n\nPlanning assumption: Revenue could be $500." }]);
  assert.match(rows[0].text, /Track booked calls/);
  assert.doesNotMatch(rows[0].text, /Call today|\*\*|`|Revenue|\$500/);
});

test("action selection does not mistake a transactions heading for a roadmap", () => {
  const rows = structuredTeaserSelections("readiness", [
    { heading: "Agent Readiness & Transactions", body: "Our recommendation: Booking capability remains unverified." },
    { heading: "90-Day AI Readiness Roadmap", body: "Our recommendation: Verify entity details, improve booking information and measure calls." },
  ]);
  const priorities = rows.find(row => row.heading === "Your first improvement priorities");
  assert.match(priorities!.text, /Verify entity details/);
  assert.doesNotMatch(priorities!.text, /Booking capability|Our recommendation/);
});

test("structured teasers do not repeat a section under overlapping headings", () => {
  const rows = structuredTeaserSelections("executive", [
    { heading: "Executive Summary", body: "Our recommendation: Focus on the strongest existing services." },
    { heading: "Current Website Strengths", body: "Our recommendation: Preserve the site's useful technical foundation." },
    { heading: "Website & Sales Improvements", body: "Our recommendation: Measure booked appointments from enquiry forms." },
    { heading: "Creative & Profitable Growth Ideas", body: "Our recommendation: Test a clearly defined maintenance offer." },
    { heading: "Ancillary Revenue Opportunities", body: "Our recommendation: Verify demand for replacement filters." },
  ]);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(row => row.text)).size, rows.length);
  assert.match(rows.find(row => /Website & sales/.test(row.heading))!.text, /Measure booked/);
});

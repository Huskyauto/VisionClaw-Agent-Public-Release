import test from "node:test";
import assert from "node:assert/strict";
import { advancePackage, initialPackage } from "../../server/lib/company-report-package-core";
import * as readiness from "../../server/lib/company-report-preflight";
import * as facts from "../../server/lib/company-report-page-facts";

test("configuration preflight lists actionable problems without performing inference", () => {
  const result = readiness.packageConfiguration({});
  assert.equal(result.ready, false);
  assert.ok(result.issues.length > 0);
  assert.equal(result.modelBudgetUsd, 150);
  assert.equal(result.models.length, 4);
});

test("a failed sibling does not block another report that is still completing", async () => {
  const state = initialPackage({ company: "Fixture", website: "https://example.test" });
  state.phase = "reviewing";
  state.research = { evidence: { version: 1, capturedAt: "now", sources: [], limitations: [] },
    coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false } };
  state.reports = { readiness: { status: "error" }, executive: { status: "pending", jobId: 2 },
    opportunities: { status: "error" } };
  const ports: any = { checkpoint: async () => {}, review: async () => ({ status: "pending" }),
    combine: async () => { throw Error("Cannot combine an incomplete package"); } };
  await advancePackage(state, ports);
  assert.equal(state.phase, "reviewing");
  ports.review = async () => ({ status: "done" });
  ports.assemble = async () => [{ key: "executive-full", category: "full", filename: "saved.pdf", label: "Saved report" }];
  await advancePackage(state, ports);
  assert.equal(state.phase, "blocked");
  assert.equal(state.reports.executive?.status, "done");
  assert.equal(state.files.length, 1);
});

test("main content survives review navigation/footer without retaining customer opinions", () => {
  const paragraph = "We install and maintain furnaces and air conditioners for residential homes. Our technicians provide scheduled service visits.";
  const opinion = "This customer opinion must never become a company fact.";
  const html = `<nav>Reviews Google</nav><main><h1>Heating services</h1><p>${paragraph}</p>
    <section class="testimonials"><h2>Reviews</h2><p>${opinion}</p></section></main><footer>Google reviews</footer>`;
  const snapshot = `Navigation Reviews Google\nHeating services\n${paragraph}\nReviews\n${opinion}\nFooter Google reviews`;
  const text = facts.renderedCompanyFacts(snapshot, html);
  assert.ok(text.includes(paragraph));
  assert.ok(!text.includes(opinion));
  assert.ok(!/google|reviews|testimonials/i.test(text));
  assert.ok(facts.renderedCompanyFacts(snapshot, html.replace("<main>", '<div data-elementor-type="page">')
    .replace("</main>", "</div>")).includes(paragraph), "page-builder content has an explicit page boundary too");
  const builder = `<div data-elementor-type="page"><div data-elementor-type="container"><p>${paragraph}</p></div>
    <div data-elementor-type="container"><h4>Customer Reviews</h4><p>${opinion}</p></div></div>`;
  const projected = facts.renderedCompanyFacts(snapshot, builder, true);
  assert.ok(projected.includes(paragraph));
  assert.ok(!projected.includes(opinion), "exclude the whole review-bearing embedded template");
  const attributeOnly = builder.replace("<h4>Customer Reviews</h4>", '<h4 class="review-title">What people say</h4>');
  const attributeProjection = facts.renderedCompanyFacts(snapshot, attributeOnly, true);
  assert.ok(attributeProjection.includes(paragraph));
  assert.ok(!attributeProjection.includes(opinion), "attribute-only feedback markers exclude their whole template");
  assert.ok(!facts.renderedCompanyFacts(`${paragraph}\n${opinion}`, attributeOnly).includes(opinion),
    "a clean-looking snapshot must not bypass HTML-only feedback markers");
  const headerMarker = attributeOnly.replace('<h4 class="review-title">What people say</h4>',
    '<header class="review-title">What people say</header>');
  assert.ok(!facts.renderedCompanyFacts(`${paragraph}\n${opinion}`, headerMarker, true).includes(opinion),
    "classify review headers before deleting any nodes");
  for (const tag of ["nav", "footer"]) {
    const markup = `<main><section><p>${paragraph}</p></section><section><${tag}>Reviews</${tag}><p>${opinion}</p></section></main>`;
    const result = facts.renderedCompanyFacts(`${paragraph}\n${opinion}`, markup, true);
    assert.ok(result.includes(paragraph));
    assert.ok(!result.includes(opinion), `${tag} feedback cues exclude their containing section before deletion`);
    assert.equal(facts.renderedCompanyFacts(`${paragraph}\n${opinion}`,
      `<main><p>${paragraph}</p><${tag}>Reviews</${tag}><p>${opinion}</p></main>`, true), "",
    "unbounded feedback cues cannot be erased before the residual check");
  }
  assert.equal(facts.renderedCompanyFacts(snapshot,
    `<main><p>${paragraph}</p><h4 class="review-title">What people say</h4><p>${opinion}</p></main>`, true), "",
  "an ambiguous feedback boundary rejects the projection instead of deleting only its heading");
  assert.equal(facts.renderedCompanyFacts("Different rendered page entirely.", html), "");
  assert.equal(facts.renderedCompanyFacts(snapshot, `<p>${paragraph}</p>`), "",
    "review-bearing pages without a bounded main-content region stay excluded");
});

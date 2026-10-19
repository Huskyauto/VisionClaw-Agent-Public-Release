import test from "node:test";
import assert from "node:assert/strict";
import { validateReportQuality } from "../../server/lib/business-report-quality";

test("public-source advice can be actionable without private company financial or CRM data", () => {
  const report = {
    sections: [{ heading: "Summary", blocks: [{ text: "Test clearer product-selection guidance." }] }],
    actionPlan: [{
      priority: 1, action: "Pilot a product-selection enquiry form",
      sourceIds: ["S1"], benefit: "Reduce avoidable back-and-forth before quoting.",
      effort: "Planning estimate: 1–2 weeks; confirm after a small technical review.",
      cost: "Planning assumption: use existing site tools; obtain a quote before committing.",
      risk: "Incorrect routing; retain human review.",
      dependency: "Confirm who answers enquiries; current CRM is unknown, not absent.",
      owner: "Sales or website lead", measurement: "Compare qualified enquiries and response time before and after a pilot.",
    }], corrections: [{ id: "C1", disposition: "removed", resolution: "Removed the unsupported assertion that no CRM exists." }],
  };
  report.actionPlan = [1, 2, 3].map(priority => ({ ...report.actionPlan[0], priority }));
  assert.doesNotThrow(() => validateReportQuality(report, ["S1"], [{ id: "C1", text: "CRM is unknown." }]));
  assert.throws(() => validateReportQuality(report, ["S1"],
    [{ id: "C1", text: "CRM is unknown." }], true), /overview|detail/i);
  const detailed = { ...report, sections: [{
    heading: "Summary", blocks: [
      { type: "recommendation", text: "Key points:\n- Improve quote intake and retain human support." },
      { type: "recommendation", text: "Analysis: Review the information customers need to supply before a quote can be prepared. Identify missing instructions with sales staff and explain the expected customer benefit without claiming measured lost sales." },
      { type: "recommendation", text: "Implementation: Have the sales lead pilot one clearer intake page with a qualified reviewer. Confirm current tools and baseline handling time, then compare complete submissions and quote preparation time before expanding." },
    ],
  }] };
  assert.doesNotThrow(() => validateReportQuality(detailed, ["S1"],
    [{ id: "C1", text: "CRM is unknown." }], true));
  for (const text of ["Overall verdict: pilot the workflow before committing.",
    "Local citations: verify public directory information before updating it."]) {
    assert.doesNotThrow(() => validateReportQuality({ ...report,
      sections: [{ heading: "Summary", blocks: [{ text }] }] },
      ["S1"], [{ id: "C1", text: "CRM is unknown." }]));
  }
  for (const text of ["VERDICT: FIX", "CITATIONS: [S1]", "FIX_PROPOSAL: apply the jury patch"]) {
    assert.throws(() => validateReportQuality({ ...report,
      sections: [{ heading: "Summary", blocks: [{ text }] }] },
      ["S1"], [{ id: "C1", text: "CRM is unknown." }]), /Internal review language/);
  }
  assert.throws(() => validateReportQuality({ ...detailed, sections: [
    { ...detailed.sections[0], heading: "Executive Summary" },
    { ...detailed.sections[0], heading: "Customer Relationships" },
  ] }, ["S1"], [{ id: "C1", text: "CRM is unknown." }], true), /cover every major section/i);
  assert.throws(() => validateReportQuality({ ...report, actionPlan: report.actionPlan.map(a => ({ ...a, risk: "" })) },
    ["S1"], []), /risk/i);
  assert.throws(() => validateReportQuality({ ...report, corrections: [] }, ["S1"],
    [{ id: "C1", text: "CRM is unknown." }]), /correction/i);
  assert.throws(() => validateReportQuality({ ...report, sections: [
    { heading: "Summary", blocks: [{ text: "The jury found that the website needs changes." }] },
  ] }, ["S1"], [{ id: "C1", text: "CRM is unknown." }]), /Internal review language/);
  assert.throws(() => validateReportQuality({ ...report, actionPlan: report.actionPlan.map(a =>
    ({ ...a, sourceIds: ["S999"] })) }, ["S1"], []), /source references/);
  const checklist = [{ id: "C1", text: "CRM is unknown." }];
  assert.doesNotThrow(() => validateReportQuality({ ...report, sections: [
    { heading: "Executive Summary", blocks: [{ text: "Useful insight. ".repeat(70) }] },
  ] }, ["S1"], checklist));
  assert.doesNotThrow(() => validateReportQuality({ ...report, sections: [
    { heading: "Growth Ideas", blocks: [{ text: "Useful insight. ".repeat(100) }] },
  ] }, ["S1"], checklist));
  assert.doesNotThrow(() => validateReportQuality({ ...report, sections: Array.from({ length: 12 }, (_, i) => ({
    heading: `Finding ${i}`, blocks: [{ text: "Useful insight. ".repeat(75) }],
  })) }, ["S1"], checklist));
  assert.doesNotThrow(() => validateReportQuality({ ...report, actionPlan: report.actionPlan.map(a =>
    ({ ...a, benefit: "Conditional potential benefit. ".repeat(30) })) }, ["S1"], checklist));
});

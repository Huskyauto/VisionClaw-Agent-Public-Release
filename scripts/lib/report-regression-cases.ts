import { createHash } from "node:crypto";
import type { PackageKind } from "../../server/lib/company-report-package-core";

/** Hand-authored synthetic provider-response fixtures, NOT captured customer
 * data or proof of model quality. Reused paragraphs exercise full-size limits. */
const cases: Array<{ id: string; kind: PackageKind; company: string; fact: string; workflow: string;
  headings: string[] }> = [
  { id: "retail", kind: "readiness", company: "Fictional Maple Retail",
    fact: "Fictional Maple Retail lists 12 product categories and accepts quotation requests through its website.",
    workflow: "quotation follow-up",
    headings: ["Executive Assessment", "Website and Customer Journey", "Data and Systems Readiness",
      "AI Use Cases and Safeguards", "Implementation Roadmap", "Costs, Ownership and Success Measures"] },
  { id: "consulting", kind: "executive", company: "Fictional Cedar Consulting",
    fact: "Fictional Cedar Consulting describes 3 service packages and offers an introductory appointment.",
    workflow: "appointment preparation",
    headings: ["Business Overview and Evidence", "Customer Experience and Positioning", "Operations and Service Delivery",
      "Growth and Competitive Strategy", "Prioritized Action Plan", "Risks, Costs and Measurement"] },
  { id: "catering", kind: "opportunities", company: "Fictional River Catering",
    fact: "Fictional River Catering publishes 4 event menus and asks customers to request a custom proposal.",
    workflow: "event enquiry preparation",
    headings: ["Opportunity Overview", "Core Service Revenue Opportunities", "Customer Retention and Expansion",
      "AI-Enabled Products and Services", "Offer, Pricing and Go-to-Market", "Pilot Plan, Economics and Risks"] },
];
export function reportRegressionCases() {
  return cases.map(fixture => {
    const recommendation = [
      `For ${fixture.company}, first test ${fixture.workflow} with an owner-approved example rather than a broad software rollout.`,
      "Assign a responsible person before starting; confirm the existing process, where the request arrives, how it is checked, and which decisions must remain with a human.",
      "Use existing tools and a small permissioned sample. Keep the original evidence and compare assisted work with the current manual process, recording corrections rather than counting a plausible draft as success.",
      "Set a 14-day pilot window and a 30-minute review allowance as planning assumptions, not observed company operating figures. Ask the owner whether those limits are practical before agreeing to a trial.",
      "Measure completed work, correction time and customer replies separately. A faster draft that increases mistakes is not an improvement, and a delivered message is not evidence of a sale.",
      "Start with referrals and existing permissioned relationships instead of buying advertisements or scraping contact lists. Drafts require review; this report does not authorize sending any message.",
      "Keep a copyable manual fallback, stop on an access problem, and do not put private customer material into an unapproved service. Review both normal requests and an incomplete request before expanding.",
      `In this report's ${fixture.workflow} example, the final decision stays with the business owner, not the model or the fixture evaluator.`,
    ].join(" ");
    const assumption = [
      "Planning assumptions are not forecasts. Current staffing, systems, customer consent, request volume, margins and conversion rates have not been independently established.",
      "Do not infer an internal process from a public website. Ask the owner to confirm the workflow, identify its responsible person and state any handling or retention restrictions before a real trial.",
      "A pilot may use existing staff time, but that time is a cost even when no subscription is purchased. Record actual effort and any provider charges rather than describing the entire workflow as free.",
      "No guaranteed savings or income is claimed. If the baseline cannot be measured or the sample is too small, report the result as inconclusive and retain the manual process.",
      "Any proposed price, target, duration or responsibility is provisional until the owner accepts it. A report cannot grant access, approve spending, certify compliance or authorize external contact.",
    ].join(" ");
    const report = {
      sections: fixture.headings.map(heading => ({ heading, blocks: [
        { type: "fact", text: fixture.fact, sourceIds: ["S1"] },
        { type: "recommendation", text: recommendation, sourceIds: [] as string[] },
        { type: "assumption", text: assumption, sourceIds: [] as string[] },
      ] })),
      unknowns: ["Internal workflow ownership and customer conversion baseline are unknown."],
    };
    const url = `https://${fixture.id}.example.test/`;
    const source = { id: "S1", text: fixture.fact, title: "Fictional public services page", url,
      kind: "public" as const, retrievedAt: "2026-11-26T00:00:00Z",
      sha256: createHash("sha256").update(fixture.fact).digest("hex") };
    const reportTitle = { readiness: "AI Readiness Report", executive: "Business Review",
      opportunities: "Revenue Opportunities" }[fixture.kind];
    return { ...fixture, report, source, title: `${reportTitle} for ${fixture.company}` };
  });
}

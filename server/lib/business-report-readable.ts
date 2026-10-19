import type { ReportSection } from "./business-report-evidence";
import type { PdfSection } from "../pdf-create";

export function businessReportReadingGuide(kind: "readiness" | "executive" | "opportunities"): string {
  const guides = {
    readiness: "Start with the executive summary and highest-priority readiness gaps. Assign an owner to each recommended website or discovery improvement, confirm the evidence and dependencies, then use the 90-day roadmap to schedule and measure the work. Validate vendor terms before purchasing.",
    executive: "Read the executive summary first, then compare the positioning, conversion, profitability and growth recommendations. Choose the highest-value practical action, assign an accountable owner and success measure, and use the 30/60/90-day plan to sequence implementation. Check assumptions against your actual business figures.",
    opportunities: "Compare the revenue opportunities by buyer need, effort, cost, risk and likely time to validate. Pick one small pilot before committing to a wider rollout, confirm pricing with real customers, and track results against the proposed success measures. Treat estimates as planning assumptions, not guaranteed income.",
  };
  return guides[kind];
}

/** Presentation-only projection: retain supporting quotations in an appendix. */
export function readableBusinessReportSections(sections: ReportSection[],
  kind?: "readiness" | "executive" | "opportunities"): PdfSection[] {
  const result: PdfSection[] = [], evidence: PdfSection[] = [];
  if (kind) {
    result.push({ title: "How to use this report", content: businessReportReadingGuide(kind) });
  }
  for (const section of sections) {
    if (/^Listen (?:to|by)/i.test(section.heading)) continue;
    let body = section.body.replace(/\*\*|__|`/g, "").replace(/^[ \t]+/gm, "");
    const markers = [...body.matchAll(/^(Source excerpt|Unverified supplied context|Customer-supplied context|Our recommendation|Planning assumption(?: \(not a forecast\))?):[ \t]*/gim)];
    if (markers.some(m => /^Source excerpt$/i.test(m[1]))) {
      const main = [body.slice(0, markers[0].index)];
      markers.forEach((m, i) => {
        const value = body.slice(m.index!, markers[i + 1]?.index ?? body.length).trim();
        if (/^Source excerpt$/i.test(m[1])) evidence.push({ title: section.heading, content: value });
        else main.push(value);
      });
      body = main.join("\n\n");
    }
    if (/^About This/.test(section.heading)) body = body.replace(/^Order:[^\n]*\n?/gm, "");
    const paragraphs = body.replace(/\*\*|`/g, "").split(/\n+/).map(p => p.trim()).filter(Boolean);
    if (!paragraphs.length) continue;
    result.push({ title: section.heading, highlight: paragraphs[0], paragraphs: paragraphs.slice(1) });
  }
  if (evidence.length) result.push({ title: "Supporting Source Quotations",
    content: "Retained evidence excerpts, separated from the recommendations for easier reading. Citation IDs refer to the source register.",
    subsections: evidence });
  return result;
}

/** Use exactly the same lossless presentation in the local PDF fallback. */
export function plainReadableBusinessReportSections(sections: ReportSection[],
  kind: "readiness" | "executive" | "opportunities"): ReportSection[] {
  return readableBusinessReportSections(sections, kind).map(section => ({
    heading: section.title,
    body: [
      section.content, section.highlight, ...(section.paragraphs ?? []), ...(section.bullets ?? []),
      ...(section.subsections ?? []).flatMap(sub => [
        sub.title, sub.content, ...(sub.paragraphs ?? []), ...(sub.bullets ?? []),
      ]),
    ].filter(Boolean).join("\n\n"),
  }));
}

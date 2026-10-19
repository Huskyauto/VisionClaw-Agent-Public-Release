import type { ReportSection } from "./business-report-evidence";

const WRITTEN_ONLY = /^(?:(?:Appendix(?:\s+[A-Z])?\s*[:—–-]\s*)?(?:Supporting Source Quotations|Source(?:s|\s+(?:Register|Excerpts?|Quotations?))?(?:\s|$)|Evidence (?:register|documentation)|Research (?:Approach|Register))|About This (?:Audit|Report)|Report Review Record|Listen (?:to|by)|Audio (?:guide|index))/i;
const LABEL = /^(Source excerpt|Unverified supplied context|Customer-supplied context|Our recommendation|Planning assumption(?: \(not a forecast\))?):[ \t]*/gim;

/** A separate spoken projection; written evidence and quotations remain intact. */
export function cleanReportNarration(body: string): string {
  // Normalize formatting BEFORE matching labels so bold or indented evidence
  // blocks cannot accidentally become spoken report content.
  body = body.replace(/\*\*|__|`/g, "").replace(/^[ \t]+/gm, "");
  const markers = [...body.matchAll(LABEL)];
  if (markers.length) {
    const pieces = [body.slice(0, markers[0].index)];
    markers.forEach((m, i) => {
      if (!/^(Our recommendation|Planning assumption)/i.test(m[1])) return;
      const text = body.slice(m.index! + m[0].length, markers[i + 1]?.index ?? body.length);
      pieces.push(/^Planning assumption/i.test(m[1])
        ? `Planning assumption, not a forecast. ${text}` : text);
    });
    body = pieces.join("\n\n");
  }
  return body
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/\[(?:\s*[SW]\d+\s*(?:[,;–-]\s*)?)+\]/gi, "")
    .replace(/\((?:\s*[SW]\d+\s*(?:[,;–-]\s*)?)+\)/gi, "")
    .replace(/\b[SW]\d+\b/gi, "")
    .replace(/^\s*(?:Source IDs|Citations|References):[^\n]*$/gim, "")
    .replace(/\s*\|\s*/g, ". ")
    .replace(/\b(?:in|see|per|from)\s+(?=[,.;)]|$)/gi, "")
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^[ \t]*#{1,6}\s+|^[ \t]*[-*•]\s+/gm, "")
    .replace(/\bObserved in (?:reviewed public sources|retained snapshot):\s*/gi, "")
    .replace(/[ \t]+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function buildReportSectionNarrations(title: string, sections: ReportSection[]) {
  if (!title.trim() || !sections.length || sections.some(s => !s.heading.trim() || !s.body.trim()))
    throw new Error("Complete report sections are required for narration");
  const tracks = sections.flatMap((s, index) => {
    const heading = s.heading.replace(/\*\*|__|`/g, "").trim();
    if (WRITTEN_ONLY.test(heading) || /^Limits, Assumptions & Validation Needed$/i.test(heading)) return [];
    const body = cleanReportNarration(s.body);
    return body ? [{ index, heading: s.heading, transcript: `${title}\n\n${s.heading}\n\n${body}` }] : [];
  });
  if (!tracks.length) throw new Error("No substantive report narration remains");
  return tracks;
}

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { logSilentCatch } from "./silent-catch";
import type { PackageKind } from "./company-report-package-core";
import type { ReportSection, ReportEvidence } from "./business-report-evidence";
export const PACKAGE_REPORT_NAMES = {
  readiness: "AI Readiness Website Review",
  executive: "Executive Opportunity Report",
  opportunities: "Business Income Opportunities",
};
function forecastFreeExcerpt(section: ReportSection) {
      const sentences = section.body.split(/\n+/).filter(s => !/^Planning assumption|^Assumption|^Unverified supplied|^Customer-supplied/i.test(s.trim()) &&
        !/[$€£]|\b(?:USD|revenue of|profit of|\d+% (?:growth|increase))\b/i.test(s));
      const recommendations = sentences.filter(s => /^Our recommendation:/i.test(s.trim()));
      const text = (recommendations.length ? recommendations : sentences).join(" ")
        .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
        .replace(/\bOur recommendation:\s*/gi, "").replace(/^[-•]\s*(?:Overall\s+)?Verdict:\s*/i, "")
        .replace(/\s+/g, " ").trim();
      if (!text) return null;
      // Complete sentences where available; the shortened excerpt is labelled.
      const words = text.split(/\s+/);
      return { heading: section.heading, text: words.slice(0, 60).join(" ") + (words.length > 60 ? " …" : "") };
}
/** Extract only approved narrative, excluding forecasts/internal review appendices.
 * No new model call, new research or invented score/claim is introduced here. */
export function teaserSelections(kind: PackageKind, sections: ReportSection[]) {
  const preferred = kind === "readiness" ? /website|discover|readiness|roadmap/i
    : kind === "executive" ? /strength|finding|sales|growth/i : /quick.win|creative|ancillary|pricing/i;
  const selected = sections.filter(s => preferred.test(s.heading));
  const rows = (selected.length ? selected : sections.filter(s => /summary/i.test(s.heading)))
    .slice(0, 3).map(forecastFreeExcerpt)
    .filter((r): r is { heading: string; text: string } => !!r);
  if (!rows.length) throw new Error("No forecast-free approved content is available for teaser extraction");
  return rows;
}
export function structuredTeaserSelections(kind: PackageKind, sections: ReportSection[]) {
  const used = new Set<ReportSection>();
  const excerpt = (pattern: RegExp, maxWords: number) => {
    const matches = sections.filter(section => !used.has(section) && pattern.test(section.heading));
    for (const section of matches) {
      try {
        const text = forecastFreeExcerpt(section)?.text;
        if (text) {
          used.add(section);
          const words = text.split(/\s+/);
          return words.slice(0, maxWords).join(" ") + (words.length > maxWords ? " …" : "");
        }
      } catch (error) { logSilentCatch("company-report-teasers:no-safe-excerpt", error, "expected"); }
    }
    return null;
  };
  const rows: Array<{ heading: string; text: string }> = [];
  const add = (heading: string, pattern: RegExp, words: number) => {
    const text = excerpt(pattern, words); if (text) rows.push({ heading, text });
  };
  if (kind === "executive") {
    add("Business snapshot (approved report excerpt)", /executive summary|snapshot/i, 38);
    add("What's working", /strength/i, 38);
    add("Website & sales improvement priorities", /website|conversion|sales/i, 38);
    add("Profitability & growth priorities", /profitab|growth/i, 38);
    add("Opportunities to explore", /opportun|creative|customer|product/i, 38);
  } else if (kind === "opportunities") {
    add("Quick win (30 days)", /quick.win|30.day/i, 45);
    add("Add-on income stream", /creative|ancillary|add.on|income.stream/i, 45);
    add("Pricing / partnership lever", /pricing|partnership/i, 45);
    add("First practical step", /\b(?:priorit\w*|action|pilot|roadmap)\b/i, 40);
  } else {
    add("AI discoverability", /discover|search|llms|geo/i, 45);
    add("Website / agent readiness", /website|agent|readiness/i, 45);
    add("Your first improvement priorities", /\b(?:roadmap|priorit\w*|action|quick)\b/i, 45);
  }
  return rows.length ? rows : teaserSelections(kind, sections);
}
export async function createPackageTeaser(input: {
  kind: PackageKind; company: string; principalName?: string;
  sections: ReportSection[]; coverage: string; capturedAt: string; evidence?: ReportEvidence;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  let y = 746;
  const safe = (v: string) => v.replace(/[^\x20-\x7e]/g, c => c === "…" ? "..." : c === "—" || c === "–" ? "-" : " ");
  const draw = (value: string, size = 10, strong = false) => {
    const font = strong ? bold : regular;
    const words = safe(value).replace(/\s+/g, " ").split(" ");
    let line = "";
    for (const word of words) {
      // URLs/headings are bounded too; never silently print beyond the margin.
      for (const part of word.match(/.{1,68}/g) || [""]) {
        const candidate = line ? `${line} ${part}` : part;
        if (font.widthOfTextAtSize(candidate, size) <= 512) { line = candidate; continue; }
        if (y < 160) throw new Error("Teaser exceeds its single-page layout budget");
        page.drawText(line, { x: 50, y, size, font, color: rgb(.12, .17, .24) });
        y -= size + 4; line = part;
      }
    }
    if (line) {
      if (y < 160) throw new Error("Teaser exceeds its single-page layout budget");
      page.drawText(line, { x: 50, y, size, font, color: rgb(.12, .17, .24) });
      y -= size + 4;
    }
    y -= 7;
  };
  draw("VISIONCLAW | [Your Company]", 11, true);
  draw(`${PACKAGE_REPORT_NAMES[input.kind]} - Free Preview`, 17, true);
  draw(input.company, 13, true);
  draw(`Prepared for ${input.principalName || "the business owner"} | ${input.capturedAt.slice(0, 10)}`, 9);
  if (input.kind === "readiness") {
    const measurement = input.evidence?.sources.find(source => source.kind === "measurement" &&
      source.title === "Measured website technical checks");
    const score = measurement?.text.match(/^AI readiness score: (\d{1,3})\/100; grade: ([A-F][+-]?)/);
    if (score && Number(score[1]) <= 100) draw(`Measured AI-readiness score: ${score[1]}/100 | Grade ${score[2]}`, 12, true);
  }
  draw("Selected excerpts from your complete researched report", 10, true);
  for (const row of structuredTeaserSelections(input.kind, input.sections)) {
    draw(row.heading, 11, true); draw(row.text);
  }
  draw("In the full three-report package", 11, true);
  draw("Detailed website/AI readiness analysis, business and customer-service improvements, income opportunities, implementation priorities, evidence, assumptions and a practical action plan.");
  draw(`Research coverage: ${input.coverage}`, 9);
  page.drawRectangle({ x: 40, y: 50, width: 532, height: 100, color: rgb(.94, .96, .99) });
  const footer = [
    "Want all three complete reports? $497 total. Reply to request the full package.",
    "Robert Washburn | VisionClaw | [Your Company] | agenticcorporation.net",
    "huskyauto@gmail.com | [YOUR-PHONE]",
    "16675 W Orchard Valley Dr., [Your City, ST] 60031",
    "Independent public-source advisory preview. No forecast or guaranteed outcome.",
  ];
  footer.forEach((line, i) => page.drawText(line, { x: 50, y: 132 - i * 16,
    size: i === 0 ? 10 : 8.5, font: i === 0 ? bold : regular, color: rgb(.12, .17, .24) }));
  return doc.save();
}
export async function combinePackageTeasers(pdfs: Uint8Array[]) {
  if (pdfs.length !== 3) throw new Error("Three teasers required");
  const combined = await PDFDocument.create();
  for (const bytes of pdfs) {
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() !== 1) throw new Error("Each teaser must be exactly one page");
    const [page] = await combined.copyPages(source, [0]); combined.addPage(page);
  }
  return combined.save();
}

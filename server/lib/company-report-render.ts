import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ReportSection } from "./business-report-evidence";

const printable = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/→/g, " -> ").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/•/g, "-")
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
/** Keep words intact; only a token wider than the entire column may be split. */
export function wrapCompanyReportText(text: string, font: PDFFont, size: number, width = 516): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of word) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line); line = "";
      }
      line += char;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
/** Deterministic paginated renderer; no summarization or external render call. */
export async function renderCompanyReport(company: string, title: string, sections: ReportSection[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]), y = 714;
  const header = () => {
    page.drawRectangle({ x: 0, y: 740, width: 612, height: 52, color: rgb(.07, .12, .2) });
    page.drawText("VISIONCLAW | COMPANY INTELLIGENCE", { x: 48, y: 760, font: bold, size: 11, color: rgb(1, 1, 1) });
    page.drawText(printable(company).slice(0, 80), { x: 48, y: 32, font: regular, size: 8 });
    page.drawText(String(pdf.getPageCount()), { x: 548, y: 32, font: regular, size: 8 });
  };
  header();
  const next = () => { page = pdf.addPage([612, 792]); y = 714; header(); };
  const draw = (value: string, size = 10, heading = false) => {
    const font = heading ? bold : regular;
    for (const para of printable(value).split("\n")) {
      for (const line of wrapCompanyReportText(para, font, size)) {
        if (y < 60) next();
        page.drawText(line, { x: 48, y, font, size, color: rgb(.08, .12, .18) });
        y -= size * 1.45;
      }
      y -= 4;
    }
  };
  draw(`${company}\n${title}`, 22, true);
  draw("Independent public-source advisory report. Recommendations and planning estimates are not verified outcomes. Research limitations and source documentation follow.");
  for (const section of sections) {
    if (y < 140) next();
    y -= 12; draw(section.heading, 14, true); draw(section.body);
  }
  pdf.setTitle(`${company} - ${title}`); pdf.setAuthor("VisionClaw");
  return Buffer.from(await pdf.save());
}

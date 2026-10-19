import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, StandardFonts, rgb } from "pdf-lib";
import { assertReportAudioUrl } from "./business-report-audio";

export type ReportSectionTrack = { heading: string; viewUrl: string; transcriptSha256: string };
const MARKER = "visionclaw-report-section-audio-v2";
const norm = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

async function withoutOldCover(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getKeywords()?.includes("visionclaw-report-audio-v1")) pdf.removePage(0);
  if (pdf.getKeywords()?.includes(MARKER)) throw new Error("Section-linked PDF is already finalized; recover its original bytes");
  return pdf;
}

/** Resolve every section before any synthesis; never guess page numbers. */
export async function locateReportSections(bytes: Uint8Array, headings: string[]) {
  const pdf = await withoutOldCover(bytes);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: await pdf.save(), useSystemFonts: true, isEvalSupported: false });
  const document = await task.promise;
  const locations = new Map<string, { page: number; y: number }>();
  try {
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const lines: Array<{ text: string; y: number; size: number }> = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = item.transform[5], size = Math.abs(item.transform[3]);
        const line = lines.find(line => Math.abs(line.y - y) < 2);
        if (line) { line.text += " " + item.str; line.size = Math.max(line.size, size); }
        else lines.push({ text: item.str, y, size });
      }
      for (const heading of headings) {
        if (locations.has(heading)) continue;
        const target = norm(heading);
        const index = lines.findIndex((line, j) => line.size >= 8 &&
          (norm(line.text) === target || norm(line.text + (lines[j + 1]?.text ?? "")) === target));
        if (index >= 0) locations.set(heading, { page: i - 1, y: lines[index].y });
      }
    }
  } finally { await document.destroy(); }
  const missing = headings.filter(h => !locations.has(h));
  if (missing.length) throw new Error(`Cannot locate report section headings: ${missing.join("; ")}`);
  return locations;
}

export async function addReportSectionAudioLinks(bytes: Uint8Array, tracks: ReportSectionTrack[]) {
  if (!tracks.length || tracks.length > 60 || new Set(tracks.map(t => t.heading)).size !== tracks.length)
    throw new Error("Unique report section recordings required");
  tracks.forEach(track => assertReportAudioUrl(track.viewUrl));
  const locations = await locateReportSections(bytes, tracks.map(t => t.heading));
  const pdf = await withoutOldCover(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const link = (page: ReturnType<typeof pdf.getPage>, rect: number[], url: string, heading: string) => {
    const annotation = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0],
      ReportSectionAudioHeading: PDFString.of(heading),
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    page.node.addAnnot(pdf.context.register(annotation));
  };
  for (const track of tracks) {
    const location = locations.get(track.heading)!;
    const page = pdf.getPage(location.page), x = page.getWidth() - 42, y = location.y;
    page.drawRectangle({ x: x - 3, y: y - 3, width: 35, height: 14, color: rgb(.91, .95, 1) });
    page.drawText("MP3", { x, y, size: 8, font: bold, color: rgb(.03, .27, .7) });
    link(page, [x - 3, y - 3, x + 32, y + 11], track.viewUrl, track.heading);
  }
  for (let offset = 0, n = 0; offset < tracks.length; offset += 22, n++) {
    const page = pdf.insertPage(n, [612, 792]);
    page.drawText("Listen by section", { x: 48, y: 738, size: 23, font: bold });
    ["American English narration. Each section has its own MP3.",
      "Report information only; written source excerpts and citations are not narrated.",
      "Use this index or the blue MP3 button beside each section heading.",
      "Audio links are accessible to anyone holding them; keep them within your audience."]
      .forEach((line, i) => page.drawText(line, { x: 48, y: 708 - i * 16, size: 9, font }));
    tracks.slice(offset, offset + 22).forEach((track, j) => {
      const y = 620 - j * 24;
      const text = `${offset + j + 1}. ${track.heading}`.replace(/[^\x20-\x7e]/g, "-");
      let size = 11;
      while (font.widthOfTextAtSize(text, size) > 510 && size > 7) size -= .5;
      page.drawText(text, { x: 48, y, size, font, color: rgb(.03, .27, .7) });
      link(page, [46, y - 4, 562, y + 13], track.viewUrl, track.heading);
    });
  }
  pdf.setKeywords([...(pdf.getKeywords()?.split(",").filter(k => !k.includes("visionclaw-report-audio-v1")) ?? []), MARKER]);
  return pdf.save();
}

export const SECTION_AUDIO_MARKER = MARKER;

export async function reportSectionAudioLinksFromPdf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!pdf.getKeywords()?.includes(MARKER)) return [];
  const tracks = new Map<string, { heading: string; viewUrl: string }>();
  for (const page of pdf.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const item = annotations.lookup(i, PDFDict);
      const heading = item.lookupMaybe(PDFName.of("ReportSectionAudioHeading"), PDFString)?.decodeText();
      if (!heading) continue;
      const url = item.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText();
      assertReportAudioUrl(url);
      if (tracks.has(heading) && tracks.get(heading)!.viewUrl !== url) throw new Error("Conflicting section audio identities");
      tracks.set(heading, { heading, viewUrl: url });
    }
  }
  return [...tracks.values()];
}

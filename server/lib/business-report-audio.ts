import { createHash } from "node:crypto";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import type { ReportSection } from "./business-report-evidence";
import { buildReportSectionNarrations } from "./business-report-narration";

export const REPORT_AUDIO_VOICE = "cjVigY5qzO86Huf0OWal";
export const REPORT_AUDIO_MODEL = "eleven_flash_v2_5";
export const REPORT_AUDIO_VERSION = 2;
// Match the complete report contract; quota admission remains independently
// checked and reserved against included ElevenLabs characters before synthesis.
export const REPORT_AUDIO_MAX_CHARACTERS = 180_000;
export const REPORT_AUDIO_MAX_BYTES = 192 * 1024 * 1024;
const DRIVE_VIEW = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view$/;
const AUDIO_MARKER = "visionclaw-report-audio-v1";
export type ReportAudioScope = { tenantId: number; kind: "readiness" | "executive"; orderId: string };

export function buildReportNarration(title: string, sections: ReportSection[]): string {
  return buildReportSectionNarrations(title, sections).map(track => track.transcript).join("\n\n");
}

/** Lossless splitting: every input character survives, including boundaries. */
export function splitReportNarration(text: string): string[] {
  if (!text.trim() || text.length > REPORT_AUDIO_MAX_CHARACTERS) throw new Error("Report narration exceeds its full-text limit");
  const result: string[] = [];
  while (text.length) {
    let end = Math.min(6000, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end - 1);
      if (boundary > end / 2) end = boundary + 1;
      // Never divide a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (result.length > 60) throw new Error("Report narration chunk limit exceeded; never truncate");
  return result;
}

export function reportAudioIdentity(scope: ReportAudioScope, transcript: string): string {
  if (!Number.isSafeInteger(scope.tenantId) || scope.tenantId < 1 || !scope.orderId ||
      !["readiness", "executive"].includes(scope.kind)) throw new Error("Report audio scope required");
  return createHash("sha256").update(JSON.stringify({
    tenantId: scope.tenantId, kind: scope.kind, orderId: scope.orderId,
    transcript, provider: "elevenlabs", model: REPORT_AUDIO_MODEL,
    voice: REPORT_AUDIO_VOICE, version: REPORT_AUDIO_VERSION,
  })).digest("hex");
}

export function assertReportAudioUrl(url: unknown): asserts url is string {
  if (typeof url !== "string" || !DRIVE_VIEW.test(url)) throw new Error("Verified Google Drive MP3 view link required");
}

export async function addReportAudioLinkPage(pdfBytes: Uint8Array, viewUrl: string): Promise<Uint8Array> {
  assertReportAudioUrl(viewUrl);
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  if (!pdf.getPageCount()) throw new Error("Report PDF has no pages");
  const page = pdf.insertPage(0, [612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Listen to this report", { x: 48, y: 694, size: 24, font: bold, color: rgb(.08, .12, .25) });
  const lines = [
    "Your full report is also available as an MP3 audio recording.",
    "American English narration by Eric.",
    "Report findings, recommendations, action plan and limitations.",
    "Written source quotations and citation codes are not read aloud.",
    "",
    "Open the MP3 on Google Drive",
    "",
    "Tap the blue link above to listen or download the MP3.",
    "If Drive is still processing playback, download the file to listen.",
    "Anyone holding this listening link can access the audio.",
    "Keep the link private if your report contains confidential information.",
    "",
    "The written report follows on the next page.",
  ];
  const listenIndex = lines.indexOf("Open the MP3 on Google Drive");
  const listenY = 645 - listenIndex * 23;
  lines.forEach((line, i) => page.drawText(line, {
    x: 48, y: 645 - i * 23, size: 11, font: i === listenIndex ? bold : regular,
    color: i === listenIndex ? rgb(.03, .27, .7) : rgb(.18, .2, .25),
  }));
  const annotation = pdf.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [46, listenY - 4, 350, listenY + 16], Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(viewUrl) },
  });
  page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annotation)]));
  // The full URL is selectable/copyable as well as clickable.
  page.drawText(viewUrl, { x: 48, y: 330, size: 8, font: regular, maxWidth: 516 });
  pdf.setKeywords([...(pdf.getKeywords()?.split(",") ?? []), AUDIO_MARKER]);
  return pdf.save();
}

export async function reportAudioLinkFromPdf(bytes: Uint8Array): Promise<string | null> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if ((!pdf.getKeywords()?.includes(AUDIO_MARKER) &&
      !pdf.getKeywords()?.includes("visionclaw-report-section-audio-v2")) || !pdf.getPageCount()) return null;
  const { PDFArray, PDFDict } = await import("pdf-lib");
  const annotations = pdf.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  if (!annotations) return null;
  for (let i = 0; i < annotations.size(); i++) {
    const action = annotations.lookup(i, PDFDict).lookup(PDFName.of("A"), PDFDict);
    const url = action?.lookup(PDFName.of("URI"), PDFString)?.decodeText();
    if (url && DRIVE_VIEW.test(url)) return url;
  }
  return null;
}

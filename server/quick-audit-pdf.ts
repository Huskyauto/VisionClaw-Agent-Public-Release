import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AgentJourneyResult } from "../shared/agent-journey";

export interface QuickAuditPdfInput {
  websiteUrl: string;
  finalUrl: string;
  overallScore: number;
  grade: string;
  fetchedAt: string;
  checks: Array<{
    id: string;
    label: string;
    category: string;
    status: "pass" | "warn" | "fail";
    score: number;
    maxScore: number;
    detail: string;
    recommendation?: string;
  }>;
  recommendations: string[];
  agentJourney?: AgentJourneyResult;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrap(text: string, font: PDFFont, size: number, width = CONTENT_WIDTH): string[] {
  const safeText = text.replace(/[^\x20-\x7E]/g, "?");
  const words = safeText.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const chunks: string[] = [];
    let chunk = "";
    for (const char of word) {
      if (chunk && font.widthOfTextAtSize(chunk + char, size) > width) {
        chunks.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    if (chunk) chunks.push(chunk);
    for (const part of chunks) {
      const next = line ? `${line} ${part}` : part;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = part;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function createQuickAuditPdf(input: QuickAuditPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage;
  let y = 0;

  const addPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText("VisionClaw Quick Website Audit", {
      x: MARGIN, y, size: 10, font: bold, color: rgb(0.18, 0.45, 0.85),
    });
    y -= 25;
  };
  const ensure = (height: number) => { if (y - height < MARGIN) addPage(); };
  const text = (value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    const indent = opts.indent ?? 0;
    const lines = wrap(value, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensure(size + 7);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: opts.color ?? rgb(0.15, 0.15, 0.18) });
      y -= size + 3;
    }
    y -= 4;
  };

  addPage();
  text("AI Readiness Snapshot", { size: 22, font: bold });
  text(input.finalUrl || input.websiteUrl, { size: 11, color: rgb(0.35, 0.35, 0.4) });
  text(`Score: ${input.overallScore}/100    Grade: ${input.grade}`, { size: 18, font: bold });
  text(`Audited: ${new Date(input.fetchedAt).toLocaleString("en-US")}`, { size: 9, color: rgb(0.45, 0.45, 0.5) });
  y -= 8;

  text("Audit checks", { size: 15, font: bold });
  for (const check of input.checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "NEEDS WORK" : "MISSING";
    text(`${marker}  ${check.label} — ${check.score}/${check.maxScore}`, { size: 11, font: bold });
    text(check.detail, { indent: 12 });
    if (check.recommendation) text(`Recommended fix: ${check.recommendation}`, { indent: 12, color: rgb(0.35, 0.25, 0.05) });
    y -= 3;
  }

  if (input.recommendations.length) {
    ensure(50);
    text("Top improvements", { size: 15, font: bold });
    input.recommendations.forEach((item, index) => text(`${index + 1}. ${item}`, { indent: 8 }));
  }

  if (input.agentJourney) {
    ensure(70);
    text("Agent customer journey - read-only evidence pilot", { size: 15, font: bold });
    text("Five unscored checks. The existing 100-point technical score is unchanged. This is not a live assistant or booking completion test.", { size: 9 });
    for (const check of input.agentJourney.checks) {
      ensure(55);
      const status = check.status === "observed" ? "FOUND" : check.status === "uncertain" ? "UNCERTAIN" : "NOT FOUND IN SAMPLE";
      text(`${status}: ${check.label}`, { size: 11, font: bold });
      text(check.finding, { indent: 8 });
      for (const evidence of check.evidence) {
        text(`Evidence: ${evidence.excerpt}`, { indent: 12 });
        text(`Source: ${evidence.url}`, { size: 8, indent: 12 });
      }
      text(`Next step: ${check.nextStep}`, { indent: 8 });
    }
    text("Pages assessed", { size: 11, font: bold });
    input.agentJourney.pages.forEach(url => text(url, { size: 9 }));
    text("Coverage and safety limits", { size: 11, font: bold });
    input.agentJourney.limitations.forEach(limit => text(limit, { size: 9 }));
  }

  ensure(55);
  y -= 8;
  text("About this report", { size: 12, font: bold });
  text("This quick report summarizes an automated website scan. The comprehensive audit includes deeper analysis, business-specific recommendations, and a 90-day roadmap.", { size: 9 });

  doc.setTitle(`Quick Website Audit — ${input.finalUrl || input.websiteUrl}`);
  doc.setAuthor("VisionClaw");
  doc.setCreationDate(new Date());
  return doc.save();
}
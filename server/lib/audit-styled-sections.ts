/**
 * Pure (query-free, LLM-free) helpers for the premium styled AI Readiness
 * Audit PDF. Lives in server/lib so tests can import it without pulling in
 * the db/provider import chains of audit-fulfillment.ts.
 */
import type { PdfSection } from "../pdf-create";

/**
 * Deterministic prose → styled-section converter. The generation prompt asks
 * for short paragraphs and '-' bullet lists; this parses that shape into the
 * premium PDF's paragraphs/bullets structure. No LLM call, no parse-failure
 * risk — anything unrecognized stays a paragraph.
 */
export function bodyToStyledSection(heading: string, body: string): PdfSection {
  type Sub = { title: string; paragraphs: string[]; bullets: string[] };
  const top: Sub = { title: "", paragraphs: [], bullets: [] };
  const subs: Sub[] = [];
  let current: Sub = top;
  let para: string[] = [];
  const flush = () => {
    if (para.length) { current.paragraphs.push(para.join(" ")); para = []; }
  };
  for (const raw of String(body || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const bullet = line.match(/^(?:[-*•]|\d{1,2}[.)])\s+(.+)$/);
    if (bullet) { flush(); current.bullets.push(bullet[1].replace(/\*\*/g, "")); continue; }
    const clean = line.replace(/\*\*/g, "").replace(/^#+\s*/, "");
    // Short "Header:" lines (e.g. "Weeks 1-2:", "Month 1:") become subsection
    // titles so grouped bullets keep their grouping in the styled PDF.
    if (/^[^.!?]{1,60}:$/.test(clean)) {
      flush();
      current = { title: clean.replace(/:$/, ""), paragraphs: [], bullets: [] };
      subs.push(current);
      continue;
    }
    para.push(clean);
  }
  flush();
  const section: PdfSection = { title: heading };
  // Lead paragraph becomes the cyan highlight box for summary-type sections.
  if (/summary/i.test(heading) && top.paragraphs.length > 1) {
    section.highlight = top.paragraphs.shift();
  }
  if (top.paragraphs.length) section.paragraphs = top.paragraphs;
  if (top.bullets.length) section.bullets = top.bullets;
  if (subs.length) {
    section.subsections = subs.map((s) => ({
      title: s.title,
      paragraphs: s.paragraphs.length ? s.paragraphs : undefined,
      bullets: s.bullets.length ? s.bullets : undefined,
    }));
  }
  if (!section.paragraphs && !section.bullets && !section.highlight && !section.subsections) {
    section.content = String(body || "").trim();
  }
  return section;
}

/**
 * Pure parser for the scorecard model output. Returns cleaned rows ONLY when
 * the 6-8-row contract is met — anything else (fewer valid rows, malformed
 * JSON, wrong shapes) returns null so the table is omitted rather than
 * shipping an undersized scorecard.
 */
export function parseScorecardRows(text: string): string[][] | null {
  const jsonText = String(text || "").replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = jsonText.indexOf("[");
  const end = jsonText.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let rows: any;
  try { rows = JSON.parse(jsonText.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const clean = rows
    .filter((r: any) => r && typeof r === "object" && r.area && r.finding && r.action)
    .slice(0, 8)
    .map((r: any) => [String(r.area).slice(0, 60), String(r.finding).slice(0, 160), String(r.action).slice(0, 160), ["High", "Medium", "Low"].includes(String(r.priority)) ? String(r.priority) : "Medium"]);
  if (clean.length < 6) return null;
  return clean;
}

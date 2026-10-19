import { hashReportBytes } from "./business-report-evidence";

/** Layout only: no inference, text clipping, changed facts or relaxed limits.
 * An oversized executive overview may move its whole non-heading bullets into
 * a second block, keeping all section-coverage bullets together in the first.
 * Everything else remains unchanged and must pass the authoritative validators.
 */
export function normalizeReportBlockLayout(candidate: any): {
  candidate: any;
  receipt?: { version: "report-block-layout-v1"; originalBlockSha256: string; blockSha256s: string[] };
} {
  const sections = candidate?.report?.sections;
  if (!Array.isArray(sections)) return { candidate };
  const index = sections.findIndex(section => /^executive summary$/i.test(section?.heading || ""));
  const section = sections[index], block = section?.blocks?.[0];
  if (!block || block.type !== "recommendation" || typeof block.text !== "string" ||
      block.text.length <= 3000 || !Array.isArray(section.blocks) || section.blocks.length >= 24) return { candidate };
  const headings = sections.filter((_, i) => i !== index).map(section => section?.heading);
  if (!headings.length || headings.some(heading => typeof heading !== "string" || !heading.length)) return { candidate };
  const lines: string[] = block.text.split("\n");
  if (!lines.every(line => /^\s*[-•]\s+\S/.test(line))) return { candidate };
  const isCoverage = (line: string) => headings.some(heading => line.includes(heading));
  const coverage = lines.filter(isCoverage).join("\n");
  const other = lines.filter(line => !isCoverage(line)).join("\n");
  if (!headings.every(heading => coverage.includes(heading)) ||
      [coverage, other].some(text => text.length < 10 || text.length > 3000)) return { candidate };
  const normalized = structuredClone(candidate);
  normalized.report.sections[index].blocks.splice(0, 1,
    { ...block, text: coverage }, { ...block, text: other });
  if (JSON.stringify(normalized).length > 180000) return { candidate };
  return { candidate: normalized, receipt: { version: "report-block-layout-v1",
    originalBlockSha256: hashReportBytes(block.text),
    blockSha256s: [hashReportBytes(coverage), hashReportBytes(other)] } };
}

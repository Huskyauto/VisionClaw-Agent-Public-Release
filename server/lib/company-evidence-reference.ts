import { hashReportBytes, reportDigestForWire, type CompiledReport, type ReportEvidence } from "./business-report-evidence";
import { isDeepStrictEqual } from "node:util";

type Entry = { id: string; kind: "source" | "limitation"; sourceId: string; text: string };
export type CompilationCatalog = { id: string; entries: Entry[]; evidence: ReportEvidence };
export type CompilationIssue = { path: string; reason: string };
export type LimitationDerivation = { path: string; originalSourceId: string; limitationSourceId: string;
  reason: "exact_retained_research_limitation" };
export function compilationReferenceError(issues: CompilationIssue[]): Error {
  return Object.assign(new Error("Invalid block or unknown citation"), { validationIssues: issues.slice(0, 160) });
}

/** Deterministic, bounded excerpts; no model writes quotations or provenance.
 * IDs bind source identity, text and position, not just a mutable list index. */
export function buildCompilationCatalog(evidence: ReportEvidence): CompilationCatalog {
  const sources = evidence.sources.map(source => ({ ...source }));
  if (sources.some(source => source.sha256 !== hashReportBytes(source.text)) ||
      new Set(sources.map(s => s.id)).size !== sources.length)
    throw new Error("Retained report source hash mismatch");
  const entries: Entry[] = [];
  for (const source of sources) {
    // Fixed slices preserve every character and avoid expensive/unbounded NLP.
    for (let start = 0; start < source.text.length;) {
      let end = Math.min(source.text.length, start + 600);
      if (end < source.text.length) {
        const boundary = source.text.lastIndexOf(" ", end);
        if (boundary > start + 300) end = boundary;
      }
      const offset = start, text = source.text.slice(start, end).trim();
      start = end;
      if (text.trim().length < 10) continue;
      entries.push({ id: `E_${hashReportBytes(JSON.stringify([source.id, source.sha256, offset])).slice(0, 24)}`,
        kind: "source", sourceId: source.id, text });
    }
  }
  for (const [index, text] of evidence.limitations.entries()) {
    if (text.trim().length < 10 || text.length > 3000) continue;
    const sourceId = `L_${index + 1}`;
    if (sources.some(source => source.id === sourceId)) throw new Error("Reserved limitation source identity");
    sources.push({ id: sourceId, title: "Research scope limitation (not a company finding)",
      text, kind: "measurement", sha256: hashReportBytes(text), retrievedAt: evidence.capturedAt });
    entries.push({ id: `L_${hashReportBytes(JSON.stringify([index, text])).slice(0, 24)}`,
      kind: "limitation", sourceId, text });
  }
  if (entries.length > 320 || sources.length > 64) throw new Error("Compilation catalog exceeds its safe bound");
  return { id: reportDigestForWire(hashReportBytes(JSON.stringify({ version: 2,
    capturedAt: evidence.capturedAt, sources: sources.map(({ id, title, url, kind, sha256 }) =>
      ({ id, title, url, kind, sha256 })), entries }))), entries,
    evidence: { ...evidence, sources } };
}

/** Return all safely enumerable reference/shape faults before one corrective call.
 * Never include private prose or arbitrary provider fields in diagnostics. */
export function hydrateCompilationReferences(input: unknown, headings: string[], catalog: CompilationCatalog): CompiledReport {
  const report = input as any, issues: CompilationIssue[] = [];
  if (!report || report.formatVersion !== 2 || report.catalogId !== catalog.id ||
      !Array.isArray(report.sections) || report.sections.length !== headings.length ||
      !Array.isArray(report.unknowns) || report.unknowns.length > 30)
    throw compilationReferenceError([{ path: "$", reason: "invalid_format_catalog_or_sections" }]);
  const entries = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const sections = report.sections.map((section: any, si: number) => {
    const path = `sections[${si}]`;
    if (!section || !Array.isArray(section.blocks) || section.blocks.length < 3 || section.blocks.length > 24) {
      issues.push({ path, reason: "require_3_to_24_blocks" });
      return { heading: headings[si], blocks: [] };
    }
    const blocks = section.blocks.map((block: any, bi: number) => {
      const blockPath = `${path}.blocks[${bi}]`;
      if (block?.type === "fact" || block?.type === "limitation") {
        const entry = typeof block.evidenceRef === "string" ? entries.get(block.evidenceRef) : undefined;
        if (!entry || entry.kind !== (block.type === "fact" ? "source" : "limitation") ||
            Object.keys(block).some(key => !["type", "evidenceRef"].includes(key))) {
          issues.push({ path: blockPath, reason: "use_exact_catalog_reference_and_matching_type_only" });
          return { type: "fact" as const, text: "", sourceIds: [] };
        }
        return { type: "fact" as const, text: entry.text, sourceIds: [entry.sourceId] };
      }
      if (!block || !["recommendation", "assumption"].includes(block.type) ||
          typeof block.text !== "string" || block.text.trim().length < 10 || block.text.length > 3000 ||
          Object.keys(block).some(key => !["type", "text", "sourceIds"].includes(key)) ||
          !Array.isArray(block.sourceIds) || block.sourceIds.length > 30 ||
          block.sourceIds.some((id: unknown) => typeof id !== "string" || !catalog.evidence.sources.some(s => s.id === id))) {
        issues.push({ path: blockPath, reason: "invalid_advisory_text_or_source_list" });
        return { type: "recommendation" as const, text: "", sourceIds: [] };
      }
      return { type: block.type, text: block.text, sourceIds: [...block.sourceIds] };
    });
    return { heading: headings[si], blocks };
  });
  report.unknowns.forEach((value: unknown, index: number) => {
    if (typeof value !== "string" || !value.trim() || value.length > 1000)
      issues.push({ path: `unknowns[${index}]`, reason: "bounded_nonempty_unknown_required" });
  });
  if (issues.length) throw compilationReferenceError(issues);
  return { sections, unknowns: [...report.unknowns],
    ...(report.hypothesisPlans !== undefined ? { hypothesisPlans: report.hypothesisPlans } : {}),
    ...(report.hypothesisPlanWarning !== undefined ? { hypothesisPlanWarning: report.hypothesisPlanWarning } : {}) };
}

/** Lossless transport of an already validated report. The same catalog supplies
 * the exact words and source identity; no advisory text or unknown is removed.
 * Never use this to reinterpret an invalid provider response. */
export function compactCompilationReferences(report: CompiledReport, catalog: CompilationCatalog) {
  const transport = { formatVersion: 2, catalogId: catalog.id,
    sections: report.sections.map(section => ({ heading: section.heading,
      blocks: section.blocks.map(block => {
        if (block.type !== "fact") return { ...block, sourceIds: [...block.sourceIds] };
        const entry = catalog.entries.find(entry => block.sourceIds.length === 1 &&
          entry.sourceId === block.sourceIds[0] && entry.text === block.text);
        if (!entry) throw compilationReferenceError([{ path: "$", reason: "quotation_not_in_bound_catalog" }]);
        return { type: entry.kind === "source" ? "fact" : "limitation", evidenceRef: entry.id };
      }) })),
     unknowns: [...report.unknowns],
     ...(report.hypothesisPlans !== undefined ? { hypothesisPlans: report.hypothesisPlans } : {}),
     ...(report.hypothesisPlanWarning !== undefined ? { hypothesisPlanWarning: report.hypothesisPlanWarning } : {}) };
  const restored = hydrateCompilationReferences(transport, report.sections.map(s => s.heading), catalog);
  if (!isDeepStrictEqual(restored, report))
    throw compilationReferenceError([{ path: "$", reason: "lossless_reference_roundtrip_required" }]);
  return transport;
}

/** A NEW derived interpretation of an old receipt, not a change to that receipt.
 * Only an entire exact retained research limitation can change provenance.
 * Never borrow a quotation from another source, invent a citation, change text,
 * repair an unknown/missing source ID, or infer a limitation by similarity. */
export function deriveLegacyLimitationReferences(report: any, catalog: CompilationCatalog): LimitationDerivation[] {
  const derivations: LimitationDerivation[] = [];
  if (!Array.isArray(report?.sections) || report.sections.length > 6) return derivations;
  const sources = new Map(catalog.evidence.sources.map(source => [source.id, source]));
  report.sections.forEach((section: any, si: number) => {
    if (!Array.isArray(section?.blocks) || section.blocks.length > 24) return;
    section.blocks.forEach((block: any, bi: number) => {
      if (block?.type !== "fact" || typeof block.text !== "string" ||
          !Array.isArray(block.sourceIds) || block.sourceIds.length !== 1 ||
          !sources.has(block.sourceIds[0]) || sources.get(block.sourceIds[0])!.text.includes(block.text.trim())) return;
      const matches = catalog.entries.filter(entry => entry.kind === "limitation" && entry.text === block.text.trim());
      if (matches.length !== 1) return;
      derivations.push({ path: `sections[${si}].blocks[${bi}]`, originalSourceId: block.sourceIds[0],
        limitationSourceId: matches[0].sourceId, reason: "exact_retained_research_limitation" });
      block.sourceIds = [matches[0].sourceId];
    });
  });
  return derivations;
}

/** Offline comparison only. Nothing here may collect evidence or execute actions. */
export interface ReportSnapshot {
  id: string;
  kind: string;
  sections: Array<{ heading: string; blocks: Array<{
    type: string; text: string; sourceIds: string[];
  }> }>;
  sources: Array<{ id: string; sha256: string; url?: string }>;
  unknowns: string[];
  narration: string;
}
export interface ReportComparison { regressions: string[]; review: string[] }
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const numbers = (text: string) => text.match(/[-+]?\d[\d,.]*(?:%|\b)/g) ?? [];

export function compareReportSnapshots(before: ReportSnapshot, after: ReportSnapshot): ReportComparison {
  const regressions: string[] = [], review: string[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before.id !== after.id || before.kind !== after.kind) regressions.push("Report identity changed");
  if (!equal(before.sources, after.sources)) regressions.push("Source identities changed");
  if (!equal(before.sections.map(s => s.heading), after.sections.map(s => s.heading)))
    regressions.push("Required headings or section order changed");
  if (!equal(before.unknowns.map(compact), after.unknowns.map(compact)))
    regressions.push("Unknowns or limitations changed");
  before.sections.forEach((section, si) => {
    const candidate = after.sections[si];
    if (!candidate) return;
    if (section.blocks.length !== candidate.blocks.length)
      regressions.push(`Section ${si + 1}: content blocks added or removed`);
    section.blocks.forEach((block, bi) => {
      const next = candidate.blocks[bi];
      if (!next) return;
      const where = `Section ${si + 1}, block ${bi + 1}`;
      if (block.type !== next.type || !equal(block.sourceIds, next.sourceIds))
        regressions.push(`${where}: evidence type or citations changed`);
      if (!equal(numbers(block.text), numbers(next.text)))
        regressions.push(`${where}: numeric claims changed`);
      if (compact(block.text) !== compact(next.text)) {
        if (block.type === "fact") regressions.push(`${where}: source quotation changed`);
        else review.push(`${where}: advisory wording changed; check that the recommendation is preserved`);
      }
    });
  });
  if (!equal(numbers(before.narration), numbers(after.narration)))
    regressions.push("Narration numeric claims changed");
  if (compact(before.narration) !== compact(after.narration))
    review.push("Narration changed; review spoken advice");
  return { regressions, review };
}

/** Only pure production seams are used: no research, providers, storage,
 * narration purchase, render/upload, job dispatch or delivery adapters. */
export async function runReportRegressionGuard() {
  const [{ reportRegressionCases }, content, { compilationOperations }, { initialPackage },
    { validateCompiledReport }, { buildCompilationCatalog }, { buildReportNarration }] = await Promise.all([
    import("./report-regression-cases"),
    import("../../server/lib/company-compilation-content"),
    import("../../server/lib/company-compilation-matrix"),
    import("../../server/lib/company-report-package-core"),
    import("../../server/lib/business-report-evidence"),
    import("../../server/lib/company-evidence-reference"),
    import("../../server/lib/business-report-audio"),
  ]);
  const results: Array<{ id: string; contract: number; comparison: ReportComparison }> = [];
  for (const fixture of reportRegressionCases()) {
    for (const contract of [1, 2]) {
      const state = initialPackage({ company: fixture.company, website: fixture.source.url });
      state.research = { complete: true, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false },
        evidence: { version: 1, capturedAt: fixture.source.retrievedAt, sources: [fixture.source], limitations: [] } };
      const op = compilationOperations().find(item => item.kind === fixture.kind && item.stage === "synthesis")!;
      const catalog = buildCompilationCatalog(content.compilationEvidence(state.research.evidence));
      let response: unknown = fixture.report;
      if (contract === 2) {
        Object.assign(state, { compilation: { slots: { [op.key]: { outputContract: 2 } } } });
        const reference = catalog.entries.find(entry => entry.sourceId === fixture.source.id)!;
        response = { formatVersion: 2, catalogId: catalog.id, unknowns: fixture.report.unknowns,
          sections: fixture.report.sections.map(section => ({ blocks: section.blocks.map(block =>
            block.type === "fact" ? { type: "fact", evidenceRef: reference.id } : block) })) };
      }
      const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response) } }] };
      const retained = JSON.stringify({ state, raw });
      const accepted = JSON.parse(content.acceptCompilation(state, op, raw));
      const { sections } = validateCompiledReport(accepted, content.COMPANY_HEADINGS[fixture.kind],
        contract === 2 ? catalog.evidence : content.compilationEvidence(state.research.evidence), true, "compilation");
      const title = content.companyNarrationTitle(fixture.kind, fixture.company);
      const sources = [{ id: fixture.source.id, sha256: fixture.source.sha256, url: fixture.source.url }];
      const before: ReportSnapshot = { id: fixture.id, kind: fixture.kind, ...fixture.report, sources,
        narration: fixture.report.sections.map(section => [
          fixture.title, section.heading, section.blocks[1].text,
          `Planning assumption, not a forecast. ${section.blocks[2].text}`,
        ].join("\n\n")).join("\n\n") };
      const after: ReportSnapshot = { id: fixture.id, kind: fixture.kind,
        sections: accepted.sections, unknowns: accepted.unknowns,
        sources: (contract === 2 ? catalog.evidence : state.research.evidence).sources
          .filter(source => accepted.sections.some((section: ReportSnapshot["sections"][number]) =>
            section.blocks.some(block => block.sourceIds.includes(source.id))))
          .map(({ id, sha256, url }) => ({ id, sha256, url })),
        narration: buildReportNarration(title, sections) };
      const comparison = compareReportSnapshots(before, after);
      if (JSON.stringify({ state, raw }) !== retained) comparison.regressions.push("Retained input was mutated");
      results.push({ id: fixture.id, contract, comparison });
    }
  }
  return results;
}

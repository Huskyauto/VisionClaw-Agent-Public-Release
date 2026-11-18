import type { ReportEvidence } from "./business-report-evidence";

/** Citation identity must be unambiguous before any ID -> source map is built.
 * Does not authenticate a source or establish the truth of its contents. */
export function assertReportSourceIdentities(evidence: ReportEvidence): void {
  const ids = new Set<string>();
  for (const source of evidence.sources) {
    if (typeof source.id !== "string" || !source.id.trim() || source.id !== source.id.trim() || ids.has(source.id)) {
      throw new Error("Ambiguous report source identity");
    }
    ids.add(source.id);
  }
}

export const REPORT_EVIDENCE_WRITING_GUIDANCE = `EVIDENCE-FIRST WRITING:
Use writingPlan to plan each section before prose. It is a checklist of evidence needs, not a finding, relevance score or verification receipt.
Select only genuinely relevant sources; there is no citation-count quota. A real source or matching title does not establish claim support.
Preserve exact measured values, units, denominators, time periods and caveats in factual excerpts. Never fill missing results with plausible numbers.
Proposed economics and scenarios are explicitly conditional assumptions with formulas and validation steps, not observed outcomes.
Any empirical chart must derive from supplied measurements with source IDs, units and scope; conceptual illustrations are labeled illustrative, not experimental evidence. If the required data is absent, state that need rather than inventing a chart or result.
For revisions, preserve supported findings and material limitations. Resolve contradictions against evidence; disclose unresolved disagreements. A higher reviewer score or model consensus never overrides failed source checks or authorizes publication.`;

/** Deterministic preparation in existing calls: no retrieval, inference, state
 * mutation or new authority. Exact duplicates share a register row, not an ID.
 * Different origin/kind/content/capture/provenance always remains distinct. */
export function buildReportWritingPlan(headings: string[], evidence: ReportEvidence) {
  assertReportSourceIdentities(evidence);
  const groups = new Map<string, { sourceIds: string[]; kind: ReportEvidence["sources"][number]["kind"] }>();
  for (const source of evidence.sources) {
    const identity = JSON.stringify([source.kind, source.url ?? null, source.title,
      source.retrievedAt, source.sha256, source.text]);
    const entry = groups.get(identity);
    if (entry) entry.sourceIds.push(source.id);
    else groups.set(identity, { sourceIds: [source.id], kind: source.kind });
  }
  return {
    version: 1 as const,
    sections: headings.map(heading => {
      const evidenceNeeds = ["Identify the relevant retained source excerpts; keep unsupported conclusions in unknowns."];
      if (/cost|econom|revenue|pricing|profit/i.test(heading))
        evidenceNeeds.push("Separate observed amounts from proposed prices, costs and conditional scenarios; show assumptions and formulas.");
      if (/result|measur|experiment|pilot|success/i.test(heading))
        evidenceNeeds.push("Identify baseline, metric, units, denominator, period and method; disclose missing measurements.");
      if (/method|protocol|reproduc/i.test(heading))
        evidenceNeeds.push("Trace each result to a supplied reproducible protocol, configuration and data; distinguish performed work from proposed methods.");
      if (/figure|chart|plot|visual/i.test(heading))
        evidenceNeeds.push("Empirical charts require supplied numeric data, units and source IDs; label conceptual illustrations and omit unsupported measurements.");
      if (/system|operation|data|readiness/i.test(heading))
        evidenceNeeds.push("Distinguish public observations from unverified internal systems, staffing and customer-supplied statements.");
      if (/customer|compet|position|market/i.test(heading))
        evidenceNeeds.push("Require source support for customer sentiment or comparative claims; do not treat missing evidence as a negative finding.");
      return { heading, evidenceNeeds };
    }),
    sourceRegister: [...groups.values()],
    boundary: "Original source IDs and bytes remain unchanged. Grouping indicates identical captures, not independent corroboration. Source identity is not claim verification.",
  };
}

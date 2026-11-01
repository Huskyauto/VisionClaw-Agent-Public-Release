import { compactReportEvidence, hashReportBytes, reportDigestForWire,
  type EvidenceSource, type ReportEvidence } from "./business-report-evidence";
import type { BusinessReportReviewState } from "./business-report-review";

type WireSource = Omit<EvidenceSource, "text"> & { text?: string; textSameAsSourceId?: string };
export const REVIEW_REFERENCE_GUIDANCE = "LOSSLESS REFERENCES: A source with textSameAsSourceId has exactly the full text of that earlier source ID; its own ID, URL, date and checksum remain distinct. In jury findings, [correctionChecklist:ID] stands for the exact complete text of that correctionChecklist entry, not evidence that it was resolved. Read referenced text in full. These references never authorize delivery.";

/** Wire-only factoring. Original evidence, draft identity and paid receipts stay
 * untouched. References target earlier literal records, never reference chains. */
export function projectReviewEvidence(evidence: ReportEvidence): Omit<ReportEvidence, "sources"> & { sources: WireSource[] } {
  const compact = compactReportEvidence(evidence);
  const texts = new Map<string, string>(), ids = new Set<string>();
  return { ...compact, sources: compact.sources.map(source => {
    if (typeof source.id !== "string" || !source.id || ids.has(source.id))
      throw new Error("Ambiguous retained report source ID");
    ids.add(source.id);
    if (source.sha256 !== hashReportBytes(source.text)) throw new Error("Retained report source hash mismatch");
    const { text } = source;
    const metadata = { id: source.id, title: source.title, url: source.url,
      retrievedAt: source.retrievedAt, kind: source.kind };
    const prior = texts.get(text);
    if (prior !== undefined && text.length > 120)
      return { ...metadata, sha256: reportDigestForWire(source.sha256), textSameAsSourceId: prior };
    texts.set(text, source.id);
    return { ...metadata, sha256: reportDigestForWire(source.sha256), text };
  }) };
}

/** Replace only exact repeated correction bytes. Unknown prose, votes and
 * unchecklisted correction tails survive unchanged; malformed JSON is retained. */
export function projectJuryFindings(state: BusinessReportReviewState) {
  return state.juryHistory.map(history => {
    let parsed: any;
    try { parsed = JSON.parse(history.rationale); } catch { return { ...history }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.corrections !== "string")
      return { ...history };
    let corrections = parsed.corrections;
    for (const item of state.correctionChecklist || []) {
      if (typeof item.text !== "string" || item.text.length < 120 ||
          !/^C\d+-\d+-\d+$/.test(item.id) ||
          state.correctionChecklist!.filter(other => other.id === item.id).length !== 1) continue;
      corrections = corrections.split(item.text).join(`[correctionChecklist:${item.id}]`);
    }
    return { ...history, rationale: JSON.stringify({ ...parsed, corrections }) };
  });
}

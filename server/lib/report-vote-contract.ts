/** This normalization applies ONLY to retained business-report reviews.
 * The caller still verifies every citation against that seat's executed receipts. */
export const REPORT_VOTE_FORMAT = [
  "REPORT-SPECIFIC OUTPUT CONTRACT (replaces the generic output format):",
  'Return only JSON: {"verdict":"FIX|REJECT|ESCALATE","rationale":"specific report assessment","fixProposal":"specific report passages and corrections, or empty","citations":["exact owned snapshot receipt ID"],"unknowns":["explicit evidence limits and unresolved facts"]}.',
  "REJECT means no material defect found in this advisory report, NOT rejection of the customer or permission to deliver.",
  "FIX must explain changes to report content, not code files. Cite only your own executed report_snapshot_read receipt.",
  "ESCALATE means the evidence or response is missing, contradictory or insufficient. No verdict authorizes customer delivery.",
].join("\n");

export function parseReportVote(text: string, receipts: readonly {
  id: string; sha256?: string; ok?: boolean;
}[] = []): { text: string; citations: string[]; unknowns: string[] } {
  const trimmed = text.trim();
  // Normalize only a single, whole-answer Markdown wrapper. Never extract a
  // JSON fragment from prose or discard a suffix/second object. The same JSON
  // schema and owned-receipt checks apply after removing this transport wrapper.
  const wrapped = /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/.exec(trimmed);
  const candidate = wrapped ? wrapped[1] : trimmed;
  if (candidate.startsWith("{")) {
    try {
      const value = JSON.parse(candidate);
      // Some providers append the snapshot SHA to its exact receipt ID. This
      // spelling is equivalent only if BOTH match a successful owned receipt.
      // Never strip arbitrary suffixes, infer an ID, or discard invalid entries.
      if (Array.isArray(value.citations)) value.citations = value.citations.map((id: unknown) => {
        if (typeof id !== "string") return id;
        const match = /^([\w:-]{1,180}) \(sha256 ([a-f0-9]{64})\)$/i.exec(id);
        return match && receipts.some(receipt => receipt.ok === true &&
          receipt.id === match[1] && receipt.sha256 === match[2]) ? match[1] : id;
      });
      if (!["FIX", "REJECT", "ESCALATE"].includes(value.verdict) ||
          typeof value.rationale !== "string" || !value.rationale.trim() || value.rationale.length > 6000 ||
          (value.fixProposal !== undefined && (typeof value.fixProposal !== "string" || value.fixProposal.length > 10000)) ||
          !Array.isArray(value.citations) || !value.citations.length || value.citations.length > 8 ||
          value.citations.some((id: unknown) => typeof id !== "string" || !/^[\w:-]{1,180}$/.test(id)) ||
          !Array.isArray(value.unknowns) || !value.unknowns.length || value.unknowns.length > 12 ||
          value.unknowns.some((item: unknown) => typeof item !== "string" || !item.trim() || item.length > 2000)) {
        return { text: "", citations: [], unknowns: [] };
      }
      // The existing hardened parser still rejects multiple verdict lines.
      return { text: `VERDICT: ${value.verdict}\nRATIONALE: ${value.rationale}\nFIX_PROPOSAL: ${value.fixProposal || ""}`,
        citations: value.citations, unknowns: value.unknowns };
    } catch {
      return { text: "", citations: [], unknowns: [] };
    }
  }
  if (trimmed.includes("```")) return { text: "", citations: [], unknowns: [] };
  // Compatibility with retained provider answers: permit one inline label,
  // ending at a known channel label or newline. Never infer evidence from prose.
  const labels = [...text.matchAll(/\bCITATIONS:\s*([^\n]*?)(?=\s+(?:UNKNOWNS|FIX_PROPOSAL|RATIONALE|VERDICT):|$|\n)/gm)];
  const limits = text.match(/\bUNKNOWNS:[ \t]*([\s\S]*)$/)?.[1]
    ?.split(/\n(?:VERDICT|RATIONALE|FIX_PROPOSAL|CITATIONS):/)[0].trim();
  const unknowns = limits ? [limits.slice(0, 2000)] : [];
  if (labels.length !== 1) return { text, citations: [], unknowns };
  const citations = labels[0][1].replace(/[\[\]`]/g, "").trim().split(/[,\s]+/).filter(Boolean);
  if (!citations.length || citations.length > 8 || citations.some(id => !/^[\w:-]{1,180}$/.test(id))) {
    return { text, citations: [], unknowns };
  }
  return { text, citations, unknowns };
}

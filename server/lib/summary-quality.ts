/**
 * Summary / handoff quality audit + deterministic fallback (OpenClaw borrow,
 * R125+137.22).
 *
 * When an LLM compacts a conversation (cross-session handoff, compaction
 * summaries, dream consolidation digests), a silent quality failure loses
 * pending asks and literal identifiers. This module makes summary quality
 * AUDITABLE: `auditSummaryQuality` verifies required sections are present
 * and that literal identifiers from the source survived compaction;
 * `buildFallbackSummary` produces a deterministic structured fallback when
 * the audit fails, so the caller never ships a lossy summary silently.
 *
 * Pure functions — no DB, no LLM, safe to unit test.
 */

export const REQUIRED_SUMMARY_SECTIONS = [
  "objective",
  "progress",
  "pending",
  "decisions",
  "identifiers",
] as const;

export type SummarySection = (typeof REQUIRED_SUMMARY_SECTIONS)[number];

export interface SummaryAuditResult {
  ok: boolean;
  missingSections: SummarySection[];
  lostIdentifiers: string[];
  reasons: string[];
}

const SECTION_ALIASES: Record<SummarySection, RegExp> = {
  objective: /\b(objective|goal|purpose)\b/i,
  progress: /\b(progress|done|completed|status)\b/i,
  pending: /\b(pending|open|next steps?|remaining|todo|blockers?)\b/i,
  decisions: /\b(decisions?|agreed|chosen|verdicts?)\b/i,
  identifiers: /\b(identifiers?|ids?|paths?|files?|references?)\b/i,
};

/**
 * Extract literal identifiers from source text that a faithful summary must
 * preserve: file paths, table/env-var style tokens, numeric ids (#123),
 * URLs, and R-round tags. Bounded to keep the audit cheap.
 */
export function extractIdentifiers(source: string, cap = 40): string[] {
  const text = (source || "").slice(0, 200_000);
  const found = new Set<string>();
  const patterns = [
    /[\w./-]+\.(?:ts|tsx|js|json|md|sql|sh|py)\b/g, // file paths
    /\b[A-Z][A-Z0-9_]{4,}\b/g,                        // ENV_VAR / CONST tokens
    /#\d{2,}/g,                                        // #123 ids
    /\bR\d{2,3}(?:\+[\d.]+)?\b/g,                     // R-round tags
    /https?:\/\/[^\s)"']+/g,                           // URLs
  ];
  for (const re of patterns) {
    for (const m of text.match(re) || []) {
      found.add(m);
      if (found.size >= cap) return [...found];
    }
  }
  return [...found];
}

export function auditSummaryQuality(summary: string, sourceText?: string): SummaryAuditResult {
  const reasons: string[] = [];
  const s = summary || "";

  const missingSections = REQUIRED_SUMMARY_SECTIONS.filter(sec => !SECTION_ALIASES[sec].test(s));
  if (missingSections.length > 0) reasons.push(`missing sections: ${missingSections.join(", ")}`);
  if (s.trim().length < 80) reasons.push("summary too short to be a faithful compaction");

  let lostIdentifiers: string[] = [];
  if (sourceText) {
    const ids = extractIdentifiers(sourceText);
    lostIdentifiers = ids.filter(id => !s.includes(id));
    // Tolerate partial loss — a summary is allowed to prune; it is NOT
    // allowed to lose (nearly) everything. >60% loss of literal anchors
    // means the compaction dropped the referential spine.
    if (ids.length >= 5 && lostIdentifiers.length / ids.length > 0.6) {
      reasons.push(`lost ${lostIdentifiers.length}/${ids.length} literal identifiers`);
    } else {
      lostIdentifiers = lostIdentifiers.length / Math.max(ids.length, 1) > 0.6 ? lostIdentifiers : [];
    }
  }

  return { ok: reasons.length === 0, missingSections, lostIdentifiers, reasons };
}

/**
 * Deterministic fallback: when the LLM summary fails the audit, build a
 * structured skeleton from the raw source instead — head/tail excerpts plus
 * the extracted identifier list. Lossy but HONEST: it says it is a fallback.
 */
export function buildFallbackSummary(sourceText: string, auditReasons: string[] = []): string {
  const src = (sourceText || "").trim();
  const head = src.slice(0, 1200);
  const tail = src.length > 2400 ? src.slice(-1200) : "";
  const ids = extractIdentifiers(src);
  return [
    "# Deterministic fallback summary (LLM compaction failed quality audit)",
    auditReasons.length ? `Audit failure: ${auditReasons.join("; ")}` : "",
    "",
    "## Objective / Progress / Pending / Decisions",
    "NOT reliably extracted — read the excerpts and identifiers below.",
    "",
    "## Identifiers preserved",
    ids.length ? ids.map(i => `- ${i}`).join("\n") : "- (none found)",
    "",
    "## Opening excerpt",
    head,
    tail ? "\n## Closing excerpt\n" + tail : "",
  ].filter(Boolean).join("\n");
}

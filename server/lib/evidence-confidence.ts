/**
 * Evidence Confidence — platform-wide primitive (2026-08-15).
 *
 * Principle (from Bob's p-value materials, translated honestly): a score or
 * ranking is only as trustworthy as the evidence behind it. Every surface
 * that hands the user a number SHOULD also say how solid the research was.
 *
 * The scale is deliberately coarse (High / Medium / Low) because our
 * "evidence" is web research and LLM judgment, not sampled outcome data —
 * pretending to decimal precision here would be fake statistics. When real
 * outcome history exists (e.g. which Smart Leads replied/bought), graduate
 * that surface to actual hypothesis testing instead of widening this scale.
 *
 * Consumers: Smart Leads dossiers, research reports, IdeaBrowser scoring.
 * Advisory metadata everywhere — parsing is fail-soft (null → "n/a"), never
 * a fail-closed quality gate.
 */

export type EvidenceConfidence = "High" | "Medium" | "Low";

/** Normalize any casing/junk to the canonical label — null when unrecognizable. */
export function normalizeConfidence(v: unknown): EvidenceConfidence | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "high" ? "High" : s === "medium" ? "Medium" : s === "low" ? "Low" : null;
}

/**
 * Deterministic confidence from a count of external evidence rows —
 * fail closed: junk/missing counts as zero evidence.
 */
export function confidenceFromEvidenceCount(count: unknown): EvidenceConfidence {
  const n = Number(count);
  if (!Number.isSafeInteger(n) || n <= 0) return "Low";
  return n >= 3 ? "High" : "Medium";
}

/**
 * Parse a 'Confidence: High|Medium|Low' LINE at an exact position in an
 * LLM-drafted body (0-based index among non-empty trimmed lines). Positional
 * on purpose — a stray 'Confidence:' deeper in prose must never be promoted
 * to metadata (architect finding on the Smart Leads variant).
 */
export function parseConfidenceLineAt(body: string, lineIndex: number): EvidenceConfidence | null {
  const lines = String(body || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const line = lines[lineIndex];
  if (!line) return null;
  const m = /^confidence\s*:\s*(high|medium|low)$/i.exec(line);
  return m ? normalizeConfidence(m[1]) : null;
}

/**
 * Remove the FIRST line of `body` when it is a confidence header (used after
 * a successful positional parse at index 0, so the label isn't rendered twice).
 */
export function stripLeadingConfidenceLine(body: string): string {
  const raw = String(body || "");
  const lines = raw.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return raw;
  if (!/^confidence\s*:\s*(high|medium|low)$/i.test(lines[firstIdx].trim())) return raw;
  return lines.slice(firstIdx + 1).join("\n").replace(/^\s*\n/, "");
}

/** Prompt fragment mandating the confidence self-report — reuse verbatim across drafting prompts. */
export const CONFIDENCE_PROMPT_RULE =
  "'Confidence: High', 'Confidence: Medium', or 'Confidence: Low' — how strong the verified evidence behind this content is. High = grounded in substantive, specific, verified material. Medium = partial or indirect evidence. Low = key sources were unreachable or the content leans on general inference.";

/** Customer-facing explainer paragraph — reuse verbatim in report intros. */
export const CONFIDENCE_EXPLAINER =
  "About Evidence Confidence: a score or claim is only as trustworthy as the research behind it. High means it is grounded in substantive verified material; Medium means only partial or indirect evidence was available; Low means key sources were unreachable and it leans on general inference — verify before relying on it.";

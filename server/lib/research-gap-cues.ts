import type { ResearchRevisitReport } from "./research-revisit";
import { loadResearchRevisitReportsForNeeds } from "../../scripts/lib/research-revisit-inventory";

export interface GapSignal {
  description: string;
  source: string;
  status: string;
  missCount: number;
}

export interface ResearchGapCue {
  gap: string;
  missCount: number;
  source: string;
  matches: Array<{ title: string; path: string; status: string; matchedTerms: string[] }>;
}

/** Pure advisory selection. A generic two-word overlap is not enough to cue an implementation review. */
export function selectResearchGapCues(
  gaps: GapSignal[],
  reports: ResearchRevisitReport[],
): ResearchGapCue[] {
  return gaps.slice(0, 10).flatMap((gap, index) => {
    if (gap.status === "resolved" || gap.status === "safety_blocked") return [];
    const matches = (reports[index]?.candidates ?? [])
      .filter((candidate) => candidate.matchedTerms.length >= 3
        && candidate.status !== "adopted" && candidate.status !== "rejected")
      .slice(0, 2)
      .map(({ title, path, status, matchedTerms }) => ({ title, path, status, matchedTerms }));
    return matches.length ? [{
      gap: gap.description.slice(0, 200),
      missCount: gap.missCount,
      source: gap.source,
      matches,
    }] : [];
  });
}

export function gapCuesEnabled(): boolean {
  return process.env.RESEARCH_GAP_CUES_ENABLED !== "0";
}

export function researchCueAvailability(
  sourceAvailable: boolean, enabled: boolean,
): "available" | "disabled" | "unavailable" {
  return !enabled ? "disabled" : sourceAvailable ? "available" : "unavailable";
}

/** Bounded, read-only file lookup. No model, DB write, approval, or executor call. */
export function findResearchGapCues(
  gaps: GapSignal[], now: Date,
): ResearchGapCue[] {
  if (!gapCuesEnabled()) return [];
  const bounded = gaps.filter((gap) => typeof gap.description === "string"
    && gap.description.trim().length > 0
    && gap.status !== "resolved" && gap.status !== "safety_blocked").slice(0, 10);
  if (!bounded.length) return [];
  const reports = loadResearchRevisitReportsForNeeds(
    bounded.map((gap) => gap.description.slice(0, 500)),
    { now, limit: 20 },
  );
  return selectResearchGapCues(bounded, reports);
}
// Deterministic-picker discipline (FareedKhan-dev/all-agentic-architectures,
// MIT — pattern, not code). The universal escape from the LLM-as-Scorer
// flat-band pathology: the model commits to CATEGORICAL features (booleans /
// enums) and CODE composes the deciding number. These composers are pure (no
// I/O, no imports) so they're trivially unit-testable and carry zero load-time
// side effects.

export interface RebuttalSignals {
  attacksCoreAssumption: boolean;   // targets a load-bearing premise (hard to dismiss)
  hasConcreteEvidence: boolean;     // backed by a specific mechanism/example, not vibes
  easilyMitigated: boolean;         // a cheap, obvious fix neutralizes it
  dependsOnRareCondition: boolean;  // only bites under an unlikely edge case
}

// cross-critique.ts: maps a panelist's categorical commits to a 1-10 survival
// score. Base 5; load-bearing/evidenced findings climb, cheaply-mitigated /
// edge-case findings fall. Clamped to [1,10].
export function composeRebuttalSurvival(s: RebuttalSignals): number {
  let v = 5;
  if (s.attacksCoreAssumption) v += 2;
  if (s.hasConcreteEvidence) v += 2;
  if (s.easilyMitigated) v -= 3;
  if (s.dependsOnRareCondition) v -= 2;
  return Math.max(1, Math.min(10, v));
}

// memory-intelligence.ts (relationship gates): the model commits to a
// categorical certainty instead of a raw 0.0-1.0 float; code maps it to the
// weight the downstream gates use. Weights preserve the existing gate semantics
// exactly: dedup gate (>0.7) passes only "high"; update gate (>0.6) passes
// "high" + "medium"; "low" passes neither (falls through to create).
export function certaintyToWeight(c: unknown): number {
  if (c === "high") return 0.9;
  if (c === "medium") return 0.65;
  if (c === "low") return 0.3;
  return 0.5; // unknown/missing → neutral (matches prior `|| 0.5` default)
}

// memory-intelligence.ts (extraction keep-gate): the model commits to how a
// fact/triple was "stated" rather than emitting a raw 0.0-1.0 float.
// "speculative" → 0.3 is below the >=0.5 keep gate (dropped), so the three
// categories reproduce the old explicit(0.9)/implied(0.6)/vague(<0.5-dropped)
// band exactly.
export function statedToWeight(s: unknown): number {
  if (s === "explicit") return 0.9;
  if (s === "implied") return 0.6;
  if (s === "speculative") return 0.3;
  return 0.6; // unknown/missing → treat as implied (kept), matches prior `?? 1` lenience
}

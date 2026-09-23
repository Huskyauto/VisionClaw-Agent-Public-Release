// ─────────────────────────────────────────────────────────────────────────────
// Shared contract for reading the IdeaBrowser/Isenberg scorer's persisted
// priority block. The scorer (server/lib/ideabrowser-score.ts + the Isenberg
// backfill scripts) writes scores under `projects.metadata.priority.*` —
// NEVER at the metadata top level. Every consumer (mission opportunity
// scanner, weekly digests, portfolio tooling) MUST read through this module
// so the write shape and the read shape can never drift apart again.
//
// (External review 2026-08-02 caught the scanner reading metadata->>'tier'
// while the scorer wrote metadata->'priority'->>'tier' — the weekly scan
// silently found zero candidates. This accessor is the fix.)
// ─────────────────────────────────────────────────────────────────────────────

export interface IdeaPriority {
  tier: "S" | "A" | "B" | "C" | "Park";
  composite: number;
  rationale: string;
  buyerHypothesis: string;
}

const TIERS = new Set(["S", "A", "B", "C", "Park"]);

/**
 * Strict, fail-closed reader for the scorer's `metadata.priority` block.
 * Returns null on any shape mismatch (missing block, bad tier, non-numeric
 * composite) — callers treat null as "not a scored idea", never as zeros.
 */
export function readIdeaPriority(metadata: unknown): IdeaPriority | null {
  const meta = metadata && typeof metadata === "object" ? (metadata as any) : null;
  const p = meta?.priority && typeof meta.priority === "object" ? meta.priority : null;
  if (!p) return null;
  const tier = typeof p.tier === "string" ? p.tier : "";
  if (!TIERS.has(tier)) return null;
  // No JS numeric coercion (null/""/booleans coerce to 0/1): accept only a
  // real finite safe integer, or a canonical all-digit string — matching the
  // scanner SQL's ~ '^[0-9]+$' predicate. Anything else is malformed → null.
  let composite: number;
  if (typeof p.composite === "number" && Number.isSafeInteger(p.composite)) {
    composite = p.composite;
  } else if (typeof p.composite === "string" && /^[0-9]+$/.test(p.composite)) {
    composite = Number(p.composite);
    if (!Number.isSafeInteger(composite)) return null;
  } else {
    return null;
  }
  return {
    tier: tier as IdeaPriority["tier"],
    composite,
    rationale: typeof p.rationale === "string" ? p.rationale.trim() : "",
    buyerHypothesis: typeof p.buyer_hypothesis === "string" ? p.buyer_hypothesis.trim() : "",
  };
}

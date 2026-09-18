/**
 * scripts/lib/bwb-first-person-guard.ts
 *
 * INFORMATIONAL / NON-BLOCKING first-person checker for the Built With Bob
 * weekly recap. It detects drift away from FIRST PERSON — Bob talking AS HIMSELF
 * to the viewer ("I woke up", "my morning walk") rather than a narrator
 * describing him in the third person ("Bob woke up", "his journey").
 *
 * IMPORTANT (Bob's call, 2026-06-14): this is NO LONGER a fail-closed guard. The
 * recap IS Bob speaking as himself in his own Fish voice, so first person is the
 * house style NARRATION_RULES asks for — not a render-blocking rule. The caller
 * (scripts/build-bwb-weekly.ts) only console.warns on a failed audit and ships
 * the script regardless; it never fails or triggers a corrective retry on person.
 * DO NOT re-wire this back into a blocking guard — Bob removed it after a
 * stochastic single-scene LLM slip refused an otherwise-perfect recap. (The voice
 * lock via assertBobVoice remains hard-fail-closed; first person does not.)
 *
 * Two signals (used only to compose the advisory warning):
 *   1. THIRD-PERSON SELF-REFERENCE (high precision): a scene that names "Bob"
 *      (he never calls himself Bob — that's a narrator), OR uses a bare he/him/his
 *      with no first-person framing in the same scene. Any such scene is flagged
 *      in the advisory warning. The brand phrase "Built With Bob" is stripped
 *      first so it can't false-trip.
 *   2. FIRST-PERSON FLOOR (backstop): even with zero third-person hits, a genuine
 *      Bob monologue is saturated with I/my/me — require most scenes to carry a
 *      first-person marker so the recap reads as a personal monologue, not a
 *      detached caption list.
 *
 * Pure + dependency-free so it can be unit-tested and shared.
 */

// First-person markers (straight + curly apostrophes). Word-boundaried so "my"
// matches but "myth" does not. "I" and its contractions are matched
// case-sensitively to avoid a stray lowercase "i"; the rest are case-insensitive.
const FIRST_PERSON_RE =
  /(\bI\b|\bI'm\b|\bI’m\b|\bI've\b|\bI’ve\b|\bI'll\b|\bI’ll\b|\bI'd\b|\bI’d\b)|\b(?:my|me|myself|mine|we|we're|we’re|our|ours)\b/i;

// The channel/brand name contains "Bob" — strip it before looking for a
// third-person self-reference so "Welcome back to Built With Bob" doesn't trip.
const BRAND_RE = /built with bob/gi;
// Bob referring to himself by name (incl. possessive) = narrator framing.
const BOB_NAME_RE = /\bBob(?:'s|’s)?\b/i;
// Third-person singular pronouns (only count as drift when the scene has NO
// first-person framing — so "my doctor said he..." stays clean).
const THIRD_PERSON_PRONOUN_RE = /\b(?:he|him|his)\b/i;

export function isFirstPersonNarration(text: string): boolean {
  return FIRST_PERSON_RE.test((text || "").trim());
}

// Brand-strip that PRESERVES character indices (replace each matched char with a
// space) so an offense's position in the stripped text still points at the same
// spot in the original — needed to quote the exact offending fragment.
function stripBrandKeepIndices(text: string): string {
  return (text || "").replace(BRAND_RE, (m) => " ".repeat(m.length));
}

/**
 * Does this scene refer to Bob in the THIRD person (narrator framing)? True if it
 * names "Bob" (after stripping the brand phrase), or uses a bare he/him/his with
 * no first-person framing in the same scene.
 */
export function hasThirdPersonSelfReference(text: string): boolean {
  const stripped = stripBrandKeepIndices(text).trim();
  if (!stripped) return false;
  if (BOB_NAME_RE.test(stripped)) return true;
  if (THIRD_PERSON_PRONOUN_RE.test(stripped) && !FIRST_PERSON_RE.test(stripped)) return true;
  return false;
}

/**
 * Locate the EXACT token that makes a scene read third-person — the bare "Bob"
 * (after brand-strip) or the bare he/him/his. Mirrors hasThirdPersonSelfReference
 * so the two never disagree. Returns null for a clean scene.
 *
 * This is what lets the guard's error/retry feedback quote the offending word
 * instead of the first 77 chars of the scene — the cutoff that made a real
 * "...on my troubled areas, [the way Bob recommends]" drift LOOK like a false
 * positive because the visible prefix ("Every Thursday I also do...") is itself
 * first person while the offending "Bob" sat past the truncation.
 */
export function findThirdPersonOffense(
  text: string,
): { token: string; index: number } | null {
  const stripped = stripBrandKeepIndices(text);
  if (!stripped.trim()) return null;
  const bob = stripped.match(BOB_NAME_RE);
  if (bob && bob.index != null) return { token: bob[0], index: bob.index };
  if (!FIRST_PERSON_RE.test(stripped)) {
    const pron = stripped.match(THIRD_PERSON_PRONOUN_RE);
    if (pron && pron.index != null) return { token: pron[0], index: pron.index };
  }
  return null;
}

// Build a short, pointed example for the error/retry: a window around the
// offending token with the token in [brackets], e.g.
//   "…on my troubled areas, the way [Bob] always recommends"
// Falls back to a plain truncation when no specific token is found (the
// low-first-person-floor path has no single offender).
function formatDriftExample(text: string): string {
  const off = findThirdPersonOffense(text);
  if (!off) return text.length > 80 ? text.slice(0, 77) + "…" : text;
  const PRE = 32;
  const POST = 28;
  const start = Math.max(0, off.index - PRE);
  const endTok = off.index + off.token.length;
  const before = text.slice(start, off.index);
  const after = text.slice(endTok, endTok + POST);
  const lead = start > 0 ? "…" : "";
  const tail = endTok + POST < text.length ? "…" : "";
  return `${lead}${before}[${off.token}]${after}${tail}`.replace(/\s+/g, " ").trim();
}

export interface FirstPersonAudit {
  total: number; // non-empty scenes considered
  firstPerson: number; // scenes carrying a first-person marker
  drift: number; // scenes with a third-person self-reference
  driftExamples: string[]; // up to 3 offending narration snippets (for the error)
  ratio: number; // firstPerson / total (1 when nothing to check)
  passes: boolean;
}

/**
 * Audit a set of scene narrations. Pass `scenes 2..N` (the LLM-synthesized ones)
 * — scene 1 is the LOCKED first-person intro and is exempt. Empty narrations are
 * ignored; with nothing to check the audit passes (no false alarm on empty input).
 *
 * Passes only when there are ZERO third-person self-references AND at least
 * `threshold` of the scenes are affirmatively first person (default 0.7).
 */
export function auditFirstPerson(narrations: string[], threshold = 0.7): FirstPersonAudit {
  const scenes = (narrations || []).map((s) => (s || "").trim()).filter(Boolean);
  if (scenes.length === 0) {
    return { total: 0, firstPerson: 0, drift: 0, driftExamples: [], ratio: 1, passes: true };
  }
  const firstPerson = scenes.filter((s) => isFirstPersonNarration(s)).length;
  const driftScenes = scenes.filter((s) => hasThirdPersonSelfReference(s));
  const ratio = firstPerson / scenes.length;
  const passes = driftScenes.length === 0 && ratio >= threshold;
  return {
    total: scenes.length,
    firstPerson,
    drift: driftScenes.length,
    driftExamples: driftScenes.slice(0, 3).map(formatDriftExample),
    ratio,
    passes,
  };
}

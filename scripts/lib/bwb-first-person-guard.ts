/**
 * scripts/lib/bwb-first-person-guard.ts
 *
 * Fail-closed net that keeps the Built With Bob weekly recap in FIRST PERSON —
 * Bob talking AS HIMSELF to the viewer ("I woke up", "my morning walk"), never a
 * narrator describing him in the third person ("Bob woke up", "his journey",
 * "I watched Bob push through his walk").
 *
 * NARRATION_RULES already instructs first person and Bob confirmed the recap is
 * "like I'm talking to the people listening" — but the model can drift, and
 * (unlike the voice, which is hard-locked by assertBobVoice) nothing else
 * validated person. This is the matching guard.
 *
 * Two signals, fail-closed:
 *   1. THIRD-PERSON SELF-REFERENCE (high precision): a scene that names "Bob"
 *      (he never calls himself Bob — that's a narrator), OR uses a bare he/him/his
 *      with no first-person framing in the same scene. ANY such scene fails the
 *      render. The brand phrase "Built With Bob" is stripped first so it can't
 *      false-trip.
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

/**
 * Does this scene refer to Bob in the THIRD person (narrator framing)? True if it
 * names "Bob" (after stripping the brand phrase), or uses a bare he/him/his with
 * no first-person framing in the same scene.
 */
export function hasThirdPersonSelfReference(text: string): boolean {
  const stripped = (text || "").replace(BRAND_RE, " ").trim();
  if (!stripped) return false;
  if (BOB_NAME_RE.test(stripped)) return true;
  if (THIRD_PERSON_PRONOUN_RE.test(stripped) && !FIRST_PERSON_RE.test(stripped)) return true;
  return false;
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
    driftExamples: driftScenes.slice(0, 3).map((s) => (s.length > 80 ? s.slice(0, 77) + "…" : s)),
    ratio,
    passes,
  };
}

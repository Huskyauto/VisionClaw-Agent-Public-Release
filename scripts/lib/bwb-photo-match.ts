/**
 * Built With Bob — PURE photo-matching + env-parsing helpers for the weekly
 * recap photo feature. Kept dependency-free (only node:path) and separate from
 * bwb-photo-fetch.ts so unit tests can import it WITHOUT pulling in the Drive /
 * DB-coupled fetch module (which would otherwise hang node:test on an open pool).
 */
import * as path from "node:path";

export interface PhotoSpec {
  /** Filename (or partial name) Bob gave for the asset in the Drive folder. */
  name: string;
  /** Optional one-line description / where it belongs — used for smart placement. */
  hint?: string;
}

/** Lowercased filename stem (basename without its extension). */
export function photoStem(name: string): string {
  const base = path.basename(name);
  const ext = path.extname(base);
  return (ext ? base.slice(0, -ext.length) : base).toLowerCase();
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= 2);
}

/**
 * Pick the index of the best candidate for a given spec name. PURE + exported
 * for unit testing. Candidates should be pre-sorted newest-first so the newest
 * file wins on an otherwise-equal match. Returns -1 when nothing plausibly
 * matches (so the caller can FAIL LOUD rather than grab an unrelated image).
 *
 * Match tiers (strongest first):
 *   1. exact full-name (case-insensitive)
 *   2. exact stem (name sans extension, case-insensitive)
 *   3. one stem fully contains the other (e.g. "connie-dinner" ⊂ "connie-dinner-2")
 *   4. token overlap — candidate must cover ALL of the spec's tokens, most wins
 */
export function pickBestPhotoMatch(specName: string, candidates: { name: string }[]): number {
  if (!specName || !candidates.length) return -1;
  const wantFull = path.basename(specName).toLowerCase();
  const wantStem = photoStem(specName);
  const wantTokens = tokens(wantStem);

  let exactFull = -1;
  let exactStem = -1;
  let contains = -1;
  let containsLen = Infinity; // prefer the tightest containing match
  let tokenIdx = -1;
  let tokenBest = 0;

  for (let i = 0; i < candidates.length; i++) {
    const cFull = path.basename(candidates[i].name).toLowerCase();
    const cStem = photoStem(candidates[i].name);
    if (cFull === wantFull && exactFull === -1) exactFull = i;
    if (cStem === wantStem && exactStem === -1) exactStem = i;
    if (cStem && wantStem && (cStem.includes(wantStem) || wantStem.includes(cStem)) && cStem.length < containsLen) {
      contains = i;
      containsLen = cStem.length;
    }
    if (wantTokens.length) {
      const cTokens = new Set(tokens(cStem));
      const overlap = wantTokens.filter((t) => cTokens.has(t)).length;
      // Require the candidate to cover EVERY spec token (subset match) so a
      // single shared word ("dinner") can't hijack an unrelated photo.
      if (overlap === wantTokens.length && overlap > tokenBest) {
        tokenBest = overlap;
        tokenIdx = i;
      }
    }
  }

  if (exactFull !== -1) return exactFull;
  if (exactStem !== -1) return exactStem;
  if (contains !== -1) return contains;
  return tokenIdx;
}

/**
 * Parse the BWB_EXTRA_PHOTOS env payload threaded from the bwb_weekly_build
 * tool. Accepts a JSON array of {name,hint?} objects OR plain strings. Returns
 * [] on empty/invalid so a malformed value can't crash the builder before the
 * (number-free) photo step.
 */
export function parseExtraPhotosEnv(raw: string | undefined): PhotoSpec[] {
  const s = (raw || "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    const out: PhotoSpec[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) out.push({ name: item.trim() });
      else if (item && typeof item === "object" && typeof item.name === "string" && item.name.trim()) {
        out.push({ name: item.name.trim(), hint: typeof item.hint === "string" ? item.hint.trim() : undefined });
      }
    }
    return out;
  } catch {
    return [];
  }
}

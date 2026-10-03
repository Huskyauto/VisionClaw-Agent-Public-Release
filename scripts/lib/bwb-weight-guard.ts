/**
 * BWB weekly recap — weight-honesty guard (pure, dependency-free).
 *
 * Find weight figures in narration that aren't one of the supplied factual
 * anchors. The recap previously shipped a fabricated weight ("265 lbs"), so this
 * is the deterministic fail-closed net.
 *
 * DESIGN: phrasing-independent, in BOTH numeral and spelled-out spaces. Rather
 * than chase an unbounded set of cue phrasings, we flag ANY value in a plausible
 * body-weight range [120, 700] that is NOT a supplied fact — whether written as
 * digits ("265", "268.5") or words ("two hundred sixty-five", and the colloquial
 * unit-dropped "two sixty-five" = 265) — UNLESS it is part of a longer/decimal
 * number, an ordinal ("130th"), a currency amount ($/£/€), or immediately
 * followed by a non-weight unit (carbs / minutes / calories / steps / bpm /
 * dollars / …). This deliberately biases fail-closed: in a wellness recap the
 * dominant in-range value IS the body weight, and shipping a wrong weight
 * publicly (the original bug) is far worse than a rare false-close that just
 * emails Bob to re-run.
 *
 * Returns the offending figures (string tokens, e.g. "265 lbs"); empty ⇒ clean.
 *
 * Kept in its own module (no server/DB imports) so it can be unit-tested without
 * dragging the whole builder — and its open handles — into the test runner.
 */
const NUMBER_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)";

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Units/nouns that, when they immediately follow a number, mean it is NOT a body
// weight — so "down to 150 carbs", "200 calories", "165 bpm", "$300 a month"
// don't fail-close a legitimate recap. Allows an optional "a/an/per/each" article.
const NON_WEIGHT_UNIT =
  /^\W*(?:(?:a|an|per|each)\s+)?(?:carb|calorie|cal\b|kcal|milligram|mg\b|microgram|mcg\b|minute|min\b|second|sec\b|hour|hr\b|step|mile|km\b|kilometer|meter|rep\b|reps\b|set\b|sets\b|push-?up|sit-?up|squat|crunch|lunge|day|week|month|year|dose|unit|iu\b|ounce|oz\b|gram|liter|litre|ml\b|degree|dollar|cent|euro|percent|%|times|bpm|beat|dumbbell|kettlebell|barbell|plate|vest)/i;

// NOTE on "X over Y": there is intentionally NO blood-pressure ("130 over 80")
// exemption. "<number> over <number>" is irreducibly ambiguous — it covers BP
// but also real recap narration ("265 over the weekend", "265 over 7 days",
// "265, over 4 pounds higher than Friday"). Every attempt to whitelist BP-only
// reopened a wrong-weight bypass, so we fail closed: an in-range non-fact number
// in an "over" phrase flags. The cost is a rare false-close on a genuine BP
// mention (Bob just adds it to the facts / re-runs) — far cheaper than shipping
// a wrong weight publicly, which was the original bug this guard exists to stop.

const WEIGHT_MIN = 120;
const WEIGHT_MAX = 700;

/** Convert a run of number-words to its integer value, including the colloquial
 *  unit-dropped hundreds form ("two sixty-five" → 265). Returns null if the run
 *  isn't a clean number. */
function spelledRunToNumber(tokens: string[]): number | null {
  const toks = tokens.map((t) => t.toLowerCase()).filter((t) => t && t !== "and");
  if (!toks.length) return null;
  const known = (t: string) => t in ONES || t in TEENS || t in TENS || t === "hundred" || t === "thousand";
  if (!toks.every(known)) return null;
  const val = (t: string) => (t in ONES ? ONES[t] : t in TEENS ? TEENS[t] : TENS[t]);

  if (toks.includes("hundred") || toks.includes("thousand")) {
    let total = 0;
    let cur = 0;
    for (const t of toks) {
      if (t === "hundred") cur = (cur || 1) * 100;
      else if (t === "thousand") { total += (cur || 1) * 1000; cur = 0; }
      else cur += val(t);
    }
    return total + cur;
  }
  // Colloquial: a leading ones-word followed by a tens/teen word reads as the
  // hundreds digit with "hundred" dropped — "two sixty-five" = 265.
  if (toks[0] in ONES && toks.length >= 2 && (toks[1] in TENS || toks[1] in TEENS)) {
    let rest = 0;
    for (let i = 1; i < toks.length; i++) rest += val(toks[i]);
    return ONES[toks[0]] * 100 + rest;
  }
  // Plain additive sum (rarely reaches the weight range without "hundred").
  let sum = 0;
  for (const t of toks) sum += val(t);
  return sum;
}

export function findWeightViolations(text: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const isAllowed = (n: string) => allowed.has(n) || allowed.has(n.replace(/\.0+$/, ""));
  const flag = (n: string) => {
    if (!isAllowed(n) && !seen.has(n)) {
      seen.add(n);
      out.push(`${n} lbs`);
    }
  };

  // 1. Numeric figure in body-weight range, cue-independent.
  for (const m of text.matchAll(/(\d{2,3}(?:\.\d+)?)/g)) {
    const idx = m.index ?? 0;
    const tok = m[1];
    const prev = text[idx - 1] || "";
    if (/[\d.]/.test(prev)) continue; // tail of a longer / decimal number
    if (/[$£€]/.test(prev)) continue; // currency amount
    const rest = text.slice(idx + tok.length);
    if (/^\d/.test(rest)) continue; // part of a longer number
    if (/^(?:st|nd|rd|th)\b/i.test(rest)) continue; // ordinal (e.g. "130th day")
    const n = Number(tok);
    if (n < WEIGHT_MIN || n > WEIGHT_MAX) continue;
    if (isAllowed(tok)) continue;
    if (NON_WEIGHT_UNIT.test(rest)) continue; // non-weight unit follows
    flag(tok);
  }

  // 2. Spelled-out figure in body-weight range (incl. colloquial "two sixty-five").
  const runRe = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMBER_WORD})*\\b`, "gi");
  for (const m of text.matchAll(runRe)) {
    const run = m[0];
    const val = spelledRunToNumber(run.split(/[\s-]+/));
    if (val == null || val < WEIGHT_MIN || val > WEIGHT_MAX) continue;
    const s = String(val);
    if (isAllowed(s)) continue;
    const prev = text[(m.index ?? 0) - 1] || "";
    if (/[$£€]/.test(prev)) continue;
    const rest = text.slice((m.index ?? 0) + run.length);
    if (NON_WEIGHT_UNIT.test(rest)) continue;
    flag(s);
  }

  return out;
}

/**
 * BWB narration timing — word-count → spoken-duration estimator for Bob's Fish
 * voice clone.
 *
 * Why this exists (Bob 2026-06-14): he wants to see, BEFORE a render, how long
 * each slide's narration will take when his Fish voice speaks it, so slide
 * timing lands within a second or two. The FINAL render is already exact — both
 * backends time each slide to the ACTUAL ffprobe'd narration audio — but that
 * number isn't visible until after the (slow) TTS step. This gives a cheap
 * up-front estimate from the script text, plus an after-render check that the
 * estimate matched reality within tolerance (a drift signal if the voice rate
 * ever changes).
 *
 * Pure + dependency-free (only plain JS) on purpose: it's imported by both the
 * scripts/ render paths AND server/mpeg-engine.ts, and it's unit-tested without
 * pulling in Drive/DB modules (which would hang node:test on an open pg pool).
 */

// ~150 words/min conversational pace = 2.5 words/sec. This is the calibrated
// baseline for Bob's Fish voice clone at its default speaking rate; override
// with BWB_NARRATION_WPS if a future voice/rate change shifts it (the
// after-render delta log below is how you'd notice it needs retuning).
export const DEFAULT_WORDS_PER_SEC = 2.5;

// How far the up-front estimate may sit from the actual probed audio before we
// flag it as drift. Bob's bar is "within a second or two".
export const TIMING_TOLERANCE_SEC = 2.0;

/** Resolve the words-per-second rate, honoring a sane BWB_NARRATION_WPS override. */
export function wordsPerSec(): number {
  const raw = process.env.BWB_NARRATION_WPS;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_WORDS_PER_SEC;
}

/** Count spoken words in a narration string (whitespace-delimited, empties dropped). */
export function countWords(text: string | null | undefined): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Estimate how many seconds the Fish voice will take to speak `text`.
 * Floored at 1.0s so an empty/one-word line still gets a visible slide.
 */
export function estimateNarrationSeconds(text: string | null | undefined): number {
  return Math.max(1.0, countWords(text) / wordsPerSec());
}

export interface SceneTiming {
  index: number;        // 1-based
  words: number;
  estSec: number;
}

export interface ScriptTimingSummary {
  totalWords: number;
  totalEstSec: number;
  wps: number;
  perScene: SceneTiming[];
}

/** Per-scene + total spoken-duration estimate for a planned script. */
export function summarizeScenesTiming(
  scenes: ReadonlyArray<{ narration?: string | null }>,
): ScriptTimingSummary {
  const wps = wordsPerSec();
  const perScene: SceneTiming[] = scenes.map((s, i) => {
    const words = countWords(s.narration);
    return { index: i + 1, words, estSec: Math.max(1.0, words / wps) };
  });
  return {
    totalWords: perScene.reduce((a, s) => a + s.words, 0),
    totalEstSec: perScene.reduce((a, s) => a + s.estSec, 0),
    wps,
    perScene,
  };
}

export interface TimingComparison {
  deltaSec: number;        // actual - estimate (positive = spoke longer than estimated)
  withinTolerance: boolean;
}

/** Compare an up-front estimate against the actual probed audio duration. */
export function compareEstimateVsActual(
  estSec: number,
  actualSec: number,
  toleranceSec: number = TIMING_TOLERANCE_SEC,
): TimingComparison {
  const deltaSec = actualSec - estSec;
  return { deltaSec, withinTolerance: Math.abs(deltaSec) <= toleranceSec };
}

/**
 * Built With Bob — shared brand validation.
 *
 * The ONE source of truth for brand rules, used by BOTH render backends so they
 * have true parity:
 *   - scripts/build-bwb-video.ts      (LOCAL, in-process default)
 *   - scripts/bwb-render-github.ts    (GitHub Actions render farm)
 *
 * Neither backend may render a script that has not passed validateBwbScript().
 * Keeping this shared means a brand rule added here is enforced on every path —
 * no backend can silently bypass spoken-URL / playlist / forbidden-token checks.
 */

import { FISH_VOICE_BOB_DIRECT } from "../../server/lib/fish-voice-ids";

// HARD RULE (Bob, 2026-05-31): every Built With Bob render MUST be narrated in
// Bob's own Fish Audio voice clone — never the generic "onyx" narrator, never an
// OpenAI fallback voice. This is the canonical id both backends default to and
// assert against via assertBobVoice() so no path can ship in the wrong voice.
export const BWB_BOB_VOICE_ID = FISH_VOICE_BOB_DIRECT;

// Accept the canonical id or a friendly "bob" alias; anything else (including the
// old "onyx" default) is rejected by assertBobVoice unless explicitly overridden.
const BWB_BOB_VOICE_ALIASES = new Set([
  "bob",
  "bob_direct",
  "bobdirect",
  BWB_BOB_VOICE_ID.toLowerCase(),
]);

/**
 * Resolve a raw BWB_VOICE value to the voice the renderer should use. Empty /
 * undefined / the "bob" alias all resolve to Bob's clone. Any other value passes
 * through unchanged so assertBobVoice() can reject it loudly.
 */
export function resolveBwbVoice(raw: string | undefined | null): string {
  const v = (raw || "").trim();
  if (!v) return BWB_BOB_VOICE_ID;
  if (BWB_BOB_VOICE_ALIASES.has(v.toLowerCase())) return BWB_BOB_VOICE_ID;
  return v;
}

/**
 * Hard rule: Built With Bob renders ONLY in Bob's own Fish Audio voice clone.
 * Fails closed on any other voice. A deliberate non-Bob render (rare — e.g. a
 * guest segment) must set BWB_VOICE_OVERRIDE_OK=1, which is logged loud.
 */
export function assertBobVoice(
  voice: string | undefined | null,
  fail: (msg: string) => never,
  warn: (msg: string) => void = (m) => console.warn(m),
): void {
  const resolved = resolveBwbVoice(voice);
  if (resolved === BWB_BOB_VOICE_ID) return;
  if (process.env.BWB_VOICE_OVERRIDE_OK === "1") {
    warn(
      `[bwb-validate] WARNING: BWB_VOICE_OVERRIDE_OK=1 — rendering in NON-Bob voice "${voice}". ` +
        "This deliberately bypasses the brand voice rule.",
    );
    return;
  }
  fail(
    `Built With Bob must render in Bob's own Fish Audio voice (id ${BWB_BOB_VOICE_ID}). ` +
      `Got voice "${voice}". Leave BWB_VOICE unset (defaults to Bob), set it to "bob" or his id, ` +
      "or set BWB_VOICE_OVERRIDE_OK=1 for a deliberate guest-voice render.",
  );
}

export const ALLOWED_PLAYLISTS = [
  "The Protocol",
  "The Build",
  "The Day",
  "The Protocol Shorts",
  "The Build Shorts",
  "The Day Shorts",
];

export const TITLE_MAX = 60;

export const FORBIDDEN_NARRATION_TOKENS = [
  /Manjaro/i,
  /Monjaro/i,
  /\bGLP\b(?!-1)/, // "GLP" without "-1"
];

export interface BwbScene {
  narration: string;
  imagePrompt?: string;
  imagePath?: string;
}

export interface BwbScript {
  videoId: string;
  playlist: string;
  title: string;
  scenes: BwbScene[];
}

export function isShortPlaylist(playlist: string): boolean {
  return playlist.endsWith("Shorts");
}

/**
 * Validate a BWB script against every brand rule. Calls `fail(msg)` (which must
 * not return — typically a process.exit wrapper) on the first violation so each
 * caller keeps its own stderr prefix + exit-code convention. `warn` is optional
 * (defaults to console.warn) for non-fatal length advisories.
 */
export function validateBwbScript(
  script: BwbScript,
  fail: (msg: string) => never,
  warn: (msg: string) => void = (m) => console.warn(m),
): void {
  if (!script.videoId) fail("script.videoId is required");
  if (!ALLOWED_PLAYLISTS.includes(script.playlist))
    fail(`script.playlist must be one of: ${ALLOWED_PLAYLISTS.join(", ")} — got "${script.playlist}"`);
  if (!script.title) fail("script.title is required");
  if (script.title.length > TITLE_MAX)
    fail(`script.title is ${script.title.length} chars; max ${TITLE_MAX}`);
  if (!script.scenes || script.scenes.length === 0) fail("script.scenes must have at least one entry");

  const isShort = isShortPlaylist(script.playlist);
  script.scenes.forEach((s, i) => {
    if (!s.narration) fail(`scene ${i + 1}: narration is required`);
    if (!s.imagePrompt && !s.imagePath)
      fail(`scene ${i + 1}: must provide either imagePrompt or imagePath`);
    // No spoken URLs / domains. Allow only the brand name "[Your Product]".
    const sanitized = s.narration.replace(/[Your Product]/gi, "");
    const domainHits = sanitized.match(/\b[a-z0-9-]+\.[a-z]{2,}\b/gi);
    if (domainHits)
      fail(`scene ${i + 1}: narration contains spoken URL/domain (${domainHits.join(", ")}). Say "click the link below this video" instead.`);
    for (const re of FORBIDDEN_NARRATION_TOKENS) {
      if (re.test(s.narration))
        fail(`scene ${i + 1}: narration contains forbidden token (${re}). Use "wellness-program" or "wellness".`);
    }
  });

  // Approx duration: 16 chars per second of speech (~150 wpm).
  const totalChars = script.scenes.reduce((n, s) => n + s.narration.length, 0);
  const approxSec = totalChars / 16;
  if (isShort && approxSec > 60)
    fail(`Script estimated ${approxSec.toFixed(0)}s of narration; Shorts cap is 60s.`);
  if (!isShort && approxSec < 60)
    warn(`[bwb-validate] WARNING: estimated ${approxSec.toFixed(0)}s — short for long-form (target 90s-6min).`);
  if (!isShort && approxSec > 360)
    warn(`[bwb-validate] WARNING: estimated ${approxSec.toFixed(0)}s — over 6min target.`);
}

/**
 * Both render backends emit 16:9 1920×1080. Vertical Shorts (1080×1920) are not
 * yet supported by either renderer — fail closed until mpeg-engine + the CI
 * renderer learn vertical output.
 */
export function assertRenderableFormat(script: BwbScript, fail: (msg: string) => never): void {
  if (isShortPlaylist(script.playlist)) {
    fail(
      "Shorts (9:16 / 1080x1920) are not yet supported — both render backends emit 16:9 1920x1080. " +
      "Add vertical support to server/mpeg-engine.ts (and the CI renderer) before producing Shorts. " +
      "For now, use a non-Shorts playlist.",
    );
  }
}

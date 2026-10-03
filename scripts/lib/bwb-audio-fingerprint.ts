/**
 * scripts/lib/bwb-audio-fingerprint.ts
 *
 * Content-fingerprint sidecar for pre-synthesized Built With Bob narration audio
 * — the audio twin of bwb-scene-fingerprint.ts.
 *
 * WHY (Bob 2026-06-21): a weekly recap that fails at the final render (or a
 * re-run within the same week) was re-synthesizing EVERY scene's narration from
 * scratch on each attempt — burning Fish/ElevenLabs TTS tokens for audio that
 * was already produced and unchanged. Scene images already reuse via a
 * prompt-sha256 sidecar; narration audio had no such guard, so the one
 * remaining expensive asset was regenerated every run.
 *
 * Fix: when a scene's narration is synthesized, drop a sidecar holding the
 * sha256 of the inputs that produced it (provider + voice + the exact narration
 * text). Before reusing an on-disk audio file, require the sidecar to match the
 * CURRENT scene's inputs. A genuine resume (same script, same voice) reuses
 * every clip with zero TTS spend; a re-run whose narration or voice changed
 * re-synthesizes only the clips that actually changed. Pure + dependency-light
 * so both render backends can share it.
 */

import fs from "node:fs";
import crypto from "node:crypto";

/** Sidecar path for a synthesized narration clip (e.g. foo.mp3 -> foo.mp3.voice). */
export function audioSidecarPathFor(audioPath: string): string {
  return `${audioPath}.voice`;
}

/** Stable sha256 of the inputs that determine a narration clip's audio: the
 *  provider, the voice id, and the spoken text (whitespace-normalized so trivial
 *  reformatting doesn't needlessly bust an otherwise-identical line). Any change
 *  to voice or wording produces a different hash => re-synthesize. */
export function audioInputsHash(provider: string, voice: string, text: string): string {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return crypto
    .createHash("sha256")
    .update(`${provider || ""}\n${voice || ""}\n${normalized}`)
    .digest("hex");
}

/** Write the fingerprint sidecar next to a freshly-synthesized clip. Best-effort:
 *  a sidecar write failure must never fail the render (worst case is a future run
 *  re-synthesizes the clip because it can't confirm the match). */
export function writeAudioSidecar(audioPath: string, provider: string, voice: string, text: string): void {
  try {
    fs.writeFileSync(audioSidecarPathFor(audioPath), audioInputsHash(provider, voice, text));
  } catch {
    /* non-fatal — see doc above */
  }
}

/** True only when the on-disk clip was synthesized for THESE exact inputs. A
 *  missing/empty/mismatched sidecar OR a missing audio file => false
 *  (re-synthesize), so a pre-fingerprint or foreign clip is never trusted. */
export function audioMatchesInputs(audioPath: string, provider: string, voice: string, text: string): boolean {
  try {
    if (!fs.existsSync(audioPath)) return false;
    const sidecar = audioSidecarPathFor(audioPath);
    if (!fs.existsSync(sidecar)) return false;
    const recorded = fs.readFileSync(sidecar, "utf8").trim();
    return recorded.length > 0 && recorded === audioInputsHash(provider, voice, text);
  } catch {
    return false;
  }
}

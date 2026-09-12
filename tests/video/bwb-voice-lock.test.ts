/**
 * R125+14+sec3 — Built With Bob brand-voice lock regression tests.
 *
 * Tonight a BWB chapter rendered in the WRONG voice because the path Bob
 * actually uses — build_video_from_brief with bwbBrand:true — passed the
 * caller's voice straight through (one saved prompt even passed voice:"onyx").
 * resolveBriefVoiceLock is the single orchestration chokepoint every BWB
 * entrypoint routes through; these tests assert the lock cannot be bypassed,
 * the override escape hatch works, and NON-BWB callers are unaffected.
 *
 * Pure helper — no DB / LLM / render, runs every push.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { resolveBriefVoiceLock } from "../../server/build-video-from-brief";
import { FISH_VOICE_BOB_DIRECT } from "../../server/lib/fish-voice-ids";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function withOverride<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.BWB_VOICE_OVERRIDE_OK;
  if (value === undefined) delete process.env.BWB_VOICE_OVERRIDE_OK;
  else process.env.BWB_VOICE_OVERRIDE_OK = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.BWB_VOICE_OVERRIDE_OK;
    else process.env.BWB_VOICE_OVERRIDE_OK = prev;
  }
}

// ---- the exact footgun from tonight ---------------------------------------
test("bwbBrand:true + voice:'onyx' is overridden to Bob's Fish clone + strictVoice", () => {
  withOverride(undefined, () => {
    const r = resolveBriefVoiceLock({ bwbBrand: true, voice: "onyx", voiceProvider: "openai" });
    assert.equal(r.locked, true);
    assert.equal(r.voice, FISH_VOICE_BOB_DIRECT);
    assert.equal(r.voiceProvider, "fish");
    assert.equal(r.strictVoice, true);
  });
});

test("bwbBrand:true with no voice still locks to Bob's Fish clone", () => {
  withOverride(undefined, () => {
    const r = resolveBriefVoiceLock({ bwbBrand: true });
    assert.equal(r.locked, true);
    assert.equal(r.voice, FISH_VOICE_BOB_DIRECT);
    assert.equal(r.voiceProvider, "fish");
    assert.equal(r.strictVoice, true);
  });
});

test("bwbBrand:true + caller strictVoice:false cannot relax the lock", () => {
  withOverride(undefined, () => {
    const r = resolveBriefVoiceLock({ bwbBrand: true, strictVoice: false });
    assert.equal(r.locked, true);
    assert.equal(r.voice, FISH_VOICE_BOB_DIRECT);
    assert.equal(r.strictVoice, true);
  });
});

// ---- the deliberate escape hatch ------------------------------------------
test("BWB_VOICE_OVERRIDE_OK=1 bypasses the lock for a deliberate guest segment", () => {
  withOverride("1", () => {
    const r = resolveBriefVoiceLock({ bwbBrand: true, voice: "onyx", voiceProvider: "openai" });
    assert.equal(r.locked, false);
    assert.equal(r.voice, "onyx");
    assert.equal(r.voiceProvider, "openai");
    assert.equal(r.strictVoice, false);
  });
});

// ---- NON-BWB callers must be completely unaffected -------------------------
test("non-BWB caller keeps requested voice + defaults (no lock, strict off)", () => {
  withOverride(undefined, () => {
    const r = resolveBriefVoiceLock({ bwbBrand: false, voice: "nova", voiceProvider: "openai" });
    assert.equal(r.locked, false);
    assert.equal(r.voice, "nova");
    assert.equal(r.voiceProvider, "openai");
    assert.equal(r.strictVoice, false);
  });
});

test("non-BWB caller with strictVoice:true keeps it (opt-in lock for non-brand renders)", () => {
  withOverride(undefined, () => {
    const r = resolveBriefVoiceLock({ strictVoice: true });
    assert.equal(r.locked, false);
    assert.equal(r.strictVoice, true);
    assert.equal(r.voice, "onyx"); // unchanged default
    assert.equal(r.voiceProvider, "fish");
  });
});

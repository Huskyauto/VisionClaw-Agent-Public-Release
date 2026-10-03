/**
 * tests/unit/bwb-audio-fingerprint.test.ts
 *
 * Locks the reuse/re-synthesize boundary for BWB narration audio so a weekly
 * recap resume reuses already-produced TTS (no token re-burn) but a changed
 * line or voice still re-synthesizes. Mirrors the scene-image fingerprint guard.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  audioInputsHash,
  audioSidecarPathFor,
  writeAudioSidecar,
  audioMatchesInputs,
} from "../../scripts/lib/bwb-audio-fingerprint";

test("audioInputsHash is stable and whitespace-normalized", () => {
  const a = audioInputsHash("fish", "voice-1", "Hello   world");
  const b = audioInputsHash("fish", "voice-1", "Hello world");
  assert.equal(a, b, "trivial whitespace differences must not bust the hash");
});

test("audioInputsHash changes when ANY input changes", () => {
  const base = audioInputsHash("fish", "voice-1", "the same line");
  assert.notEqual(base, audioInputsHash("openai", "voice-1", "the same line"), "provider change must change hash");
  assert.notEqual(base, audioInputsHash("fish", "voice-2", "the same line"), "voice change must change hash");
  assert.notEqual(base, audioInputsHash("fish", "voice-1", "a different line"), "text change must change hash");
});

test("audioMatchesInputs: reuse only on exact match, re-synthesize otherwise", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-audio-fp-"));
  const clip = path.join(dir, "weekly-2026-06-21_scene_3.mp3");
  fs.writeFileSync(clip, "fake-audio-bytes");

  // No sidecar yet -> never reuse (a foreign/pre-fingerprint clip is untrusted).
  assert.equal(audioMatchesInputs(clip, "fish", "v1", "line three"), false, "missing sidecar => re-synthesize");

  writeAudioSidecar(clip, "fish", "v1", "line three");
  assert.ok(fs.existsSync(audioSidecarPathFor(clip)), "sidecar should be written");
  assert.equal(audioMatchesInputs(clip, "fish", "v1", "line three"), true, "exact inputs => reuse");

  // Changed narration / voice => do not reuse.
  assert.equal(audioMatchesInputs(clip, "fish", "v1", "line three CHANGED"), false, "changed text => re-synthesize");
  assert.equal(audioMatchesInputs(clip, "fish", "v2", "line three"), false, "changed voice => re-synthesize");

  // Audio file gone but sidecar lingers => do not reuse.
  fs.unlinkSync(clip);
  assert.equal(audioMatchesInputs(clip, "fish", "v1", "line three"), false, "missing audio file => re-synthesize");

  fs.rmSync(dir, { recursive: true, force: true });
});

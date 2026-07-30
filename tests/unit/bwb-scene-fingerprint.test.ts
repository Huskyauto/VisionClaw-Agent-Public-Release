import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scenePromptHash,
  sidecarPathFor,
  writeScenePromptSidecar,
  imageMatchesPrompt,
  pruneStaleSceneImages,
} from "../../scripts/lib/bwb-scene-fingerprint";

function tmpImage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-fp-"));
  const p = path.join(dir, "scene-1.png");
  fs.writeFileSync(p, "fake-png-bytes");
  return p;
}

test("scenePromptHash is stable and whitespace-normalized", () => {
  assert.equal(scenePromptHash("a walk in the park"), scenePromptHash("a   walk\nin the   park "));
  assert.notEqual(scenePromptHash("a walk in the park"), scenePromptHash("a swim in the lake"));
});

test("sidecarPathFor appends .prompt", () => {
  assert.equal(sidecarPathFor("/x/scene-3.png"), "/x/scene-3.png.prompt");
});

test("imageMatchesPrompt is false when no sidecar exists (pre-fingerprint image)", () => {
  const img = tmpImage();
  assert.equal(imageMatchesPrompt(img, "morning walk"), false);
});

test("imageMatchesPrompt is true after writing the sidecar for the same prompt", () => {
  const img = tmpImage();
  writeScenePromptSidecar(img, "morning walk");
  assert.equal(imageMatchesPrompt(img, "morning walk"), true);
});

test("imageMatchesPrompt is false when the prompt changed (same-day re-run case)", () => {
  const img = tmpImage();
  writeScenePromptSidecar(img, "morning walk on the trail");
  assert.equal(imageMatchesPrompt(img, "doctor visit at the clinic"), false);
});

test("empty/whitespace sidecar is treated as no-match", () => {
  const img = tmpImage();
  fs.writeFileSync(sidecarPathFor(img), "   ");
  assert.equal(imageMatchesPrompt(img, "anything"), false);
});

function tmpSceneDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bwb-prune-"));
}
function bake(dir: string, n: number, prompt?: string): string {
  const p = path.join(dir, `scene-${n}.png`);
  fs.writeFileSync(p, "fake-png-bytes");
  if (prompt !== undefined) writeScenePromptSidecar(p, prompt);
  return p;
}
function remaining(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
}

test("pruneStaleSceneImages keeps a fingerprint-matching image and removes mismatched/orphan/imagePath ones", () => {
  const dir = tmpSceneDir();
  bake(dir, 2, "promptA");          // matches -> keep
  bake(dir, 3, "promptB-OLD");      // mismatch (scene now promptB-new) -> remove
  bake(dir, 4, "whatever");         // scene now uses a real imagePath -> remove
  bake(dir, 9, "whatever");         // orphan beyond scene count -> remove
  const scenes = [
    { imagePath: "assets/hero.png" },             // scene 1 (hero, no png)
    { imagePrompt: "promptA" },                   // scene 2
    { imagePrompt: "promptB-new" },               // scene 3
    { imagePath: "data/youtube/photos/real.jpg", imagePrompt: "ignored" }, // scene 4
  ];
  pruneStaleSceneImages(dir, scenes);
  assert.deepEqual(remaining(dir), ["scene-2.png"]);
  // its sidecar survives too
  assert.equal(fs.existsSync(sidecarPathFor(path.join(dir, "scene-2.png"))), true);
});

test("pruneStaleSceneImages NEVER deletes a self-referenced imagePath even with no imagePrompt", () => {
  const dir = tmpSceneDir();
  const self = bake(dir, 5);        // no sidecar, no prompt
  const scenes = [
    { imagePrompt: "x" }, { imagePrompt: "x" }, { imagePrompt: "x" }, { imagePrompt: "x" },
    { imagePath: self },            // scene 5: imagePath IS scene-5.png (self-ref) -> keep
  ];
  pruneStaleSceneImages(dir, scenes);
  assert.equal(fs.existsSync(self), true);
});

test("pruneStaleSceneImages removes a no-imagePath/no-imagePrompt positional file", () => {
  const dir = tmpSceneDir();
  bake(dir, 2);                     // no sidecar, scene has neither imagePath nor prompt
  const scenes = [{ imagePrompt: "hero" }, {}];
  pruneStaleSceneImages(dir, scenes);
  assert.deepEqual(remaining(dir), []);
});

test("pruneStaleSceneImages is a no-op on a non-existent dir", () => {
  assert.doesNotThrow(() => pruneStaleSceneImages(path.join(os.tmpdir(), "does-not-exist-xyz"), []));
});

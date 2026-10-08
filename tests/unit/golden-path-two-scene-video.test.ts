import assert from "node:assert/strict";
import test from "node:test";
import { twoSceneVideoJobArgs } from "../../scripts/lib/golden-path-two-scene-video";

test("golden-path two-scene smoke starts exactly one chapter with two Fish-narrated scenes", () => {
  const args = twoSceneVideoJobArgs("/fixture/still.png");
  assert.equal(args.chapters.length, 1);
  assert.equal(args.chapters[0].scenes.length, 2);
  assert.deepEqual(args.chapters[0].scenes.map((scene) => scene.imagePath), ["/fixture/still.png", "/fixture/still.png"]);
  assert.ok(args.chapters[0].scenes.every((scene) => Boolean(scene.narration)));
  assert.equal(args.voiceProvider, "fish");
  assert.equal(args.autoFinalize, true);
  assert.equal(args.autoDeliver, false);
});
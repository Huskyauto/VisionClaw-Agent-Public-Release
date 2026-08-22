import test from "node:test";
import assert from "node:assert/strict";
import { checkRender } from "../../server/deliverable-verifier";

test("delivery verifier rejects random bytes masquerading as a video, audio file, or slide deck", () => {
  const garbage = Buffer.alloc(8192, 0x41);

  assert.match(checkRender("video", garbage, ".mp4") || "", /signature is invalid/);
  assert.match(checkRender("audio", garbage, ".mp3") || "", /signature is invalid/);
  assert.match(checkRender("slide_deck", garbage, ".pptx") || "", /not a ZIP container/);
});

test("delivery verifier accepts recognizable media and presentation containers", () => {
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(32)]);
  const mp3 = Buffer.from("ID3" + "x".repeat(2048));
  const pptx = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(2048)]);

  assert.equal(checkRender("video", mp4, ".mp4"), null);
  assert.equal(checkRender("audio", mp3, ".mp3"), null);
  assert.equal(checkRender("slide_deck", pptx, ".pptx"), null);
});
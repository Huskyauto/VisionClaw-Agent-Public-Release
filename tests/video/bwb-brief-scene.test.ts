/**
 * R125+18 — Built With Bob brief-path scene-assembly regression tests.
 *
 * Bob's autonomous weekly recap shipped with 3 defects when made via the brief
 * path (produce_video / build_video_from_brief with bwbBrand:true): it rendered
 * serially on the local engine, narrated in THIRD person ("welcome to the Built
 * With Bob video series"), and scene 1 was missing Bob's photo. The render-farm
 * routing is verified by inspection (mirrors build-bwb-weekly), but the two
 * content invariants — scene 1 = Bob's locked FIRST-PERSON opener over his REAL
 * photo, and the assembled script passing the SAME brand validator both render
 * backends use — are pure and asserted here.
 *
 * Pure helper — no DB / LLM / render, runs every push.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildBwbScenesFromChapters } from "../../server/build-video-from-brief";
import { validateBwbScript } from "../../scripts/lib/bwb-validate";
import type { ChapterSpec } from "../../server/mpeg-engine";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

const HERO = "attached_assets/Bob_on_wellness-program_—_Channel_Avatar_1777847875921.png";

function sampleChapters(): ChapterSpec[] {
  return [
    {
      chapterTitle: "Intro",
      scenes: [
        // Planner output for scene 1 — intentionally THIRD-person to prove the
        // override replaces it with Bob's locked first-person opener.
        { narration: "Welcome to the Built With Bob video series.", imagePrompt: "studio shot" } as any,
        { narration: "I walked five miles on Monday and felt strong.", imagePrompt: "sunrise trail" } as any,
      ],
    },
    {
      chapterTitle: "Lessons",
      scenes: [
        { narration: "I learned to trust the process even on the hard days.", imagePrompt: "reflective dusk" } as any,
        { narration: "Next week I'm adding strength training to the routine.", imagePrompt: "gym light" } as any,
      ],
    },
  ];
}

test("flattens all chapters into one flat scenes array", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), undefined);
  assert.equal(scenes.length, 4);
  // No hero → scene 1 keeps the planner's narration + imagePrompt unchanged.
  assert.match(scenes[0].narration, /Welcome to the Built With Bob/);
  assert.equal(scenes[0].imagePath, undefined);
});

test("with a hero photo, scene 1 is FORCED to Bob's first-person opener over his real photo", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), HERO);
  assert.equal(scenes.length, 4);
  // Scene 1 narration is replaced with the locked first-person opener…
  assert.match(scenes[0].narration, /^Hey, this is Bob/);
  assert.doesNotMatch(scenes[0].narration, /welcome to the Built With Bob video series/i);
  // …and shown over Bob's real photo (imagePath), with NO AI imagePrompt.
  assert.equal(scenes[0].imagePath, HERO);
  assert.equal(scenes[0].imagePrompt, undefined);
  // Remaining scenes are untouched.
  assert.match(scenes[1].narration, /I walked five miles/);
});

test("a custom intro line overrides the default opener", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), HERO, "Hey, this is Bob — week two recap.");
  assert.equal(scenes[0].narration, "Hey, this is Bob — week two recap.");
  assert.equal(scenes[0].imagePath, HERO);
});

test("assembled BWB script passes the shared brand validator both backends use", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), HERO);
  const script = { videoId: "brief-test", playlist: "The Build", title: "My Built With Bob Week", scenes };
  // fail() must not return; throwing proves no violation was raised.
  assert.doesNotThrow(() =>
    validateBwbScript(script as any, (m) => { throw new Error(m); }, () => {}),
  );
});

test("validator fails closed on a spoken URL in narration", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), HERO);
  scenes[1] = { narration: "Sign up at agenticcorporation dot net today.", imagePrompt: "cta" };
  // "dot net" is words, but a literal domain trips it; use a real domain token.
  scenes[2] = { narration: "Read more at agenticcorporation.net for details.", imagePrompt: "cta" };
  const script = { videoId: "brief-test", playlist: "The Build", title: "Bad Script", scenes };
  assert.throws(() =>
    validateBwbScript(script as any, (m) => { throw new Error(m); }, () => {}),
  );
});

test("validator rejects a playlist outside the allowlist", () => {
  const scenes = buildBwbScenesFromChapters(sampleChapters(), HERO);
  const script = { videoId: "brief-test", playlist: "Random Playlist", title: "x", scenes };
  assert.throws(() =>
    validateBwbScript(script as any, (m) => { throw new Error(m); }, () => {}),
  );
});

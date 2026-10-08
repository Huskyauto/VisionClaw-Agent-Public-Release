import assert from "node:assert/strict";
import test from "node:test";
import { selectGoldenPathFixtures } from "../../scripts/lib/golden-path-fixture-filter";

const fixtures = [{ id: "html_app_password_generator" }, { id: "bwb_video_2scene_fish_smoke" }];

test("a targeted replay runs only the named fixture and rejects unknown names", () => {
  assert.deepEqual(selectGoldenPathFixtures(fixtures, undefined), fixtures);
  assert.deepEqual(selectGoldenPathFixtures(fixtures, "bwb_video_2scene_fish_smoke"), [fixtures[1]]);
  assert.throws(() => selectGoldenPathFixtures(fixtures, "other"), /Unknown golden-path fixture/);
});
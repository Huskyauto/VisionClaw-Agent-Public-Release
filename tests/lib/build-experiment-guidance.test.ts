import test from "node:test";
import assert from "node:assert/strict";
import { buildExperimentGuidance } from "../../server/lib/build-experiment-guidance";

test("build requests get bounded falsification guidance without a blanket approval", () => {
  assert.equal(buildExperimentGuidance("Good morning, how are you?"), "");
  const guidance = buildExperimentGuidance("Please implement the report feature");
  assert.match(guidance, /hardest assumption/);
  assert.match(guidance, /stop condition/);
  assert.match(guidance, /does not grant/);
  assert.match(guidance, /unacceptable/);
});

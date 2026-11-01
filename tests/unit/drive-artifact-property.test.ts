import test from "node:test";
import assert from "node:assert/strict";
import { driveArtifactPropertyValue } from "../../server/lib/drive-artifact-property";
test("Drive receipt identity fits the provider's 124-byte property key plus value limit", () => {
  const short = "artifact:report-audio:1:" + "a".repeat(64);
  assert.equal(driveArtifactPropertyValue(short), short);
  const long = "artifact:company-7443-owner-narration-tts1-v1:" + "b".repeat(64);
  assert.ok(Buffer.byteLength("visionclawArtifactKey" + long) > 124);
  const value = driveArtifactPropertyValue(long);
  assert.ok(Buffer.byteLength("visionclawArtifactKey" + value) <= 124);
  assert.equal(value, driveArtifactPropertyValue(long));
  assert.notEqual(value, driveArtifactPropertyValue(long + "c"));
  assert.throws(() => driveArtifactPropertyValue("artifact:'injection'"));
});

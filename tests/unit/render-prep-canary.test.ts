/**
 * tests/unit/render-prep-canary.test.ts
 *
 * Functional test for the render-prep canary (server/lib/render-prep-canary.ts).
 * In the dev/CI environment ffmpeg+ffprobe resolve and run fine, so the canary
 * MUST report ok=true with all four checks green. This proves the canary's own
 * synth+probe round trip is wired correctly — i.e. it would genuinely catch a
 * broken binary in prod rather than false-passing.
 *
 * Run: node --import tsx --test tests/unit/render-prep-canary.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runRenderPrepCanary } from "../../server/lib/render-prep-canary";

test("render-prep canary passes end-to-end in a working environment", async () => {
  const res = await runRenderPrepCanary();
  const failed = res.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  assert.equal(res.ok, true, `canary failed in a working env (binaries should resolve here):\n${failed.join("\n")}`);
  assert.equal(res.checks.length, 4, "canary should run exactly four checks");
  assert.ok(res.checks.every((c) => c.ok), "all four checks should be green in dev");
});

test("canary reports the resolved binary paths + sources for triage", async () => {
  const res = await runRenderPrepCanary();
  assert.ok(res.ffmpeg && res.ffmpeg.length > 0, "ffmpeg path should be reported");
  assert.ok(res.ffprobe && res.ffprobe.length > 0, "ffprobe path should be reported");
  assert.ok(res.ffmpegSource && res.ffprobeSource, "resolution sources should be reported");
});

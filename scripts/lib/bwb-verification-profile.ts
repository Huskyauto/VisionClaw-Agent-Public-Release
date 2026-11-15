/**
 * Reviewed, fixture-based selection. Explicit paths only: a new script must not
 * become executable merely by matching a filename glob.
 */
export const BWB_VERIFICATION_TESTS = [
  "tests/lib/bwb-recap-preflight.test.ts",
  "tests/unit/bwb-audio-fingerprint.test.ts",
  "tests/unit/bwb-job-progress.test.ts",
  "tests/unit/bwb-narration-timing.test.ts",
  "tests/unit/bwb-oversight-shadow.test.ts",
  "tests/unit/bwb-packaging.test.ts",
  "tests/unit/bwb-photo-match.test.ts",
  "tests/unit/bwb-render-dispatch-guards.test.ts",
  "tests/unit/bwb-render-failure.test.ts",
  "tests/unit/bwb-scene-fingerprint.test.ts",
  "tests/unit/bwb-transient-classify.test.ts",
  "tests/unit/bwb-weekly-first-person-guard.test.ts",
  "tests/unit/bwb-weekly-weight-guard.test.ts",
  "tests/unit/eio-read.test.ts",
  "tests/unit/github-render-output-validation.test.ts",
  "tests/unit/media-output-verification.test.ts",
  "tests/video/bwb-all-daily-clips.test.ts",
  "tests/video/bwb-brief-scene.test.ts",
  "tests/video/bwb-delivery-verification-flow.test.ts",
  "tests/video/bwb-recap-routing.test.ts",
  "tests/video/bwb-voice-lock.test.ts",
  "tests/video/bwb-web-chat-launch.test.ts",
  "tests/video/bwb-weekly-coverage.test.ts",
] as const;

export const BWB_VERIFICATION_INPUTS = [
  "scripts/build-bwb-video.ts", "scripts/build-bwb-weekly.ts",
  "scripts/bwb-weekly-orchestrator.ts", "scripts/bwb-render-github.ts",
  "scripts/bwb-recap-preflight.ts",
  "scripts/lib/bwb-audio-fingerprint.ts", "scripts/lib/bwb-first-person-guard.ts",
  "scripts/lib/bwb-narration-timing.ts", "scripts/lib/bwb-packaging.ts",
  "scripts/lib/bwb-photo-fetch.ts", "scripts/lib/bwb-photo-match.ts",
  "scripts/lib/bwb-recap-preflight.ts", "scripts/lib/bwb-render-failure.ts",
  "scripts/lib/bwb-scene-fingerprint.ts", "scripts/lib/bwb-script-runner.ts",
  "scripts/lib/bwb-transient-classify.ts", "scripts/lib/bwb-validate.ts",
  "scripts/lib/bwb-weekly-coverage.ts", "scripts/lib/bwb-weight-guard.ts",
  "scripts/lib/drive-discover.ts", "scripts/lib/github-render-farm.ts",
  "scripts/lib/video-output-validation.ts",
  "server/lib/bwb-job-progress.ts", "server/lib/bwb-oversight-shadow.ts",
  "server/lib/bwb-web-chat-launch.ts", "server/lib/bwb-web-chat-tool-executor.ts",
  "server/lib/bwb-weight.ts",
] as const;

export const MEDIA_VERIFICATION_TESTS = [
  "tests/unit/media-output-verification.test.ts",
  "tests/unit/github-render-output-validation.test.ts",
  "tests/unit/video-finalize-gate.test.ts",
] as const;

export const MEDIA_VERIFICATION_INPUTS = [
  "server/lib/video-output-verification.ts", "server/lib/video-output-snapshot.ts",
  "server/lib/ffmpeg-paths.ts", "server/video-job-runner.ts",
] as const;

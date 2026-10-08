import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTransientFailure } from "../../scripts/lib/bwb-transient-classify";

/**
 * The transient-vs-deterministic boundary is the safety property of the weekly
 * recap auto-retry: a DETERMINISTIC content/config fail-closed guard must NEVER
 * be classified transient (retrying it wastes ~$5 + render time and fails the
 * same way), and a real TRANSIENT infra fault MUST be classified so it retries.
 */

function build(parts: { stderr?: string; stdout?: string; errorCode?: string }) {
  return {
    stderr: parts.stderr ?? "",
    stdout: parts.stdout ?? "",
    error: parts.errorCode ? { code: parts.errorCode } : undefined,
  } as any;
}

test("deterministic content/config fail-closed guards are NOT transient (no retry)", () => {
  const deterministic = [
    "[build-bwb-weekly] FAIL: weight-honesty guard rejected after 3 attempts — model stated 250 lbs not matching the supplied facts",
    "[build-bwb-weekly] FAIL: zero dated clips fell inside this week's Sun–Sat window — nothing to recap",
    "[build-bwb-weekly] FAIL: a clip is missing a date in its filename — name them YYYY-MM-DD morning.mp4",
    "[build-bwb-weekly] FAIL: voice misconfigured — FISH_VOICE_BOB_DIRECT is empty",
    "[build-bwb-weekly] FAIL: GITHUB_TOKEN missing — cannot render on the farm",
    "[build-bwb-weekly] FAIL: no weight supplied and the synthesizer tried to state a figure",
    // The render-farm wrapper phrase alone must NOT force a transient verdict:
    // a deterministic underlying reason wrapped as "render farm failed …" would
    // fail identically on retry and must fail closed (no paid retry).
    "GitHub render farm failed twice (after one retry): invalid scene configuration — scene-3.png is 1024x1024, expected 1920x1080",
    "render farm failed: script JSON missing required field 'chapters'",
  ];
  for (const msg of deterministic) {
    assert.equal(
      classifyTransientFailure(build({ stderr: msg })),
      null,
      `should be deterministic (null): ${msg}`,
    );
  }
});

test("transient infrastructure faults ARE classified (retry)", () => {
  const cases: Array<[ReturnType<typeof build>, string]> = [
    [build({ stderr: "Error: EIO: i/o error, read" }), "overlayFS EIO read fault"],
    [build({ stderr: "GitHub render farm failed twice (after one retry): Error: EIO" }), "any-transient"],
    [build({ stderr: "request to https://api.github.com failed, reason: ECONNRESET" }), "network socket error"],
    [build({ stderr: "TypeError: fetch failed" }), "network error"],
    [build({ stderr: "render-farm workflow run timed out after 20m" }), "render-farm worker timeout"],
    [build({ stderr: "github returned 503 Service Unavailable" }), "upstream provider 5xx/429"],
    [build({ errorCode: "EIO" }), "builder spawn EIO"],
    [build({ errorCode: "ETIMEDOUT" }), "builder spawn ETIMEDOUT"],
  ];
  for (const [b, _label] of cases) {
    const got = classifyTransientFailure(b);
    assert.notEqual(got, null, `should be transient (non-null): ${b.stderr || b.error?.code}`);
  }
});

test("an empty / unrecognized failure is treated as deterministic (fail-closed, no blind retry)", () => {
  assert.equal(classifyTransientFailure(build({})), null);
  assert.equal(
    classifyTransientFailure(build({ stderr: "Some unexpected error with no known infra signature" })),
    null,
  );
});

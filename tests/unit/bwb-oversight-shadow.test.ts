import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildBwbShadowObservation,
  isBwbOversightShadowEnabled,
  isBwbShadowObservationAuthoritative,
  isBwbShadowRunEvidenceReady,
  missingBwbShadowEvents,
  parseBwbShadowObservation,
} from "../../server/lib/bwb-oversight-shadow";

test("BWB oversight shadow is measurement-only by default and has an exact off switch", () => {
  assert.equal(isBwbOversightShadowEnabled(undefined), true);
  assert.equal(isBwbOversightShadowEnabled("shadow"), true);
  assert.equal(isBwbOversightShadowEnabled("off"), false);
  assert.equal(isBwbOversightShadowEnabled("OFF"), true);
  assert.equal(isBwbOversightShadowEnabled(" off "), true);
  assert.equal(isBwbOversightShadowEnabled("0"), true);
});

test("BWB shadow observations classify phases without retaining customer content", () => {
  const observation = buildBwbShadowObservation({
    jobId: "vj_example_12345678",
    event: "phase_changed",
    phase: "Transcribing 14 clip(s): private-filename.mov",
    metadata: {
      attempt: 2,
      transcript: "private spoken words",
      url: "https://example.test/private",
      arbitrary: "must not survive",
    },
    at: new Date("2026-09-05T12:00:00.000Z"),
  });

  assert.deepEqual(observation, {
    schemaVersion: 1,
    mode: "shadow",
    eventKey: "vj_example_12345678:phase_changed:transcribing:2026-09-05T12:00:00.000Z",
    jobId: "vj_example_12345678",
    event: "phase_changed",
    stage: "transcribing",
    observedAt: "2026-09-05T12:00:00.000Z",
    attempt: 2,
  });
  assert.doesNotMatch(JSON.stringify(observation), /private|example\.test|transcript|url/i);
});

test("BWB shadow storage boundary rejects runtime events outside the allowlist", () => {
  assert.throws(
    () => buildBwbShadowObservation({
      jobId: "vj_example_12345678",
      event: ("x".repeat(10_000)) as any,
    }),
    /Unsupported BWB shadow event/,
  );
});

test("BWB shadow observations clamp numeric metadata and bound failure categories", () => {
  const observation = buildBwbShadowObservation({
    jobId: "vj_example_12345678",
    event: "build_failed",
    metadata: {
      attempts: 999,
      totalChapters: -2,
      failureCategory: "provider_timeout_with_a_very_long_untrusted_suffix_that_must_not_survive",
    },
    at: new Date("2026-09-05T12:00:00.000Z"),
  });

  assert.equal(observation.attempts, 20);
  assert.equal(observation.totalChapters, 0);
  assert.equal(observation.failureCategory, "other");
  assert.ok(JSON.stringify(observation).length < 700);
});

test("BWB shadow report validation rejects forged or malformed evidence rows", () => {
  const valid = buildBwbShadowObservation({
    jobId: "vj_example_12345678",
    event: "approval_decided",
    metadata: { approvalId: 42, approved: true, reviewLatencyMs: 60_000 },
    at: new Date("2026-09-05T12:00:00.000Z"),
  });
  assert.deepEqual(parseBwbShadowObservation(valid), valid);
  assert.equal(parseBwbShadowObservation({ ...valid, jobId: "wrong-tenant-shaped-id" }), null);
  assert.equal(parseBwbShadowObservation({ ...valid, reviewLatencyMs: "fast" }), null);
  assert.equal(parseBwbShadowObservation({ ...valid, event: "auto_publish" }), null);
  assert.equal(parseBwbShadowObservation({ ...valid, stage: "rendering" }), null);
  assert.equal(isBwbShadowObservationAuthoritative(valid, { videoJobId: null }), false);
  assert.equal(isBwbShadowObservationAuthoritative(valid, {
    videoJobId: valid.jobId,
    videoStatus: "done",
    videoCreatedAt: "2026-09-05T11:00:00.000Z",
    videoCompletedAt: "2026-09-05T11:50:00.000Z",
    approval: {
      id: 42,
      jobId: "vj_different_12345678",
      kind: "bwb-weekly",
      status: "approved",
      requestedAt: "2026-09-05T11:59:00.000Z",
      decidedAt: "2026-09-05T12:00:00.000Z",
    },
  }), false);
  assert.equal(isBwbShadowObservationAuthoritative(valid, {
    videoJobId: valid.jobId,
    videoStatus: "done",
    videoCreatedAt: "2026-09-05T11:00:00.000Z",
    videoCompletedAt: "2026-09-05T11:50:00.000Z",
    approval: {
      id: 42,
      jobId: valid.jobId,
      kind: "bwb-weekly",
      status: "approved",
      requestedAt: "2026-09-05T11:59:00.000Z",
      decidedAt: "2026-09-05T12:00:00.000Z",
    },
  }), true);
});

test("BWB shadow readiness requires the full observed lifecycle for a decided recap", () => {
  assert.deepEqual(
    missingBwbShadowEvents([], "done", "approved"),
    ["run_started", "build_completed", "approval_requested", "approval_decided"],
  );
  assert.deepEqual(
    missingBwbShadowEvents([
      { event: "run_started" },
      { event: "build_completed" },
      { event: "approval_requested" },
      { event: "approval_decided" },
    ], "done", "approved"),
    [],
  );
  const completeEvents = [
    { event: "run_started" as const },
    { event: "build_completed" as const },
    { event: "approval_requested" as const },
    { event: "approval_decided" as const },
  ];
  assert.equal(isBwbShadowRunEvidenceReady({
    events: completeEvents,
    videoStatus: "rendering",
    completedAt: null,
    approvalStatus: "approved",
  }), false);
  assert.equal(isBwbShadowRunEvidenceReady({
    events: completeEvents,
    videoStatus: "done",
    completedAt: "2026-09-05T12:00:00.000Z",
    approvalStatus: "approved",
  }), true);
});

test("the recap lifecycle and durable approval path retain shadow hooks", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const progress = read("server/lib/bwb-job-progress.ts");
  const orchestrator = read("scripts/bwb-weekly-orchestrator.ts");
  const publish = read("server/bwb-weekly-publish.ts");
  const report = read("scripts/bwb-oversight-shadow-report.ts");

  assert.match(progress, /safeShadowRecord/);
  assert.match(progress, /event:\s*"run_started"/);
  assert.match(progress, /event:\s*"phase_changed"/);
  assert.match(progress, /event:\s*"build_completed"/);
  assert.match(progress, /event:\s*"build_failed"/);
  assert.match(orchestrator, /event:\s*"approval_requested"/);
  assert.match(publish, /event:\s*"approval_decided"/);
  assert.doesNotMatch(report, /uncorroatedRows/);
  assert.match(report, /if \(!run\) \{\s*uncorroboratedRows\+\+/);
});
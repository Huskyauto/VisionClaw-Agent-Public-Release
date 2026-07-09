import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Weekly-recap PREFLIGHT contract tests.
//
// NETWORK-FREE + DB-FREE: preflightWeeklyRecap reads process.env + does cheap
// binary probes only. Every case passes explicit `over` fields (so it never
// depends on the runner's env) and skipBinaryChecks:true (so ffmpeg/yt-dlp
// presence can't make the suite flaky). Proves the executable failure-catalog
// blocks exactly the documented dead-run causes and stays fail-open elsewhere.

const FISH_BOB = "675fecd0a2d34f1d9c8e7b6a5f4e3d2c"; // shape-only stand-in (32-hex)

async function pf(over: any) {
  const { preflightWeeklyRecap } = await import("../../scripts/lib/bwb-recap-preflight");
  return preflightWeeklyRecap({ skipBinaryChecks: true, voiceOverrideOk: false, ...over });
}

// A baseline that should PASS so each negative case isolates ONE failure.
const OK_BASE = {
  currentWeight: 265,
  totalLost: 239,
  startWeight: 504,
  renderBackend: "github",
  haveGithubPat: true,
  voiceId: FISH_BOB,
  source: "drive" as const,
  haveUrls: false,
  driveFolderId: "abc123",
  ownerEmail: "x@y.com",
  isProd: false,
};

test("baseline with all preconditions met → ok (no blocking)", async () => {
  // Use the real FISH default by leaving voiceId undefined so the lib fills it.
  const r = await pf({ ...OK_BASE, voiceId: undefined });
  assert.equal(r.blocking.length, 0, JSON.stringify(r.blocking));
  assert.equal(r.ok, true);
});

test("missing weight facts → BLOCK (the #1 stall cause)", async () => {
  const r = await pf({ ...OK_BASE, voiceId: undefined, currentWeight: undefined, totalLost: undefined, startWeight: undefined });
  assert.equal(r.ok, false);
  const block = r.blocking.find((b) => b.id === "weight-facts");
  assert.ok(block, "weight-facts must be blocking");
  assert.match(block!.fix || "", /BWB_ALLOW_WEIGHTLESS/);
});

test("missing weight + allowWeightless=1 → ok (intentional weightless)", async () => {
  const r = await pf({ ...OK_BASE, voiceId: undefined, currentWeight: undefined, totalLost: undefined, startWeight: undefined, allowWeightless: true });
  assert.equal(r.ok, true, JSON.stringify(r.blocking));
});

test("inconsistent weight math → warn, not block", async () => {
  // start-current = 504-265 = 239, but totalLost claims 200 → off by 39.
  const r = await pf({ ...OK_BASE, voiceId: undefined, totalLost: 200 });
  assert.equal(r.ok, true, "consistency mismatch must NOT block");
  const w = r.warnings.find((c) => c.id === "weight-facts");
  assert.ok(w, "should surface a consistency warning");
});

test("prod + github backend + no PAT → BLOCK", async () => {
  const r = await pf({ ...OK_BASE, voiceId: undefined, isProd: true, haveGithubPat: false });
  assert.equal(r.ok, false);
  assert.ok(r.blocking.find((b) => b.id === "render-pat"), "prod PAT-less render must block");
});

test("dev + github backend + no PAT → not block (local fallback)", async () => {
  const r = await pf({ ...OK_BASE, voiceId: undefined, isProd: false, haveGithubPat: false });
  assert.equal(r.ok, true);
  // Not a blocking failure in dev; the render-pat check is present + ok (it will
  // fall back to the local builder), so it is NOT in the failing-warnings list.
  assert.ok(!r.blocking.find((b) => b.id === "render-pat"), "must not block in dev");
  const rp = r.checks.find((c) => c.id === "render-pat");
  assert.ok(rp && rp.ok, "render-pat check should be present and ok");
});

test("empty voice → BLOCK", async () => {
  const r = await pf({ ...OK_BASE, voiceId: "" });
  assert.equal(r.ok, false);
  assert.ok(r.blocking.find((b) => b.id === "voice"));
});

test("non-Bob voice without override → BLOCK (brand guard)", async () => {
  const r = await pf({ ...OK_BASE, voiceId: "ffffffffffffffffffffffffffffffff", voiceOverrideOk: false });
  assert.equal(r.ok, false);
  assert.ok(r.blocking.find((b) => b.id === "voice"));
});

test("non-Bob voice WITH override → ok (authorized guest segment)", async () => {
  const r = await pf({ ...OK_BASE, voiceId: "ffffffffffffffffffffffffffffffff", voiceOverrideOk: true });
  assert.equal(r.ok, true, JSON.stringify(r.blocking));
});

test("report is always structured (never throws on empty input)", async () => {
  const { preflightWeeklyRecap } = await import("../../scripts/lib/bwb-recap-preflight");
  const r = preflightWeeklyRecap({ skipBinaryChecks: true });
  assert.ok(Array.isArray(r.checks) && r.checks.length > 0);
  assert.equal(typeof r.ok, "boolean");
  assert.equal(typeof r.summary, "string");
});

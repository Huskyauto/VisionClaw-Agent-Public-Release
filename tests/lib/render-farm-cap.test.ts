// Cost guards for the generalized GitHub Actions render farm (Bob 2026-06-02).
// Pure logic, no heavy imports — these run fast in node:test via tests/run.sh.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkDailyCap,
  resolveDailyCap,
  DEFAULT_DAILY_CAP,
  MAX_CHAPTERS_PER_RENDER,
} from "../../scripts/lib/render-farm-cap";

const D1 = new Date("2026-06-02T08:00:00Z");
const D2 = new Date("2026-06-03T00:30:00Z"); // next UTC day

test("checkDailyCap: first render of the day is allowed and counts to 1", () => {
  const r = checkDailyCap(null, 50, D1);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.next, { date: "2026-06-02", count: 1 });
  assert.equal(r.remaining, 49);
});

test("checkDailyCap: increments an existing same-day counter", () => {
  const r = checkDailyCap({ date: "2026-06-02", count: 3 }, 50, D1);
  assert.equal(r.allowed, true);
  assert.equal(r.next.count, 4);
  assert.equal(r.remaining, 46);
});

test("checkDailyCap: blocks at the cap (fails closed, no increment)", () => {
  const r = checkDailyCap({ date: "2026-06-02", count: 50 }, 50, D1);
  assert.equal(r.allowed, false);
  assert.equal(r.next.count, 50); // not incremented past the cap
  assert.equal(r.remaining, 0);
});

test("checkDailyCap: resets the counter on a new UTC day", () => {
  const r = checkDailyCap({ date: "2026-06-02", count: 50 }, 50, D2);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.next, { date: "2026-06-03", count: 1 });
});

test("checkDailyCap: a cap of 1 allows exactly one render then blocks", () => {
  const first = checkDailyCap(null, 1, D1);
  assert.equal(first.allowed, true);
  const second = checkDailyCap(first.next, 1, D1);
  assert.equal(second.allowed, false);
});

test("resolveDailyCap: defaults and clamps junk/sub-1 values", () => {
  assert.equal(resolveDailyCap(undefined), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap("not-a-number"), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap("0"), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap("-5"), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap("12"), 12);
});

test("MAX_CHAPTERS_PER_RENDER stays within the CI matrix bound (1..24)", () => {
  assert.ok(MAX_CHAPTERS_PER_RENDER >= 1 && MAX_CHAPTERS_PER_RENDER <= 24);
});

// ─── Shape invariants for the farm wiring (heavy modules — read as source) ───

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

test("farm core: enforces the daily cap and the chapter cap before dispatch", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  assert.match(src, /enforceDailyCap\(/, "core must call the daily-cap guard");
  assert.match(src, /MAX_CHAPTERS_PER_RENDER/, "core must reference the chapter cap");
});

test("farm core: voice/provider/strictVoice are parameterized (brand-agnostic)", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  assert.match(src, /voice/);
  assert.match(src, /voiceProvider/);
  assert.match(src, /strictVoice/);
});

test("farm core: daily-cap is FAIL-CLOSED (refuses render on read/write/lock error)", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  // The old fail-OPEN "best-effort; never block a render on the counter file"
  // swallow must be gone — every error path now calls fail(...).
  assert.doesNotMatch(src, /never block a render on the counter file/);
  assert.match(src, /could not persist render-cap counter[^]*fail-closed/);
  assert.match(src, /could not acquire the render-cap lock/);
  assert.match(src, /openSync\(lockFile, "wx"\)/, "cap must serialize with an O_EXCL lock");
});

test("farm core: customer path can require a PRIVATE render repo", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  assert.match(src, /assertPrivateRepo/);
  assert.match(src, /is NOT private/);
});

test("generic entry: requires a private render repo for customer media", () => {
  const src = read("scripts/render-github-generic.ts");
  assert.match(src, /requirePrivateRepo:\s*true/);
});

test("farm core: cap is bypassable for personal/owner work (skipDailyCap + env)", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  assert.match(src, /skipDailyCap/, "core must expose a skipDailyCap option");
  assert.match(src, /RENDER_FARM_NO_CAP/, "core must honor a per-run cap-bypass env");
  // The bypass must short-circuit BEFORE enforceDailyCap, not after.
  assert.match(src, /if \(capBypassed\)[^]*else[^]*enforceDailyCap\(/);
});

test("BWB (personal) path renders uncapped", () => {
  const src = read("scripts/bwb-render-github.ts");
  assert.match(src, /skipDailyCap:\s*true/);
});

test("farm core: poll reports per-chapter parallel status (proves fan-out)", () => {
  const src = read("scripts/lib/github-render-farm.ts");
  assert.match(src, /actions\/runs\/\$\{runId\}\/jobs/, "must poll the run's per-job endpoint");
  assert.match(src, /render chapter/i, "must isolate the chapter matrix jobs");
  assert.match(src, /in_progress/, "must surface how many chapters are running at once");
});

test("BWB wrapper: keeps brand validation + Fish-voice assertion", () => {
  const src = read("scripts/bwb-render-github.ts");
  assert.match(src, /validateBwbScript/);
  assert.match(src, /assertBobVoice/);
  assert.match(src, /renderOnGithubFarm/);
});

test("generic entry: does NOT brand-validate and uses the caller voice", () => {
  const src = read("scripts/render-github-generic.ts");
  assert.doesNotMatch(src, /validateBwbScript|assertBobVoice/, "generic path must not impose BWB brand rules");
  assert.match(src, /renderOnGithubFarm/);
  assert.match(src, /script\.voice/);
});

test("brief router: generic branch routes to the GitHub farm by default", () => {
  const src = read("server/build-video-from-brief.ts");
  assert.match(src, /render-github-generic\.ts/);
  assert.match(src, /VIDEO_RENDER_BACKEND/);
});

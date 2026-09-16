import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatReleaseRound, readCurrentRelease } from "../../scripts/lib/release-round";

test("formats parent and security rounds without collisions", () => {
  assert.deepEqual(formatReleaseRound("R128"), { tag: "r128", packageVersion: "128.0.0" });
  assert.deepEqual(formatReleaseRound("R128+sec"), { tag: "r128-sec", packageVersion: "128.0.0-sec" });
  assert.deepEqual(formatReleaseRound("R128+sec2"), { tag: "r128-sec2", packageVersion: "128.0.0-sec.2" });
  assert.deepEqual(formatReleaseRound("R125+155.2+sec12-3"), {
    tag: "r125.155.2-sec12-3",
    packageVersion: "125.155.2-sec.12.3",
  });
});

test("rejects malformed, leading-zero, ambiguous, and overlong rounds", () => {
  for (const round of [
    "R01",
    "R128+sec02",
    "R128+sec.2",
    "R128+sec2.3",
    "R128+sec2-03",
    "R128+0",
    "R128+0.0",
    "R1+2.0",
    "R1+2.3.4",
    "R128+",
  ]) {
    assert.throws(() => formatReleaseRound(round), round);
  }
});

test("requires the explicit current marker to match a release section", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-round-"));
  const valid = join(dir, "valid.md");
  writeFileSync(valid, "### R128+sec2 — Secure release (September 14, 2026)\n\nCurrent release: **R128+sec2**\n");
  assert.deepEqual(readCurrentRelease(valid), {
    round: "R128+sec2",
    title: "Secure release",
    date: "September 14, 2026",
  });

  const mismatch = join(dir, "mismatch.md");
  writeFileSync(mismatch, "## R128 — Parent (September 11, 2026)\n\nCurrent release: **R128+sec2**\n");
  assert.throws(() => readCurrentRelease(mismatch), /no matching section/);
});

test("mirror package stamping aborts instead of publishing a stale version", () => {
  const script = readFileSync("scripts/build-public-mirror.sh", "utf8");
  assert.match(script, /version stamp failed — refusing to push a stale release/);
  assert.match(script, /\|\| \{ echo .*; exit 1; \}/);
  const stampIndex = script.indexOf("MIRROR_VERSION=");
  assert.ok(stampIndex >= 0, "version-stamp block must exist");
  const pushIndexes = [...script.matchAll(/^\s*git push\b/gm)].map((match) => match.index);
  assert.ok(pushIndexes.length > 0, "mirror script must contain a push");
  for (const pushIndex of pushIndexes) {
    assert.ok(stampIndex < pushIndex, "version stamping must precede every git push");
  }
});
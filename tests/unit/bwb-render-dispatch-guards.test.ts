/**
 * tests/unit/bwb-render-dispatch-guards.test.ts
 *
 * Closes the deferred test-coverage gap for the BWB GitHub render-farm dispatch
 * input validation. The render-farm sends GITHUB_TOKEN as a Bearer header when
 * fetching the dispatch-supplied `bundle_url`, so that URL MUST be locked to
 * THIS repo's release-asset API or the token could be exfiltrated to an
 * attacker host (SSRF→token-leak). `num_chapters` is fanned out into a job
 * matrix, so it MUST be a bounded integer. Both guards live in
 * .github/workflows/bwb-render.yml as fail-closed bash steps.
 *
 * This test (1) asserts the guards are still PRESENT in the workflow (so they
 * can't be silently dropped) and (2) replicates the exact regexes against
 * allow/deny samples to lock in their behavior.
 *
 * Run: node --import tsx --test tests/unit/bwb-render-dispatch-guards.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const yml = readFileSync(resolve(process.cwd(), ".github/workflows/bwb-render.yml"), "utf8");

// --- Guards must remain present (regression on silent removal) -----------
test("workflow still validates bundle_url against the repo release-asset API", () => {
  assert.match(yml, /expected="\^https:\/\/api\\\.github\\\.com\/repos\/\$\{REPO\}\/releases\/assets\/\[0-9\]\+\$"/);
  assert.match(yml, /bundle_url rejected/);
});

test("workflow still bounds num_chapters to an integer 1..24", () => {
  assert.match(yml, /\^\[0-9\]\+\$/);
  assert.match(yml, /-lt 1 \] \|\| \[ "\$n" -gt 24 \]/);
});

// --- Replicated bundle_url guard behavior --------------------------------
// Mirror of the bash regex with a concrete repo bound in.
const REPO = "Huskyauto/VisionClaw-Agent";
const bundleOk = new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases/assets/[0-9]+$`);

test("accepts the canonical release-asset URL", () => {
  assert.ok(bundleOk.test(`https://api.github.com/repos/${REPO}/releases/assets/123456`));
});

test("rejects an attacker-controlled host", () => {
  assert.equal(bundleOk.test("https://evil.example.com/repos/Huskyauto/VisionClaw-Agent/releases/assets/1"), false);
});

test("rejects a different repo", () => {
  assert.equal(bundleOk.test("https://api.github.com/repos/attacker/repo/releases/assets/1"), false);
});

test("rejects plaintext http", () => {
  assert.equal(bundleOk.test(`http://api.github.com/repos/${REPO}/releases/assets/1`), false);
});

test("rejects a non-numeric / traversal asset id", () => {
  assert.equal(bundleOk.test(`https://api.github.com/repos/${REPO}/releases/assets/../../secrets`), false);
  assert.equal(bundleOk.test(`https://api.github.com/repos/${REPO}/releases/assets/1?x=y`), false);
});

test("rejects an @-host smuggle past the expected prefix", () => {
  assert.equal(bundleOk.test(`https://api.github.com.evil.com/repos/${REPO}/releases/assets/1`), false);
});

// --- Replicated num_chapters guard behavior ------------------------------
function chaptersOk(n: string): boolean {
  return /^[0-9]+$/.test(n) && Number(n) >= 1 && Number(n) <= 24;
}

test("num_chapters accepts the in-range integers", () => {
  assert.ok(chaptersOk("1"));
  assert.ok(chaptersOk("24"));
});

test("num_chapters rejects out-of-range and non-integers", () => {
  assert.equal(chaptersOk("0"), false);
  assert.equal(chaptersOk("25"), false);
  assert.equal(chaptersOk("abc"), false);
  assert.equal(chaptersOk("3; rm -rf /"), false);
  assert.equal(chaptersOk("-1"), false);
  assert.equal(chaptersOk("1.5"), false);
});

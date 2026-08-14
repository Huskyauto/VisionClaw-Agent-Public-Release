/**
 * tests/unit/bwb-photo-match.test.ts
 *
 * Covers the PURE photo-matching + env-parsing helpers in
 * scripts/lib/bwb-photo-match.ts — the logic that lets Bob name a real photo he
 * dropped in his BWB Drive folder and have the weekly recap find + slot it.
 * Imports the dependency-free module ONLY (no Drive/DB) so node:test never hangs
 * on an open pg pool.
 *
 * Run: node --import tsx --test tests/unit/bwb-photo-match.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pickBestPhotoMatch, parseExtraPhotosEnv } from "../../scripts/lib/bwb-photo-match";

const cand = (...names: string[]) => names.map((name) => ({ name }));

// --- pickBestPhotoMatch: exact + tiers ----------------------------------
test("exact full filename match wins", () => {
  const c = cand("IMG_4821.HEIC", "IMG_4822.HEIC");
  assert.equal(pickBestPhotoMatch("IMG_4821.HEIC", c), 0);
});

test("match is case-insensitive", () => {
  const c = cand("Img_4821.heic");
  assert.equal(pickBestPhotoMatch("IMG_4821.HEIC", c), 0);
});

test("exact stem match ignores differing extension", () => {
  const c = cand("connie-dinner.jpg");
  assert.equal(pickBestPhotoMatch("connie-dinner.heic", c), 0);
});

test("partial/contains stem match", () => {
  const c = cand("anniversary-dinner-2026.jpg", "random.jpg");
  assert.equal(pickBestPhotoMatch("anniversary-dinner", c), 0);
});

test("token-subset fallback covers all spec tokens", () => {
  const c = cand("saturday_connie_therese_dinner.jpg", "monday_walk.jpg");
  assert.equal(pickBestPhotoMatch("connie therese", c), 0);
});

test("a single shared word does NOT hijack an unrelated photo", () => {
  // "dinner" alone shouldn't match when the spec needs both tokens.
  const c = cand("work_dinner.jpg");
  assert.equal(pickBestPhotoMatch("connie therese", c), -1);
});

test("returns -1 when nothing plausibly matches", () => {
  const c = cand("img_0001.jpg", "img_0002.jpg");
  assert.equal(pickBestPhotoMatch("anniversary", c), -1);
});

test("empty inputs are safe", () => {
  assert.equal(pickBestPhotoMatch("", cand("a.jpg")), -1);
  assert.equal(pickBestPhotoMatch("a.jpg", []), -1);
});

test("caller pre-sort (newest-first) is honored for equal matches", () => {
  // Two stems that both contain the spec; the first (newest) tightest wins.
  const c = cand("dinner.jpg", "dinner.png");
  assert.equal(pickBestPhotoMatch("dinner", c), 0);
});

// --- parseExtraPhotosEnv -------------------------------------------------
test("parses JSON object array with hints", () => {
  const out = parseExtraPhotosEnv(JSON.stringify([{ name: "a.heic", hint: "dinner" }, { name: "b.jpg" }]));
  assert.deepEqual(out, [{ name: "a.heic", hint: "dinner" }, { name: "b.jpg", hint: undefined }]);
});

test("parses array of bare strings", () => {
  const out = parseExtraPhotosEnv(JSON.stringify(["a.heic", "b.jpg"]));
  assert.deepEqual(out, [{ name: "a.heic" }, { name: "b.jpg" }]);
});

test("drops empty / nameless entries", () => {
  const out = parseExtraPhotosEnv(JSON.stringify([{ name: "  " }, { hint: "no name" }, "ok.jpg"]));
  assert.deepEqual(out, [{ name: "ok.jpg" }]);
});

test("empty / undefined / malformed → []", () => {
  assert.deepEqual(parseExtraPhotosEnv(undefined), []);
  assert.deepEqual(parseExtraPhotosEnv(""), []);
  assert.deepEqual(parseExtraPhotosEnv("   "), []);
  assert.deepEqual(parseExtraPhotosEnv("{not json"), []);
  assert.deepEqual(parseExtraPhotosEnv(JSON.stringify({ name: "x" })), []); // not an array
});

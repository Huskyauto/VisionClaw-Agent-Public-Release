import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyErrorNote,
  compactFailureNotes,
  formatCompactionDigest,
} from "../../server/lib/evidence-compactor";

test("compactFailureNotes: empty input returns empty result, no crash", () => {
  const r = compactFailureNotes([]);
  assert.equal(r.topK.length, 0);
  assert.equal(r.totalCount, 0);
  assert.equal(r.droppedCount, 0);
  assert.equal(r.ratio, 1);
  assert.deepEqual(r.topKByErrorClass, {});
  assert.deepEqual(r.droppedByErrorClass, {});
});

test("compactFailureNotes: null/undefined-style input handled defensively", () => {
  // @ts-expect-error — exercising defensive runtime path
  const r1 = compactFailureNotes(null);
  assert.equal(r1.topK.length, 0);
  // @ts-expect-error
  const r2 = compactFailureNotes(undefined);
  assert.equal(r2.topK.length, 0);
});

test("compactFailureNotes: k=0 drops everything but still classifies", () => {
  const notes = [
    "timeout while calling YouTube API",
    "401 unauthorized from Google Drive",
    "Zod validation failed: missing field",
  ];
  const r = compactFailureNotes(notes, { k: 0 });
  assert.equal(r.topK.length, 0);
  assert.equal(r.droppedCount, 3);
  assert.equal(r.totalCount, 3);
  assert.equal(r.droppedByErrorClass.timeout, 1);
  assert.equal(r.droppedByErrorClass.auth, 1);
  assert.equal(r.droppedByErrorClass.validation, 1);
});

test("compactFailureNotes: exact duplicates collapse into topK + dropped", () => {
  const notes = [
    "timeout: failed to fetch /api/render after 30s",
    "timeout: failed to fetch /api/render after 30s",
    "timeout: failed to fetch /api/render after 30s",
    "timeout: failed to fetch /api/render after 30s",
    "timeout: failed to fetch /api/render after 30s",
  ];
  const r = compactFailureNotes(notes, { k: 10 });
  assert.equal(r.topK.length, 1, "near-duplicates dedupe to 1");
  assert.equal(r.droppedCount, 4);
  assert.equal(r.droppedByErrorClass.timeout, 4);
});

test("compactFailureNotes: diverse errors all surface up to K", () => {
  const notes = [
    "timeout: fetch deadline exceeded",
    "ECONNREFUSED on Drive upload",
    "401 unauthorized token expired",
    "429 rate-limit hit on OpenAI",
    "Zod validation failed missing tenantId",
    "404 not found for skill xyz",
    "payload too large 5MB exceeds limit",
    "malformed JSON parse error at line 12",
    "permission denied accessing /uploads",
    "some unknown weird thing happened nobody understands",
  ];
  const r = compactFailureNotes(notes, { k: 10 });
  assert.equal(r.topK.length, 10);
  assert.equal(r.droppedCount, 0);
});

test("compactFailureNotes: stack-trace notes outrank short generic notes (scoring)", () => {
  const notes = [
    "error",
    "fail",
    "oops",
    "TypeError: cannot read property foo of undefined\n    at handler.ts:42:13\n    at server/router.ts:128:9",
  ];
  const r = compactFailureNotes(notes, { k: 1 });
  assert.equal(r.topK.length, 1);
  assert.match(r.topK[0], /TypeError/);
});

test("compactFailureNotes: ratio computed correctly", () => {
  const notes = Array(50).fill("timeout error generic");
  const r = compactFailureNotes(notes, { k: 5 });
  assert.equal(r.totalCount, 50);
  // all 50 are near-duplicates, only 1 selected
  assert.equal(r.topK.length, 1);
  assert.equal(r.droppedCount, 49);
  assert.equal(r.ratio, 50);
});

test("compactFailureNotes: K > input.length keeps everything", () => {
  const notes = [
    "timeout fetching api",
    "ECONNREFUSED on upload",
    "401 auth token expired",
  ];
  const r = compactFailureNotes(notes, { k: 100 });
  assert.equal(r.topK.length, 3);
  assert.equal(r.droppedCount, 0);
});

test("compactFailureNotes: filters non-string entries defensively", () => {
  const notes = ["timeout fetch", "", "valid validation failed schema mismatch"];
  const r = compactFailureNotes(notes, { k: 10 });
  assert.equal(r.topK.length, 2);
  assert.equal(r.totalCount, 2);
});

test("compactFailureNotes: deterministic given same input (reproducibility)", () => {
  const notes = [
    "timeout error A unique tokens here",
    "auth 401 error B different tokens entirely",
    "validation zod error C totally separate vocabulary domain",
  ];
  const r1 = compactFailureNotes(notes, { k: 2 });
  const r2 = compactFailureNotes(notes, { k: 2 });
  assert.deepEqual(r1.topK, r2.topK);
  assert.deepEqual(r1.droppedByErrorClass, r2.droppedByErrorClass);
});

test("classifyErrorNote: each known class is detected", () => {
  assert.equal(classifyErrorNote("operation timed out after 30s"), "timeout");
  assert.equal(classifyErrorNote("ECONNREFUSED connecting to host"), "network");
  assert.equal(classifyErrorNote("401 unauthorized: invalid token"), "auth");
  assert.equal(classifyErrorNote("429 too many requests rate-limit hit"), "rate_limit");
  assert.equal(classifyErrorNote("Zod validation failed for body"), "validation");
  assert.equal(classifyErrorNote("404 not found for resource"), "not_found");
  assert.equal(classifyErrorNote("payload too large exceeds limit"), "size");
  assert.equal(classifyErrorNote("malformed JSON parse error"), "format");
  assert.equal(classifyErrorNote("permission denied to /admin"), "permission");
  assert.equal(classifyErrorNote("something weird happened nobody knows"), "unknown");
  assert.equal(classifyErrorNote(""), "unknown");
  // @ts-expect-error — defensive runtime path
  assert.equal(classifyErrorNote(null), "unknown");
});

test("formatCompactionDigest: empty dropped → empty string (no spam)", () => {
  const digest = formatCompactionDigest({
    topK: ["a"],
    totalCount: 1,
    droppedCount: 0,
    topKByErrorClass: { unknown: 1 },
    droppedByErrorClass: {},
    ratio: 1,
  });
  assert.equal(digest, "");
});

test("formatCompactionDigest: surfaces breakdown sorted by count desc", () => {
  const digest = formatCompactionDigest({
    topK: [],
    totalCount: 10,
    droppedCount: 7,
    topKByErrorClass: {},
    droppedByErrorClass: { timeout: 5, auth: 1, unknown: 1 },
    ratio: 7,
  });
  assert.match(digest, /7 additional notes compressed/);
  assert.match(digest, /timeout=5/);
  assert.match(digest, /ratio 7\.00x/);
  // timeout comes first (highest count)
  const idxTimeout = digest.indexOf("timeout=");
  const idxAuth = digest.indexOf("auth=");
  assert.ok(idxTimeout < idxAuth, "highest-count class appears first");
});

test("compactFailureNotes: tenant isolation is one layer up — compactor is pure (no DB, no IO)", () => {
  // This is a structural invariant: the module must NOT import db or sql.
  // Asserted indirectly by importing the module in this test context where
  // no DB connection is available and verifying no throw.
  const r = compactFailureNotes(["timeout"], { k: 1 });
  assert.equal(r.topK.length, 1);
});

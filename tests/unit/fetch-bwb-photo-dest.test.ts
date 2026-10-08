import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveDest } from "../../scripts/fetch-bwb-photo";

const ROOT = path.resolve("data/youtube/photos");

test("accepts a bare filename under the root", () => {
  assert.equal(resolveDest("connie-dinner.jpg"), path.join(ROOT, "connie-dinner.jpg"));
});

test("accepts a nested path under the root", () => {
  assert.equal(resolveDest("2026/connie.jpg"), path.join(ROOT, "2026/connie.jpg"));
});

test("rejects parent-traversal escape", () => {
  assert.equal(resolveDest("../../etc/passwd"), null);
  assert.equal(resolveDest("../secrets.json"), null);
});

test("rejects absolute path escape", () => {
  assert.equal(resolveDest("/etc/passwd"), null);
  assert.equal(resolveDest("/tmp/evil.jpg"), null);
});

test("rejects the root itself (no filename)", () => {
  assert.equal(resolveDest(""), null);
  assert.equal(resolveDest("."), null);
});

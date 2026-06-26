/**
 * Large-Output Wrap invariants (R115.5).
 *
 * Behavioral tests for the generalized head+tail+sandbox-file offloading
 * helper. We can run these for real because the helper writes to
 * data/run-sandbox/ on disk (no DB needed).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { wrapLargeResult, __internals } from "../../server/lib/large-output-wrap";

test("wrap: small payload returns passthrough (truncated:false)", () => {
  const r = wrapLargeResult({ label: "test_small", payload: "hello world" });
  assert.equal(r.truncated, false);
  if (r.truncated === false) {
    assert.equal(r.inline, "hello world");
    assert.equal(r.bytes, 11);
  }
});

test("wrap: large payload offloads to sandbox file with head+tail", () => {
  const big = "X".repeat(50_000);
  const r = wrapLargeResult({ label: "test_big", payload: big });
  assert.equal(r.truncated, true);
  if (r.truncated === true) {
    assert.equal(r.bytes, 50_000);
    assert.equal(r.head.length, __internals.HEAD_CHARS);
    assert.equal(r.tail.length, __internals.TAIL_CHARS);
    assert.ok(fs.existsSync(r.sandboxPath), "sandbox file must exist on disk");
    const content = fs.readFileSync(r.sandboxPath, "utf8");
    assert.equal(content.length, 50_000);
    fs.unlinkSync(r.sandboxPath);
  }
});

test("wrap: label regex rejects path-traversal attempts", () => {
  assert.throws(() => wrapLargeResult({ label: "../../etc/passwd", payload: "X".repeat(50_000) }));
  assert.throws(() => wrapLargeResult({ label: "foo/bar", payload: "X".repeat(50_000) }));
  assert.throws(() => wrapLargeResult({ label: "", payload: "X".repeat(50_000) }));
  assert.throws(() => wrapLargeResult({ label: "x".repeat(200), payload: "X".repeat(50_000) }));
});

test("wrap: label regex accepts a-z, 0-9, _, -", () => {
  const r = wrapLargeResult({ label: "ok_label-123", payload: "X".repeat(50_000) });
  assert.equal(r.truncated, true);
  if (r.truncated === true) fs.unlinkSync(r.sandboxPath);
});

test("wrap: sandbox path stays under SANDBOX_DIR (path jail)", () => {
  const r = wrapLargeResult({ label: "jail_test", payload: "X".repeat(50_000) });
  assert.equal(r.truncated, true);
  if (r.truncated === true) {
    assert.ok(r.sandboxPath.startsWith(__internals.SANDBOX_DIR + path.sep), "must live under SANDBOX_DIR");
    fs.unlinkSync(r.sandboxPath);
  }
});

test("wrap: threshold is configurable + has a 1KB minimum floor", () => {
  // A 2KB payload should pass through with default 16KB threshold.
  const r1 = wrapLargeResult({ label: "thr1", payload: "X".repeat(2048) });
  assert.equal(r1.truncated, false);
  // Same payload with threshold=1KB should offload.
  const r2 = wrapLargeResult({ label: "thr2", payload: "X".repeat(2048), threshold: 1024 });
  assert.equal(r2.truncated, true);
  if (r2.truncated === true) fs.unlinkSync(r2.sandboxPath);
  // Threshold below 1024 floors at 1024.
  const r3 = wrapLargeResult({ label: "thr3", payload: "X".repeat(500), threshold: 1 });
  assert.equal(r3.truncated, false); // 500B < 1024B floor
});

test("wrap: default threshold is 16KB", () => {
  assert.equal(__internals.DEFAULT_THRESHOLD_BYTES, 16 * 1024);
});

test("wrap: file is created with mode 0o600 (owner-only)", () => {
  const r = wrapLargeResult({ label: "perm_test", payload: "X".repeat(50_000) });
  assert.equal(r.truncated, true);
  if (r.truncated === true) {
    const st = fs.statSync(r.sandboxPath);
    // Mask the file-type bits, check perm bits.
    assert.equal((st.mode & 0o777), 0o600);
    fs.unlinkSync(r.sandboxPath);
  }
});

test("wrap: retrieval hint references run_command action='get_output'", () => {
  const r = wrapLargeResult({ label: "hint_test", payload: "X".repeat(50_000) });
  assert.equal(r.truncated, true);
  if (r.truncated === true) {
    assert.match(r.hint, /run_command/);
    assert.match(r.hint, /get_output/);
    assert.match(r.hint, /hint_test/);
    fs.unlinkSync(r.sandboxPath);
  }
});

test("wrap: head and tail are non-overlapping when payload is large enough", () => {
  // Payload must exceed the 16KB default threshold. Build A(1500) + B(20k) + C(1500).
  const head = "A".repeat(1500);
  const middle = "B".repeat(20_000);
  const tail = "C".repeat(1500);
  const r = wrapLargeResult({ label: "headtail", payload: head + middle + tail });
  assert.equal(r.truncated, true);
  if (r.truncated === true) {
    assert.ok(r.head.startsWith("A"), "head starts with leading bytes");
    assert.ok(r.tail.endsWith("C"), "tail ends with trailing bytes");
    assert.ok(!r.head.includes("C"), "head must not include trailing bytes");
    assert.ok(!r.tail.includes("A"), "tail must not include leading bytes");
    fs.unlinkSync(r.sandboxPath);
  }
});

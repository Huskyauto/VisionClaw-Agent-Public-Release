import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { wrapLargeResult } from "../../server/lib/large-output-wrap";
import { readBlob, __internals } from "../../server/lib/blob-reader";

function makePayload(lines: number): string {
  const out: string[] = [];
  for (let i = 1; i <= lines; i++) out.push(`line ${i} content-${i % 10} marker_${i}`);
  return out.join("\n");
}

test("readBlob rejects invalid label", () => {
  const r = readBlob({ label: "../etc/passwd" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid label/);
});

test("readBlob returns error for missing blob", () => {
  const r = readBlob({ label: "definitely_does_not_exist_blob_xyz" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /no blob found/);
});

function labelOf(w: ReturnType<typeof wrapLargeResult>): string {
  if (!w.truncated) throw new Error("expected wrapped/truncated result");
  return w.sandboxLabel;
}

test("readBlob head mode returns first chunk when default", () => {
  const w = wrapLargeResult({ label: "test_head_mode", payload: makePayload(2000), threshold: 1024 });
  const label = labelOf(w);
  const r = readBlob({ label });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "head");
  assert.ok((r.returnedBytes || 0) <= __internals.DEFAULT_MAX_BYTES);
  assert.equal(r.truncated, true);
  assert.ok(r.totalLines && r.totalLines >= 2000);
});

test("readBlob slice_lines returns exact range with 1-indexed prefixes", () => {
  const w = wrapLargeResult({ label: "test_slice_mode", payload: makePayload(500), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), sliceLines: [10, 14] });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "slice");
  assert.equal(r.returnedLines, 5);
  assert.match(r.content || "", /^10: line 10/);
  assert.match(r.content || "", /14: line 14/);
});

test("readBlob grep returns matched lines + context", () => {
  const w = wrapLargeResult({ label: "test_grep_mode", payload: makePayload(1000), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "marker_42$", contextLines: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "grep");
  assert.ok(r.matchedLines && r.matchedLines >= 1);
  assert.match(r.content || "", /marker_42$/m);
});

test("readBlob rejects invalid regex", () => {
  const w = wrapLargeResult({ label: "test_bad_regex", payload: makePayload(2000), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "(unclosed" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob full or head mode for medium blobs", () => {
  const w = wrapLargeResult({ label: "test_full_mode", payload: makePayload(2000), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), maxBytes: 64 * 1024 });
  assert.equal(r.ok, true);
  assert.ok(r.mode === "full" || r.mode === "head");
});

test("readBlob hard maxBytes ceiling clamps oversized requests", () => {
  const w = wrapLargeResult({ label: "test_clamp", payload: makePayload(5000), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), maxBytes: 999_999_999 });
  assert.equal(r.ok, true);
  assert.ok((r.returnedBytes || 0) <= __internals.HARD_MAX_BYTES);
});

test("readBlob rejects canonical ReDoS pattern (a+)+ at compile time", () => {
  // Native RegExp cannot be preempted mid-evaluation — so we refuse to compile
  // the canonical catastrophic-backtracking shape entirely. Even a 40-char input
  // with (a+)+$ would block the event loop for many seconds; rejection is fast.
  const evilLine = "a".repeat(40) + "!";
  const w = wrapLargeResult({ label: "test_redos", payload: evilLine + "\n" + makePayload(2000), threshold: 1024 });
  const t0 = Date.now();
  const r = readBlob({ label: labelOf(w), grep: "(a+)+$" });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `rejection took ${elapsed}ms — heuristic should be O(pattern length)`);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob safely rejects malformed patterns without throwing", () => {
  // Round-6 architect finding: malformed patterns like `)|a` previously caused
  // stack underflow inside the structural scanner. Must return clean error.
  const w = wrapLargeResult({ label: "test_malformed", payload: makePayload(200), threshold: 1024 });
  for (const bad of [")|a", "())|a", "abc)", ")(", "((("]) {
    const r = readBlob({ label: labelOf(w), grep: bad });
    assert.equal(r.ok, false, `pattern ${JSON.stringify(bad)} should be rejected`);
    assert.match(r.error || "", /invalid grep/, `pattern ${JSON.stringify(bad)} got: ${r.error}`);
  }
});

test("readBlob rejects nested-wrapper ReDoS ((a|aa))+", () => {
  // Round-5 architect bypass: alternation hidden one level deep inside a wrapping
  // group escapes a shallow [^)] regex but is still catastrophic. Structural scanner
  // must catch it.
  const evilLine = "a".repeat(40) + "!";
  const w = wrapLargeResult({ label: "test_redos_nest", payload: evilLine + "\n" + makePayload(2000), threshold: 1024 });
  const t0 = Date.now();
  const r = readBlob({ label: labelOf(w), grep: "((a|aa))+$" });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `rejection took ${elapsed}ms`);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob ACCEPTS benign quantified groups without alternation", () => {
  // Regression: structural scanner must NOT over-reject simple non-ambiguous
  // patterns like `(foo)+`. Note: patterns with an inner quantifier inside a
  // quantified group (e.g. `(\\d+\\.){3}`) ARE conservatively rejected by the
  // shallow lexical pre-check — that's an accepted false-positive tradeoff
  // because distinguishing safe-vs-catastrophic inner quantification heuristically
  // is unreliable. Agents can rewrite as a literal or simpler shape.
  const w = wrapLargeResult({ label: "test_benign", payload: "foo bar baz\nfoofoo qux\n" + makePayload(500), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "(foo)+" });
  assert.equal(r.ok, true, `(foo)+ should be accepted, got error: ${r.error}`);
});

test("readBlob rejects quantified-alternation ReDoS (a|aa)+", () => {
  // Round-4 architect bypass: this avoids the nested-quantifier heuristic but
  // is still catastrophic on adversarial input. Must be rejected at compile time.
  const evilLine = "a".repeat(40) + "!";
  const w = wrapLargeResult({ label: "test_redos_alt", payload: evilLine + "\n" + makePayload(2000), threshold: 1024 });
  const t0 = Date.now();
  const r = readBlob({ label: labelOf(w), grep: "(a|aa)+$" });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `rejection took ${elapsed}ms`);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob rejects lookaround patterns", () => {
  const w = wrapLargeResult({ label: "test_lookahead", payload: makePayload(200), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "foo(?=bar)" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob rejects backreference patterns", () => {
  const w = wrapLargeResult({ label: "test_backref", payload: makePayload(200), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "(foo)\\1" });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

test("readBlob symlink resolution rejects out-of-sandbox link", () => {
  // Create a symlink inside the sandbox pointing at /etc/hostname; reader must NOT follow.
  const dir = __internals.SANDBOX_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const linkPath = path.join(dir, "test_symlink_escape.txt");
  try { fs.unlinkSync(linkPath); } catch {}
  try {
    fs.symlinkSync("/etc/hostname", linkPath);
  } catch {
    // If symlink creation isn't permitted (some sandboxed FSes), skip.
    return;
  }
  const r = readBlob({ label: "test_symlink_escape" });
  // No matching non-symlink file exists for that label, so it should report "no blob found".
  assert.equal(r.ok, false);
  assert.match(r.error || "", /no blob found/);
  try { fs.unlinkSync(linkPath); } catch {}
});

test("readBlob rejects oversize pattern", () => {
  const w = wrapLargeResult({ label: "test_long_pat", payload: makePayload(200), threshold: 1024 });
  const r = readBlob({ label: labelOf(w), grep: "x".repeat(1024) });
  assert.equal(r.ok, false);
  assert.match(r.error || "", /invalid grep/);
});

// Cleanup: remove sandbox test artifacts so they don't accumulate.
test("cleanup test blobs", () => {
  try {
    const dir = __internals.SANDBOX_DIR;
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("test_")) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
});

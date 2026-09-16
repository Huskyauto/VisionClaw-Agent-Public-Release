/**
 * tests/unit/jury-queue-store.test.ts
 *
 * The shared lock-coordinated queue store (MEDIUM closed 2026-06-10) serializes
 * every read-modify-write against `queue.json` so overlapping producer appends and
 * the drainer's stamp write never clobber each other (the old per-writer tmp+rename
 * was atomic per-write but NOT serialized across writers → last-writer-wins drops).
 *
 * These tests exercise the path-injectable API against a throwaway temp file, so
 * they never touch the real data/jury-decisions/queue.json.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readQueueRaw, appendQueueEntries, mutateQueue } from "../../server/agentic/jury-queue-store";

const tmpFiles: string[] = [];
function tmpQueuePath(): string {
  const p = path.join(os.tmpdir(), `jq-store-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    try { fs.rmSync(p, { force: true }); } catch {}
    try { fs.rmSync(`${p}.lock`, { recursive: true, force: true }); } catch {}
  }
});

test("readQueueRaw: a missing file reads as an empty array (never throws)", () => {
  assert.deepEqual(readQueueRaw(tmpQueuePath()), []);
});

test("readQueueRaw: a corrupt file reads as empty (never throws)", () => {
  const p = tmpQueuePath();
  fs.writeFileSync(p, "{not json");
  assert.deepEqual(readQueueRaw(p), []);
});

test("appendQueueEntries: sequential appends accumulate (no last-writer-wins drop)", () => {
  const p = tmpQueuePath();
  appendQueueEntries([{ issueSlug: "a" }], p);
  appendQueueEntries([{ issueSlug: "b" }, { issueSlug: "c" }], p);
  const all = readQueueRaw<{ issueSlug: string }>(p);
  assert.deepEqual(all.map((e) => e.issueSlug), ["a", "b", "c"]);
});

test("appendQueueEntries: an empty batch is a no-op and never creates the file", () => {
  const p = tmpQueuePath();
  const n = appendQueueEntries([], p);
  assert.equal(n, 0);
  assert.equal(fs.existsSync(p), false);
});

test("appendQueueEntries: releases the lock so a later call can re-acquire", () => {
  const p = tmpQueuePath();
  appendQueueEntries([{ issueSlug: "a" }], p);
  assert.equal(fs.existsSync(`${p}.lock`), false, "lock dir must be released after the write");
  // a second append proves the lock was actually freed (would hang/throw otherwise)
  appendQueueEntries([{ issueSlug: "b" }], p);
  assert.equal(readQueueRaw(p).length, 2);
});

test("mutateQueue: re-reads under the lock and merges stamps onto a producer append that landed mid-drain", () => {
  const p = tmpQueuePath();
  // Initial file state: only entry "a" existed when the drain began.
  appendQueueEntries([{ issueSlug: "a" }], p);
  // Drainer's lock-free snapshot reads that initial state.
  const snapshot = readQueueRaw<any>(p);

  // While the (slow) drain ran, a producer appended "b" through the locked store.
  appendQueueEntries([{ issueSlug: "b" }], p);

  // Drainer stamped "a" as drained in its in-memory snapshot, then merges back.
  (snapshot[0] as any)._drained = true;
  (snapshot[0] as any)._outcome = "captured:x";
  const stamps = new Map(snapshot.filter((e: any) => e._drained).map((e: any) => [e.issueSlug, e]));
  mutateQueue((current: any[]) => {
    for (const c of current) {
      if (c._drained) continue;
      const s: any = stamps.get(c.issueSlug);
      if (s) { c._drained = s._drained; c._outcome = s._outcome; }
    }
  }, p);

  const final = readQueueRaw<any>(p);
  // The producer append "b" SURVIVED the drain write-back (not clobbered)…
  assert.deepEqual(final.map((e) => e.issueSlug).sort(), ["a", "b"]);
  // …and "a" carries the drainer's stamp.
  const a = final.find((e) => e.issueSlug === "a");
  assert.equal(a._drained, true);
  assert.equal(a._outcome, "captured:x");
  // "b" is untouched (still un-drained, available next poll).
  const b = final.find((e) => e.issueSlug === "b");
  assert.equal(b._drained, undefined);
});

test("mutateQueue: a STALE lock dir older than the stale threshold is broken and acquired", () => {
  const p = tmpQueuePath();
  fs.mkdirSync(`${p}.lock`);
  // Backdate the lock well past the 30s stale threshold.
  const old = Date.now() / 1000 - 120;
  fs.utimesSync(`${p}.lock`, old, old);
  // Should break the stale lock and complete rather than time out.
  appendQueueEntries([{ issueSlug: "after-stale" }], p);
  assert.deepEqual(readQueueRaw<any>(p).map((e) => e.issueSlug), ["after-stale"]);
});

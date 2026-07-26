import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRevertSet } from "../../scripts/lib/heal-revert-set";

// The core safety invariant of the Agentic CI Self-Healer verify-fail revert:
// a file that was ALREADY uncommitted before the fixer ran (a live editing
// session) must NEVER appear in the revert set, or the healer could roll back
// work in progress.

test("reverts only files the fixer newly dirtied (snapshot ok)", () => {
  const got = computeRevertSet({
    touchedFiles: ["server/a.ts"],
    postFixDirty: ["server/a.ts", "server/b.ts"],
    preFixDirty: new Set<string>(),
    preFixSnapshotOk: true,
  });
  assert.deepEqual(got.sort(), ["server/a.ts", "server/b.ts"]);
});

test("pre-existing dirty file is NEVER reverted, even if the fixer also dirtied it", () => {
  // server/mine.ts was already dirty (my live edit) before the healer ran.
  const got = computeRevertSet({
    touchedFiles: ["server/mine.ts", "server/fix.ts"],
    postFixDirty: ["server/mine.ts", "server/fix.ts"],
    preFixDirty: new Set(["server/mine.ts"]),
    preFixSnapshotOk: true,
  });
  assert.ok(!got.includes("server/mine.ts"), "must not revert pre-existing dirty file");
  assert.deepEqual(got, ["server/fix.ts"]);
});

test("a fixer side-effect file not in touchedFiles is still reverted when newly dirty", () => {
  const got = computeRevertSet({
    touchedFiles: ["server/reported.ts"],
    postFixDirty: ["server/reported.ts", "server/unreported.ts"],
    preFixDirty: new Set<string>(),
    preFixSnapshotOk: true,
  });
  assert.deepEqual(got.sort(), ["server/reported.ts", "server/unreported.ts"]);
});

test("pre-existing dirty unrelated file is protected from a fixer side-effect sweep", () => {
  const got = computeRevertSet({
    touchedFiles: ["server/fix.ts"],
    postFixDirty: ["server/fix.ts", "server/mine.ts", "server/other-mine.ts"],
    preFixDirty: new Set(["server/mine.ts", "server/other-mine.ts"]),
    preFixSnapshotOk: true,
  });
  assert.deepEqual(got, ["server/fix.ts"]);
});

test("snapshot-unavailable fallback reverts ONLY touchedFiles, never the git-dirty union", () => {
  // In production the self-healer fails closed before rule.fix() when the
  // snapshot is unavailable, so this branch is defensive — but it must still
  // never pull in dirty files it can't reason about.
  const got = computeRevertSet({
    touchedFiles: ["server/fix.ts"],
    postFixDirty: ["server/fix.ts", "server/mine.ts"],
    preFixDirty: new Set<string>(),
    preFixSnapshotOk: false,
  });
  assert.deepEqual(got, ["server/fix.ts"]);
  assert.ok(!got.includes("server/mine.ts"));
});

test("deduplicates a file reported as touched and also seen newly dirty", () => {
  const got = computeRevertSet({
    touchedFiles: ["server/x.ts", "server/x.ts"],
    postFixDirty: ["server/x.ts"],
    preFixDirty: new Set<string>(),
    preFixSnapshotOk: true,
  });
  assert.deepEqual(got, ["server/x.ts"]);
});

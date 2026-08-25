/**
 * tests/unit/repo-surgeon-revert.test.ts
 *
 * Task #65 — owner one-click revert of a landed self-repair fix.
 *
 * Pins revertAppliedFix on the PURE/INJECTED surface (in-memory fs, no DB / LLM
 * / shell). The revert replays a deterministic before/after RevertPlan, so it:
 *   - restores edited files exactly (incl. DELETION edits, where reverse
 *     find/replace is impossible),
 *   - REFUSES (never clobbers) when the live file drifted from the fix's `after`,
 *   - REFUSES (never destroys) a created file modified after the fix made it,
 *   - is all-or-nothing on partial failure,
 *   - is idempotent (a second revert of an already-reverted tree is a no-op).
 *
 * Run: node --import tsx --test tests/unit/repo-surgeon-revert.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  revertAppliedFix,
  type RevertFsDeps,
  type RevertPlan,
} from "../../server/agentic/repo-surgeon";

function memFs(initial: Record<string, string>): RevertFsDeps & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    writeFile: (p, c) => { files[p] = c; },
    deleteFile: (p) => { delete files[p]; },
    exists: (p) => p in files,
  };
}

test("restores an edited file to its pre-fix content", () => {
  const fs = memFs({ "server/foo.ts": "const a = 2;\n" });
  const plan: RevertPlan = { files: [{ path: "server/foo.ts", before: "const a = 1;\n", after: "const a = 2;\n" }], createdFiles: [] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.revertedFiles, ["server/foo.ts"]);
  assert.equal(fs.files["server/foo.ts"], "const a = 1;\n");
});

test("reverts a DELETION edit (replace was empty) — the case reverse find/replace can't do", () => {
  // Forward fix removed a line; `after` lacks it, `before` has it.
  const before = "keep1\nDELETED LINE\nkeep2\n";
  const after = "keep1\nkeep2\n";
  const fs = memFs({ "server/foo.ts": after });
  const plan: RevertPlan = { files: [{ path: "server/foo.ts", before, after }], createdFiles: [] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, true);
  assert.equal(fs.files["server/foo.ts"], before);
});

test("deletes a file the fix created (content matches)", () => {
  const fs = memFs({ "server/new.ts": "export const x = 1;\n" });
  const plan: RevertPlan = { files: [], createdFiles: [{ path: "server/new.ts", content: "export const x = 1;\n" }] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.deletedFiles, ["server/new.ts"]);
  assert.equal("server/new.ts" in fs.files, false);
});

test("REFUSES to delete a created file that was modified after the fix (no data loss)", () => {
  const fs = memFs({ "server/new.ts": "export const x = 1;\n// later hand edit\n" });
  const plan: RevertPlan = { files: [], createdFiles: [{ path: "server/new.ts", content: "export const x = 1;\n" }] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /modified after the fix/);
  // File untouched.
  assert.equal(fs.files["server/new.ts"], "export const x = 1;\n// later hand edit\n");
});

test("REFUSES to revert an edited file that drifted from the fix's `after` (won't clobber later edits)", () => {
  const fs = memFs({ "server/foo.ts": "const a = 2;\n// someone added this later\n" });
  const plan: RevertPlan = { files: [{ path: "server/foo.ts", before: "const a = 1;\n", after: "const a = 2;\n" }], createdFiles: [] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /changed since the fix landed/);
  assert.equal(fs.files["server/foo.ts"], "const a = 2;\n// someone added this later\n");
});

test("idempotent: reverting a tree already at `before` is a clean no-op", () => {
  const fs = memFs({ "server/foo.ts": "const a = 1;\n" });
  const plan: RevertPlan = { files: [{ path: "server/foo.ts", before: "const a = 1;\n", after: "const a = 2;\n" }], createdFiles: [] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.revertedFiles, []); // nothing to restore — already pre-fix
  assert.equal(fs.files["server/foo.ts"], "const a = 1;\n");
});

test("all-or-nothing: a stale second file aborts the whole revert before mutating anything", () => {
  const fs = memFs({ "server/a.ts": "A2\n", "server/b.ts": "B-DRIFTED\n" });
  const plan: RevertPlan = {
    files: [
      { path: "server/a.ts", before: "A1\n", after: "A2\n" },
      { path: "server/b.ts", before: "B1\n", after: "B2\n" }, // live is B-DRIFTED → stale
    ],
    createdFiles: [],
  };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, false);
  // a.ts must NOT have been touched (pre-flight aborts before any write).
  assert.equal(fs.files["server/a.ts"], "A2\n");
  assert.equal(fs.files["server/b.ts"], "B-DRIFTED\n");
});

test("mixed edit + created-file revert succeeds together", () => {
  const fs = memFs({ "server/a.ts": "A2\n", "server/new.ts": "NEW\n" });
  const plan: RevertPlan = {
    files: [{ path: "server/a.ts", before: "A1\n", after: "A2\n" }],
    createdFiles: [{ path: "server/new.ts", content: "NEW\n" }],
  };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, true);
  assert.equal(fs.files["server/a.ts"], "A1\n");
  assert.equal("server/new.ts" in fs.files, false);
});

test("refuses an out-of-repo path", () => {
  const fs = memFs({ "../../etc/passwd": "root\n" });
  const plan: RevertPlan = { files: [{ path: "../../etc/passwd", before: "x", after: "root\n" }], createdFiles: [] };
  const r = revertAppliedFix(plan, fs);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /out-of-repo/);
});

test("empty plan is a no-op failure (nothing to revert)", () => {
  const r = revertAppliedFix({ files: [], createdFiles: [] }, memFs({}));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /No stored undo plan/);
});

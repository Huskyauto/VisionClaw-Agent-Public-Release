/**
 * tests/unit/repo-surgeon-conformance.test.ts
 *
 * Task #95 — plan-vs-diff conformance gate (Harness Handbook Γ-vs-Δ borrow,
 * arXiv:2607.13285). The repair proposal's DECLARED edit set (edits+newFiles)
 * must match the files the working tree ACTUALLY changed after applyProposal:
 *   - extra undeclared files  ⇒ reject/rollback the attempt (fail closed)
 *   - missing declared files  ⇒ plan-drift warning, attempt still lands
 *   - no git snapshot         ⇒ gate SKIPPED and recorded as unchecked
 * The conformance outcome is persisted in the attempt record (outcomeDetail)
 * so the Harness Health card can surface drift rate.
 *
 * All on the pure/injected surface — no DB, no LLM, no shell, no real git.
 *
 * Run: node --import tsx --test tests/unit/repo-surgeon-conformance.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkEditConformance,
  parsePorcelainPaths,
  runRepoSurgeon,
  type FixProposal,
  type RepoSurgeonIncident,
  type RepoSurgeonDeps,
} from "../../server/agentic/repo-surgeon";

function proposal(over: Partial<FixProposal> = {}): FixProposal {
  return {
    diagnosis: "d",
    rootCause: "rc",
    precedent: "p",
    edits: [{ path: "server/foo.ts", find: "const a = 1;", replace: "const a = 2;" }],
    ...over,
  };
}

function incident(over: Partial<RepoSurgeonIncident> = {}): RepoSurgeonIncident {
  return { tenantId: 1, incidentId: 42, error: "TypeError: x is not a function", ...over };
}

function stubDeps(over: Partial<RepoSurgeonDeps> = {}): {
  deps: Partial<RepoSurgeonDeps>;
  files: Record<string, string>;
  attempts: any[];
} {
  const files: Record<string, string> = { "server/foo.ts": "const a = 1;\n" };
  const attempts: any[] = [];
  const deps: Partial<RepoSurgeonDeps> = {
    readFile: (p) => files[p] ?? "",
    writeFile: (p, c) => { files[p] = c; },
    deleteFile: (p) => { delete files[p]; },
    exists: (p) => p in files,
    runCommand: () => ({ ok: true, output: "" }),
    rerunTool: async () => ({ ok: true, output: "" }),
    countPriorFailedAttempts: async () => 0,
    countFixesThisHour: async () => 0,
    recordAttempt: async (row) => { attempts.push(row); return attempts.length; },
    requestApproval: async () => {},
    escalate: async () => {},
    propose: async () => proposal(),
    // Explicitly disable the default prior-collapse tracker: these tests
    // intentionally re-propose identical diffs to exercise the conformance
    // gate on every attempt (an explicit `undefined` overrides defaultDeps()).
    collapseTracker: undefined,
    ...over,
  };
  return { deps, files, attempts };
}

// ── Pure helper: checkEditConformance ────────────────────────────────────────

test("checkEditConformance: exact match ⇒ ok, no extra, no missing", () => {
  const c = checkEditConformance(["server/foo.ts"], ["server/foo.ts"]);
  assert.equal(c.checked, true);
  assert.equal(c.ok, true);
  assert.deepEqual(c.extraFiles, []);
  assert.deepEqual(c.missingFiles, []);
});

test("checkEditConformance: undeclared extra file ⇒ NOT ok (fail closed)", () => {
  const c = checkEditConformance(["server/foo.ts"], ["server/foo.ts", "server/sneaky.ts"]);
  assert.equal(c.ok, false);
  assert.deepEqual(c.extraFiles, ["server/sneaky.ts"]);
  assert.deepEqual(c.missingFiles, []);
});

test("checkEditConformance: missing declared file ⇒ ok but reported as drift", () => {
  const c = checkEditConformance(["server/foo.ts", "server/bar.ts"], ["server/foo.ts"]);
  assert.equal(c.ok, true); // missing is a warning, not a rejection
  assert.deepEqual(c.extraFiles, []);
  assert.deepEqual(c.missingFiles, ["server/bar.ts"]);
});

test("checkEditConformance: declared file already dirty pre-apply (in postDirty, not in fixer delta) is NOT missing", () => {
  const c = checkEditConformance(
    ["server/foo.ts", "server/already-dirty.ts"],
    ["server/foo.ts"], // fixer delta excludes pre-existing dirt by construction
    ["server/foo.ts", "server/already-dirty.ts", "server/unrelated-preexisting.ts"],
  );
  assert.equal(c.ok, true);
  assert.deepEqual(c.missingFiles, []);
  // unrelated pre-existing dirt is NOT extra — it's not in the fixer delta
  assert.deepEqual(c.extraFiles, []);
});

test("checkEditConformance: path normalization (./, backslash, //)", () => {
  const c = checkEditConformance(["./server/foo.ts"], ["server\\foo.ts", "server//foo.ts"]);
  assert.equal(c.ok, true);
  assert.deepEqual(c.missingFiles, []);
});

// ── Pure helper: parsePorcelainPaths ─────────────────────────────────────────

test("parsePorcelainPaths parses modified / added / renamed lines", () => {
  const out = [
    " M server/foo.ts",
    "?? server/new.ts",
    "R  server/old.ts -> server/renamed.ts",
    "",
  ].join("\n");
  assert.deepEqual(
    parsePorcelainPaths(out).sort(),
    ["server/foo.ts", "server/new.ts", "server/old.ts", "server/renamed.ts"],
  );
});

// ── Orchestrator integration ─────────────────────────────────────────────────

test("extra undeclared file in the real diff ⇒ rolled_back (fail closed) + rollback restores tree + conformance recorded", async () => {
  const { deps, files, attempts } = stubDeps();
  // git sees: pre-apply clean; post-apply the declared file AND a sneaky extra
  // (even calls = pre-snapshot, odd calls = post-snapshot, on every attempt).
  let call = 0;
  deps.listDirtyFiles = () => (call++ % 2 === 0 ? [] : ["server/foo.ts", "server/sneaky.ts", "server/foo.ts", "server/sneaky.ts"]);
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "rolled_back");
  assert.match(res.reasons.join(" "), /undeclared file\(s\) changed.*server\/sneaky\.ts/);
  // rollback happened: file back to original content
  assert.equal(files["server/foo.ts"], "const a = 1;\n");
  // conformance recorded in the attempt ledger
  const rec = attempts.find((a) => a.outcomeDetail?.conformance);
  assert.ok(rec, "attempt record carries conformance");
  assert.equal(rec.outcomeDetail.conformance.ok, false);
  assert.deepEqual(rec.outcomeDetail.conformance.extraFiles, ["server/sneaky.ts"]);
});

test("missing declared file ⇒ plan-drift warning only, fix still lands, drift recorded", async () => {
  const { deps, attempts } = stubDeps({
    propose: async () => proposal({
      edits: [
        { path: "server/foo.ts", find: "const a = 1;", replace: "const a = 2;" },
      ],
      // Declares a second file it never actually changes (no-op newFile edit is
      // hard to fake with this stub; declare via edits on an identical file).
      newFiles: [{ path: "server/bar.ts", content: "export const b = 1;\n" }],
    }),
  });
  let call = 0;
  // git only ever sees foo.ts change (bar.ts write invisible to this fake git).
  deps.listDirtyFiles = () => (call++ === 0 ? [] : ["server/foo.ts"]);
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "landed");
  const rec = attempts.find((a) => a.outcome === "landed");
  assert.ok(rec.outcomeDetail.conformance.checked);
  assert.equal(rec.outcomeDetail.conformance.ok, true);
  assert.deepEqual(rec.outcomeDetail.conformance.missingFiles, ["server/bar.ts"]);
});

test("matching diff ⇒ lands with conformance ok recorded", async () => {
  const { deps, attempts } = stubDeps();
  let call = 0;
  deps.listDirtyFiles = () => (call++ === 0 ? [] : ["server/foo.ts"]);
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "landed");
  const rec = attempts.find((a) => a.outcome === "landed");
  assert.equal(rec.outcomeDetail.conformance.checked, true);
  assert.equal(rec.outcomeDetail.conformance.ok, true);
  assert.deepEqual(rec.outcomeDetail.conformance.extraFiles, []);
  assert.deepEqual(rec.outcomeDetail.conformance.missingFiles, []);
});

test("pre-existing workspace dirt is never flagged as extra", async () => {
  const { deps, attempts } = stubDeps();
  let call = 0;
  deps.listDirtyFiles = () =>
    call++ === 0
      ? ["server/live-edit-session.ts"] // dirty BEFORE the fix ran
      : ["server/live-edit-session.ts", "server/foo.ts"];
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "landed");
  const rec = attempts.find((a) => a.outcome === "landed");
  assert.equal(rec.outcomeDetail.conformance.ok, true);
  assert.deepEqual(rec.outcomeDetail.conformance.extraFiles, []);
});

test("no git snapshot available ⇒ gate skipped, recorded as UNCHECKED (never silently ok)", async () => {
  const { deps, attempts } = stubDeps();
  deps.listDirtyFiles = () => null; // git unavailable
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "landed");
  const rec = attempts.find((a) => a.outcome === "landed");
  assert.equal(rec.outcomeDetail.conformance.checked, false);
  assert.match(rec.outcomeDetail.conformance.skippedReason, /snapshot unavailable/);
});

test("listDirtyFiles absent (hermetic default) ⇒ gate skipped as unchecked", async () => {
  const { deps, attempts } = stubDeps();
  deps.listDirtyFiles = undefined;
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "landed");
  const rec = attempts.find((a) => a.outcome === "landed");
  assert.equal(rec.outcomeDetail.conformance.checked, false);
});

test("conformance rollback is a FAILED attempt: feeds feedback + counts toward the 2-attempt stop", async () => {
  const proposals: string[] = [];
  const { deps } = stubDeps({
    propose: async (_i, priorFailure) => {
      proposals.push(priorFailure || "");
      return proposal();
    },
  });
  let call = 0;
  // Every post-apply snapshot shows a sneaky extra file ⇒ both attempts fail.
  deps.listDirtyFiles = () => (call++ % 2 === 0 ? [] : ["server/foo.ts", "server/sneaky.ts"]);
  const res = await runRepoSurgeon(incident(), deps);
  assert.equal(res.outcome, "rolled_back");
  assert.equal(res.attempts, 2);
  assert.equal(proposals.length, 2);
  assert.match(proposals[1], /STRAYED OUTSIDE THE DECLARED EDIT SET/);
});

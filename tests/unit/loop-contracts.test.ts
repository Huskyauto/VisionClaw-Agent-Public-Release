/**
 * tests/unit/loop-contracts.test.ts
 *
 * CI guard for the autonomous-loop contracts (server/loop-contracts.ts), mirroring
 * the Loop Doctor (scripts/loop-contract-audit.ts). Enforces Forward Future's
 * Loop Library doctrine: every loop must declare an objective, a check, feedback,
 * at least one stop condition, and at least one escalation/handoff — and any
 * mutating/destructive loop must fail CLOSED.
 *
 * Pure logic, no DB / no network — node:test never hangs.
 *
 * Run: node --import tsx --test tests/unit/loop-contracts.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOOP_CONTRACTS,
  getLoopContract,
  auditLoopCoverage,
  parseReplitWorkflowNames,
  IN_PROCESS_LOOPS,
  proveReadiness,
  computeReadinessLevel,
} from "../../server/loop-contracts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nonEmpty = (s: unknown) => typeof s === "string" && s.trim().length > 0;

test("at least the known autonomous loops are registered", () => {
  assert.ok(LOOP_CONTRACTS.length >= 8, `expected >= 8 loop contracts, got ${LOOP_CONTRACTS.length}`);
});

test("every agentic-loop workflow in .replit has a contract (completeness gate)", () => {
  const cov = auditLoopCoverage();
  if (!cov.checked) return; // .replit absent (e.g. prod bundle) — can't enforce here
  assert.deepEqual(
    cov.missing,
    [],
    `uncontracted autonomous-loop workflow(s): ${cov.missing.join(", ")} — add a LoopContract or list in NON_LOOP_WORKFLOWS`,
  );
});

test("no contract points at a workflow absent from .replit (no orphans)", () => {
  const cov = auditLoopCoverage();
  if (!cov.checked) return;
  assert.deepEqual(cov.orphan, [], `orphan contract workflow(s): ${cov.orphan.join(", ")}`);
});

test("every in-process loop in IN_PROCESS_LOOPS has a contract (always checkable)", () => {
  const cov = auditLoopCoverage();
  assert.deepEqual(
    cov.missingInProcess,
    [],
    `in-process loop(s) without a contract: ${cov.missingInProcess.join(", ")}`,
  );
});

test("no in-process contract is missing from IN_PROCESS_LOOPS (no orphans)", () => {
  const cov = auditLoopCoverage();
  assert.deepEqual(
    cov.orphanInProcess,
    [],
    `in-process contract(s) not in IN_PROCESS_LOOPS: ${cov.orphanInProcess.join(", ")}`,
  );
});

test("IN_PROCESS_LOOPS ids are all workflow:null contracts", () => {
  for (const id of IN_PROCESS_LOOPS) {
    const c = getLoopContract(id);
    assert.ok(c, `IN_PROCESS_LOOPS id '${id}' has no contract`);
    assert.equal(c!.workflow, null, `in-process loop '${id}' must have workflow: null`);
  }
});

test("parseReplitWorkflowNames extracts names across .replit shape variants", () => {
  // double-quoted, single-quoted, extra whitespace, name not first key, and a
  // trailing non-workflow section that must NOT leak a name.
  const sample = [
    "[nix]",
    'channel = "stable-24_05"',
    "",
    "[[workflows.workflow]]",
    'name = "Alpha Loop"',
    'mode = "sequential"',
    "",
    "[[workflows.workflow]]",
    "mode = 'parallel'",
    "name = 'Beta Loop'",
    "",
    "[[workflows.workflow]]",
    '   name   =   "Gamma Loop"   ',
    "",
    "[deployment]",
    'run = "npm start"',
    'name = "not-a-workflow"',
  ].join("\n");
  assert.deepEqual(parseReplitWorkflowNames(sample), ["Alpha Loop", "Beta Loop", "Gamma Loop"]);
});

test("parseReplitWorkflowNames returns [] for content with no workflows", () => {
  assert.deepEqual(parseReplitWorkflowNames('[nix]\nchannel = "stable"\n'), []);
});

test("loop ids are unique", () => {
  const ids = LOOP_CONTRACTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate loop id");
});

for (const c of LOOP_CONTRACTS) {
  test(`contract '${c.id}' answers the four loop questions`, () => {
    assert.ok(nonEmpty(c.id), "id");
    assert.ok(nonEmpty(c.name), "name");
    assert.ok(nonEmpty(c.trigger), "trigger");
    assert.ok(nonEmpty(c.objective), "objective (Q1)");
    assert.ok(nonEmpty(c.check), "check (Q2)");
    assert.ok(nonEmpty(c.feedback), "feedback (Q3)");
    assert.ok(c.stop.filter(nonEmpty).length >= 1, "stop condition (Q4 — no unbounded loops)");
    assert.ok(c.escalate.filter(nonEmpty).length >= 1, "escalation/handoff (Q4 — must be able to ask a human)");
  });

  test(`contract '${c.id}' has a valid authority + safety posture`, () => {
    assert.ok(["read-only", "self-healing", "mutating", "destructive"].includes(c.authority), "authority enum");
    assert.ok(["open", "closed"].includes(c.failMode), "failMode enum");
    if (c.authority === "mutating" || c.authority === "destructive") {
      assert.equal(c.failMode, "closed", `${c.authority} loop must fail CLOSED`);
    }
  });

  test(`contract '${c.id}' points at a source file that exists`, () => {
    assert.ok(nonEmpty(c.source), "source path");
    assert.ok(fs.existsSync(path.resolve(REPO_ROOT, c.source)), `source missing: ${c.source}`);
  });

  test(`contract '${c.id}' declares an independent evaluator (no nodding loop)`, () => {
    assert.ok(["independent", "self", "deterministic"].includes(c.verifier), "verifier enum");
    assert.notEqual(
      c.verifier,
      "self",
      "a loop must not grade its own output — generation and judgment must be separable (Loop Engineering 2026)",
    );
  });

  test(`contract '${c.id}' has a bounded spend posture (no token blowout)`, () => {
    assert.ok(["capped", "bounded", "none", "unbounded"].includes(c.spend), "spend enum");
    assert.notEqual(c.spend, "unbounded", "autonomous paid spend must have a ceiling");
  });

  test(`contract '${c.id}' spend "capped" is proven, not just declared`, () => {
    if (c.spend !== "capped") return; // only the strongest claim must be backed by evidence
    const src = fs.readFileSync(path.resolve(REPO_ROOT, c.source), "utf8");
    assert.ok(
      src.includes("claimAutonomousBudget"),
      `${c.source} claims spend "capped" but never references the atomic claim-before-spend seam`,
    );
  });
}

test("getLoopContract resolves a known id and rejects an unknown one", () => {
  assert.ok(getLoopContract(LOOP_CONTRACTS[0].id));
  assert.equal(getLoopContract("does-not-exist"), undefined);
});

// ── Readiness rubric (loop-engineering borrow) ────────────────────────────────

for (const c of LOOP_CONTRACTS) {
  test(`contract '${c.id}' declared readiness evidence is proven in source (no lying labels)`, () => {
    const { unproven } = proveReadiness(c, REPO_ROOT);
    assert.deepEqual(unproven, [], `declared-but-absent readiness token(s): ${unproven.join("; ")}`);
  });

  test(`contract '${c.id}' documents report-only-first if it acts`, () => {
    if (c.authority === "read-only") return;
    assert.ok(
      nonEmpty(c.readiness?.reportOnlyFirst),
      `${c.id} is '${c.authority}' but has no readiness.reportOnlyFirst note — every acting loop must document how it shipped report-only first`,
    );
  });

  test(`contract '${c.id}' grades at least L2 (act-ready) with proven evidence`, () => {
    const { proof } = proveReadiness(c, REPO_ROOT);
    const level = computeReadinessLevel(c, { contractClean: true, spendProven: true, proof });
    assert.ok(["L2", "L3"].includes(level), `${c.id} graded ${level} — a registered loop must be at least act-ready`);
  });
}

test("computeReadinessLevel rubric boundaries", () => {
  const base = LOOP_CONTRACTS[0];
  const allProof = { killSwitch: true, attemptCap: true, runLog: true };
  const noProof = { killSwitch: false, attemptCap: false, runLog: false };
  assert.equal(computeReadinessLevel(base, { contractClean: false, spendProven: true, proof: allProof }), "L0");
  assert.equal(
    computeReadinessLevel({ ...base, verifier: "self" }, { contractClean: true, spendProven: true, proof: allProof }),
    "L1",
    "self-verifier caps at L1",
  );
  assert.equal(
    computeReadinessLevel({ ...base, spend: "capped" }, { contractClean: true, spendProven: false, proof: allProof }),
    "L1",
    "unproven capped spend caps at L1",
  );
  assert.equal(computeReadinessLevel(base, { contractClean: true, spendProven: true, proof: noProof }), "L2");
  assert.equal(computeReadinessLevel(base, { contractClean: true, spendProven: true, proof: allProof }), "L3");
});

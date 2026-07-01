import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGradeDecision,
  failOpenCompletionGate,
  type CompletionGateResult,
} from "../../server/agentic/grade-decision";

// Rubric path: no completion gate ⇒ the per-format rubric verdict stands.
test("rubric path: passing rubric stands (no gate)", () => {
  const d = resolveGradeDecision({ ok: true, score: 90, passingBar: 85 }, undefined);
  assert.equal(d.gateRan, false);
  assert.equal(d.finalOk, true);
  assert.match(d.nextStep, /Grade PASSED/);
});

test("rubric path: failing rubric stays failed (no gate)", () => {
  const d = resolveGradeDecision({ ok: false, score: 40, passingBar: 85 }, undefined);
  assert.equal(d.gateRan, false);
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /Grade FAILED \(score 40\/85\)/);
});

// Non-rubric path: the independent completion judge REPLACES the trivial verdict.
test("custom path: judge verdict 'done' passes even when rubric ok was false", () => {
  const gate: CompletionGateResult = { verdict: "done", reason: "met", degraded: false };
  const d = resolveGradeDecision({ ok: false, score: 0, passingBar: 70 }, gate);
  assert.equal(d.gateRan, true);
  assert.equal(d.finalOk, true);
  assert.match(d.nextStep, /Grade PASSED/);
});

test("custom path: judge verdict 'incomplete' blocks even when rubric ok was true", () => {
  const gate: CompletionGateResult = {
    verdict: "incomplete",
    reason: "missing the requested summary",
    degraded: false,
    unmet: ["no summary section", "wrong format"],
  };
  const d = resolveGradeDecision({ ok: true, score: 99, passingBar: 70 }, gate);
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /did NOT pass \(verdict: incomplete\)/);
  assert.match(d.nextStep, /missing the requested summary/);
  assert.match(d.nextStep, /Unmet criteria: no summary section; wrong format\./);
});

test("custom path: judge verdict 'halt' blocks", () => {
  const gate: CompletionGateResult = { verdict: "halt", reason: "budget exceeded", degraded: false };
  const d = resolveGradeDecision({ ok: false, score: 0, passingBar: 70 }, gate);
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /verdict: halt/);
});

// Degraded judge ⇒ fail-OPEN (passes) regardless of verdict.
test("custom path: degraded judge fails OPEN (passes) with double-check warning", () => {
  const gate: CompletionGateResult = { verdict: "incomplete", reason: "judge unavailable", degraded: true };
  const d = resolveGradeDecision({ ok: false, score: 0, passingBar: 70 }, gate);
  assert.equal(d.finalOk, true, "degraded judge must pass (fail-open), not block");
  assert.match(d.nextStep, /fail-open/);
  assert.match(d.nextStep, /double-check/);
});

// The setup-exception gate is a passing, degraded gate.
test("failOpenCompletionGate(): exception path passes as degraded", () => {
  const gate = failOpenCompletionGate();
  assert.equal(gate.degraded, true);
  assert.equal(gate.verdict, "done");
  const d = resolveGradeDecision({ ok: false, score: 0, passingBar: 70 }, gate);
  assert.equal(d.finalOk, true, "exception fail-open must NOT hard-fail a custom deliverable");
  assert.equal(d.gateRan, true);
  assert.match(d.nextStep, /fail-open/);
});

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

// ── Bounded K-step grader-driven revise loop ────────────────────────────────

test("bounded loop: first rubric failure asks to revise AGAIN (attempt 1 of 3)", () => {
  const d = resolveGradeDecision({ ok: false, score: 60, passingBar: 85 }, undefined, {
    attempt: 1,
    maxAttempts: 3,
    priorScores: [],
  });
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /Attempt 1 of 3/);
  assert.match(d.nextStep, /Auto-revise AGAIN/);
  assert.match(d.nextStep, /prev_scores=\[60\]/);
  assert.match(d.nextStep, /attempt=2/);
});

test("bounded loop: improving mid-loop keeps going and carries the trajectory", () => {
  const d = resolveGradeDecision({ ok: false, score: 75, passingBar: 85 }, undefined, {
    attempt: 2,
    maxAttempts: 3,
    priorScores: [60],
  });
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /Attempt 2 of 3/);
  assert.match(d.nextStep, /improving: 60 → 75/);
  assert.match(d.nextStep, /Score trajectory: 60 → 75/);
  assert.match(d.nextStep, /prev_scores=\[60,75\]/);
  assert.match(d.nextStep, /attempt=3/);
});

test("bounded loop: plateau/regression stops early and escalates to owner-notification", () => {
  const d = resolveGradeDecision({ ok: false, score: 58, passingBar: 85 }, undefined, {
    attempt: 2,
    maxAttempts: 3,
    priorScores: [60],
  });
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /stopped improving \(60 → 58\)/);
  assert.match(d.nextStep, /plateauing/);
  assert.match(d.nextStep, /owner-notification/);
  assert.doesNotMatch(d.nextStep, /Auto-revise AGAIN/);
});

test("bounded loop: reaching the attempt cap escalates even while still improving", () => {
  const d = resolveGradeDecision({ ok: false, score: 80, passingBar: 85 }, undefined, {
    attempt: 3,
    maxAttempts: 3,
    priorScores: [60, 75],
  });
  assert.equal(d.finalOk, false);
  assert.match(d.nextStep, /reached the 3-attempt cap/);
  assert.match(d.nextStep, /Score trajectory: 60 → 75 → 80/);
  assert.match(d.nextStep, /owner-notification/);
  assert.doesNotMatch(d.nextStep, /Auto-revise AGAIN/);
});

test("bounded loop: max_attempts is hard-capped at 5 (99 → 5)", () => {
  const d = resolveGradeDecision({ ok: false, score: 60, passingBar: 85 }, undefined, {
    attempt: 1,
    maxAttempts: 99,
    priorScores: [],
  });
  assert.match(d.nextStep, /Attempt 1 of 5/);
});

test("bounded loop: non-rubric gate failure is attempt-bounded and preserves verdict detail", () => {
  const gate: CompletionGateResult = {
    verdict: "incomplete",
    reason: "missing the requested summary",
    degraded: false,
    unmet: ["no summary section", "wrong format"],
  };
  // Below cap: revise again, carrying all the original verdict detail.
  const mid = resolveGradeDecision({ ok: true, score: 99, passingBar: 70 }, gate, {
    attempt: 1,
    maxAttempts: 3,
  });
  assert.equal(mid.finalOk, false);
  assert.match(mid.nextStep, /did NOT pass \(verdict: incomplete\)/);
  assert.match(mid.nextStep, /Unmet criteria: no summary section; wrong format\./);
  assert.match(mid.nextStep, /attempt 1 of 3/);
  assert.match(mid.nextStep, /re-grade with attempt=2/);
  // At cap: escalate.
  const capped = resolveGradeDecision({ ok: true, score: 99, passingBar: 70 }, gate, {
    attempt: 3,
    maxAttempts: 3,
  });
  assert.match(capped.nextStep, /reached the 3-attempt cap/);
  assert.match(capped.nextStep, /owner-notification/);
});

test("bounded loop: omitting attemptContext defaults to attempt 1 of 3 and still revises", () => {
  const d = resolveGradeDecision({ ok: false, score: 40, passingBar: 85 }, undefined);
  assert.match(d.nextStep, /Grade FAILED \(score 40\/85\)/);
  assert.match(d.nextStep, /Attempt 1 of 3/);
  assert.match(d.nextStep, /Auto-revise AGAIN/);
});

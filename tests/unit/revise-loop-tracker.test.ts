import test from "node:test";
import assert from "node:assert/strict";
import {
  reviseLoopKey,
  reconcileReviseAttempt,
  recordReviseOutcome,
  __resetReviseTrackerForTest,
} from "../../server/agentic/revise-loop-tracker";
import { resolveGradeDecision } from "../../server/agentic/grade-decision";

function fresh() {
  __resetReviseTrackerForTest();
}

test("reviseLoopKey: stable + case/space-insensitive on type", () => {
  assert.equal(reviseLoopKey(7, 42, "Video"), reviseLoopKey(7, 42, " video "));
  assert.notEqual(reviseLoopKey(7, 42, "video"), reviseLoopKey(7, 43, "video"));
  assert.notEqual(reviseLoopKey(7, 42, "video"), reviseLoopKey(8, 42, "video"));
});

test("reconcile: no prior state ⇒ attempt 1, empty trajectory", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  const r = reconcileReviseAttempt(k, undefined, undefined);
  assert.equal(r.attempt, 1);
  assert.deepEqual(r.priorScores, []);
});

test("reconcile never shrinks: caller resets attempt=1 but server has climbed", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  // Simulate two prior recorded (still-open) attempts.
  recordReviseOutcome(k, 1, [], 60, false);
  recordReviseOutcome(k, 2, [60], 70, false);
  // Caller lies with attempt=1 / empty prev_scores.
  const r = reconcileReviseAttempt(k, 1, []);
  assert.equal(r.attempt, 3, "must be max(caller=1, server=2 + 1) = 3");
  assert.deepEqual(r.priorScores, [60, 70], "server trajectory wins over the shorter caller one");
});

test("reconcile honors a HIGHER caller attempt (caller ahead of server)", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "pdf");
  const r = reconcileReviseAttempt(k, 4, [50, 60, 70]);
  assert.equal(r.attempt, 4);
  assert.deepEqual(r.priorScores, [50, 60, 70]);
});

test("recordReviseOutcome: loopEnded clears the key (fresh deliverable later starts clean)", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  recordReviseOutcome(k, 1, [], 60, false);
  recordReviseOutcome(k, 2, [60], 90, true); // passed → clear
  const r = reconcileReviseAttempt(k, undefined, undefined);
  assert.equal(r.attempt, 1, "key cleared ⇒ next loop restarts at 1");
  assert.deepEqual(r.priorScores, []);
});

test("TTL eviction: stale entries drop after the eviction window", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  const t0 = 1_000_000;
  recordReviseOutcome(k, 2, [60], 70, false, t0);
  // Just inside the window (1 h later): entry survives, attempt still climbs.
  const stillLive = reconcileReviseAttempt(k, undefined, undefined, t0 + 60 * 60 * 1000);
  assert.equal(stillLive.attempt, 3, "within window ⇒ authoritative attempt persists");
  // Past the window (7 h later): reconcile evicts it first.
  const r = reconcileReviseAttempt(k, undefined, undefined, t0 + 7 * 60 * 60 * 1000);
  assert.equal(r.attempt, 1, "stale entry evicted ⇒ back to attempt 1");
});

// ── The architect's #3: prove "no infinite revise" at the SYSTEM level ───────
// A dishonest caller sends attempt=1 / prev_scores=[] on EVERY call. Without the
// server backstop the loop would revise forever. With it, the authoritative
// attempt climbs and resolveGradeDecision escalates by the cap regardless.
test("backstop: caller that always resets STILL escalates by the attempt cap", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  const decisions: { escalated: boolean; nextStep: string }[] = [];
  // Grader keeps returning a strictly-improving-but-still-failing score, so the
  // ONLY thing that can stop the loop is the attempt cap.
  const scores = [60, 65, 70, 75, 80, 85 - 1, 83, 82];
  for (let i = 0; i < 8; i++) {
    const score = scores[i];
    // Caller ALWAYS lies: attempt=1, prev_scores=[].
    const rec = reconcileReviseAttempt(k, 1, []);
    const d = resolveGradeDecision(
      { ok: false, score, passingBar: 85 },
      undefined,
      { attempt: rec.attempt, maxAttempts: 3, priorScores: rec.priorScores },
    );
    recordReviseOutcome(k, rec.attempt, rec.priorScores, score, d.finalOk || d.escalated);
    decisions.push({ escalated: d.escalated, nextStep: d.nextStep });
    if (d.finalOk || d.escalated) break;
  }
  const escalatedAt = decisions.findIndex((d) => d.escalated);
  assert.notEqual(escalatedAt, -1, "must escalate — never loop forever");
  assert.ok(escalatedAt <= 2, `must escalate by the 3-attempt cap (index ${escalatedAt})`);
  assert.match(decisions[escalatedAt].nextStep, /reached the 3-attempt cap/);
  assert.match(decisions[escalatedAt].nextStep, /owner-notification/);
});

test("backstop: honest caller loop still improves and carries trajectory across calls", () => {
  fresh();
  const k = reviseLoopKey(1, 1, "video");
  // Attempt 1: score 60, fails, revise again.
  let rec = reconcileReviseAttempt(k, undefined, undefined);
  let d = resolveGradeDecision({ ok: false, score: 60, passingBar: 85 }, undefined, {
    attempt: rec.attempt, maxAttempts: 3, priorScores: rec.priorScores,
  });
  assert.equal(rec.attempt, 1);
  assert.equal(d.escalated, false);
  recordReviseOutcome(k, rec.attempt, rec.priorScores, 60, d.finalOk || d.escalated);
  // Attempt 2 (caller threads correctly): score 90 → passes, loop clears.
  rec = reconcileReviseAttempt(k, 2, [60]);
  assert.equal(rec.attempt, 2);
  assert.deepEqual(rec.priorScores, [60]);
  d = resolveGradeDecision({ ok: false, score: 90, passingBar: 85 }, undefined, {
    attempt: rec.attempt, maxAttempts: 3, priorScores: rec.priorScores,
  });
  // score 90 >= 85 would be res.ok=true in reality; here res.ok=false forces the
  // failing branch but 90 > 60 so it keeps improving (still a valid trajectory).
  assert.equal(d.escalated, false);
  assert.match(d.nextStep, /improving: 60 → 90/);
});

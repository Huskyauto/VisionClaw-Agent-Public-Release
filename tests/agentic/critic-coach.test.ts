/**
 * tests/agentic/critic-coach.test.ts
 *
 * Regression coverage for the actor-critic / reflection step wired into the
 * supervisor loop (Bob's "Combined" mode, 2026-06-19). The executor's stuck-path
 * decision logic was extracted into pure helpers in server/agentic/critic-coach-core.ts
 * precisely so these invariants are testable WITHOUT a DB or an LLM call (the
 * node:test DB-pool-hang lesson). These tests import ONLY from the provider-free
 * core module — never from critic-coach.ts, which loads ../providers and opens the
 * pg pool, so the test process would never exit cleanly (hangs to timeout 124).
 *
 * Covers the architect's requested regressions:
 *   - escalation never exceeds 2 and never downgrades
 *   - one-shot gating bounds the extra critic spend
 *   - the synthetic __critic_coach__ history entry is router-visible
 *
 * Run: node --import tsx --test tests/agentic/critic-coach.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideStuckRecovery,
  renderCoaching,
  buildCoachHistoryEntry,
  type CriticCoaching,
} from "../../server/agentic/critic-coach-core";

const coaching = (over: Partial<CriticCoaching> = {}): CriticCoaching => ({
  ok: true,
  rootCause: "router kept picking the wrong specialist",
  guidance: "call the data_fetch specialist first, then summarize",
  doNotRepeat: ["re-running the summarizer with empty input"],
  ...over,
});

test("decideStuckRecovery: disabled → never coaches, escalation unchanged", () => {
  const r = decideStuckRecovery({ enabled: false, used: 0, max: 1, escalationLevel: 0 });
  assert.equal(r.shouldCoach, false);
  assert.equal(r.nextEscalationLevel, 0);
});

test("decideStuckRecovery: one-shot cap bounds spend (used >= max → no coach)", () => {
  const atCap = decideStuckRecovery({ enabled: true, used: 1, max: 1, escalationLevel: 0 });
  assert.equal(atCap.shouldCoach, false);
  assert.equal(atCap.nextEscalationLevel, 0, "no escalation when no coaching happens");

  const overCap = decideStuckRecovery({ enabled: true, used: 5, max: 1, escalationLevel: 1 });
  assert.equal(overCap.shouldCoach, false);
  assert.equal(overCap.nextEscalationLevel, 1, "level returned unchanged when not coaching");
});

test("decideStuckRecovery: first coaching escalates by exactly one step", () => {
  assert.deepEqual(decideStuckRecovery({ enabled: true, used: 0, max: 1, escalationLevel: 0 }), {
    shouldCoach: true,
    nextEscalationLevel: 1,
  });
  assert.deepEqual(decideStuckRecovery({ enabled: true, used: 0, max: 2, escalationLevel: 1 }), {
    shouldCoach: true,
    nextEscalationLevel: 2,
  });
});

test("decideStuckRecovery: escalation clamps at 2 and never downgrades", () => {
  // Already at the top tier — coaching still allowed, but level holds at 2.
  const atTop = decideStuckRecovery({ enabled: true, used: 0, max: 3, escalationLevel: 2 });
  assert.equal(atTop.shouldCoach, true);
  assert.equal(atTop.nextEscalationLevel, 2, "must not exceed 2");

  // Defensive: a corrupt out-of-range level is clamped, never pushed higher.
  const corrupt = decideStuckRecovery({ enabled: true, used: 0, max: 3, escalationLevel: 9 });
  assert.equal(corrupt.nextEscalationLevel, 2);

  // The result is always >= the incoming level (monotonic, no downgrade).
  for (const lvl of [0, 1, 2]) {
    const r = decideStuckRecovery({ enabled: true, used: 0, max: 5, escalationLevel: lvl });
    assert.ok(r.nextEscalationLevel >= lvl, `level ${lvl} must not downgrade`);
  }
});

test("renderCoaching: surfaces root cause, guidance, do-not-repeat and the stronger-model cue", () => {
  const out = renderCoaching(coaching());
  assert.match(out, /CRITIC-COACH FEEDBACK/);
  assert.match(out, /router kept picking the wrong specialist/);
  assert.match(out, /call the data_fetch specialist first/);
  assert.match(out, /Do NOT repeat/);
  assert.match(out, /re-running the summarizer with empty input/);
  assert.match(out, /stronger model/i);
});

test("renderCoaching: handles empty doNotRepeat + empty rootCause gracefully", () => {
  const out = renderCoaching(coaching({ rootCause: "", doNotRepeat: [] }));
  assert.match(out, /\(not identified\)/);
  assert.doesNotMatch(out, /Do NOT repeat/);
});

test("buildCoachHistoryEntry: produces a router-visible __critic_coach__ entry", () => {
  const entry = buildCoachHistoryEntry("Same output produced 3× in last 4 turns", coaching());
  assert.equal(entry.specialist, "__critic_coach__");
  assert.equal(entry.output.rootCause, "router kept picking the wrong specialist");
  assert.equal(entry.output.guidance, "call the data_fetch specialist first, then summarize");

  // The executor router serializes ctx.history into the planner prompt, so the
  // coaching reaches the next turn iff a JSON dump of history carries it.
  const history = [{ specialist: "summarizer", input: {}, output: { stuck: true } }, entry];
  const serialized = JSON.stringify(history);
  assert.match(serialized, /__critic_coach__/);
  assert.match(serialized, /call the data_fetch specialist first/);
});

test("buildCoachHistoryEntry: defaults a missing stuck reason", () => {
  const entry = buildCoachHistoryEntry(undefined, coaching());
  assert.equal(entry.input.stuckReason, "repeated non-progress output");
});

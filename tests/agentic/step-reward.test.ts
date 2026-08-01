// Tests for the pure step-reward helpers that drive Sol #6 (live degrading-
// trajectory replanning in plan-executor). Both helpers are deterministic and
// LLM-free; importing the module transitively touches the db client, so this
// file uses the process.exit pattern (pg-pool hang gotcha) like its siblings.

import {
  heuristicStepScore,
  isDegradingTrajectory,
  decideDegradingReplan,
  DEGRADING_STEP_SCORE_MAX,
} from "../../server/agentic/step-reward";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function input(over: Record<string, any> = {}) {
  return { tenantId: 1, stepIndex: 1, success: true, ...over } as any;
}

async function run() {
  // ── heuristicStepScore invariants the detector depends on ────────────────

  // 1. Hollow success (success=true, negligible output) lands ≤ DEGRADING_STEP_SCORE_MAX.
  {
    const r = heuristicStepScore(input({ output: "" }));
    assert(r.score <= DEGRADING_STEP_SCORE_MAX, `hollow success should score ≤${DEGRADING_STEP_SCORE_MAX}, got ${r.score}`);
    assert(r.signals.hollowSuccess === true, "hollow success flagged in signals");
    assert(/negligible/.test(r.rationale), "hollow-success rationale explains negligible output");
  }

  // 2. Concrete success (real output) scores > DEGRADING_STEP_SCORE_MAX (never trips the detector).
  {
    const r = heuristicStepScore(input({ output: "x".repeat(200), summary: "did the real work" }));
    assert(r.score > DEGRADING_STEP_SCORE_MAX, `concrete success should score >${DEGRADING_STEP_SCORE_MAX}, got ${r.score}`);
  }

  // 3. Even a minimal-but-non-hollow success (output ≥ 20 chars, no bonuses) floors at 45… but
  //    the detector only counts ≤50, so a plain success without hollow penalty is NOT degrading-eligible
  //    unless slow-penalty etc. drags it down — verify the plain case stays >… actually 50+20=70.
  {
    const r = heuristicStepScore(input({ output: "twenty-plus characters here" }));
    assert(r.score > DEGRADING_STEP_SCORE_MAX, `plain non-hollow success should exceed ${DEGRADING_STEP_SCORE_MAX}, got ${r.score}`);
  }

  // 4. Failure scores low and is flagged; failures are handled by the FAILURE replan
  //    path, not the degrading detector (executor only feeds successful steps in).
  {
    const r = heuristicStepScore(input({ success: false, error: "boom" }));
    assert(r.score < 45, `failure should score <45, got ${r.score}`);
    assert(r.signals.failed === true, "failure flagged in signals");
  }

  // 5. Slow hollow success stays within 0..100 bounds.
  {
    const r = heuristicStepScore(input({ output: "", durationMs: 90_000 }));
    assert(r.score >= 0 && r.score <= 100, `score clamped to 0..100, got ${r.score}`);
  }

  // ── isDegradingTrajectory ────────────────────────────────────────────────

  // 6. Fewer than two scores ⇒ never degrading.
  assert(isDegradingTrajectory([]) === false, "empty trail is not degrading");
  assert(isDegradingTrajectory([30]) === false, "single low score is not degrading");

  // 7. Two consecutive hollow-success scores ⇒ degrading.
  assert(isDegradingTrajectory([50, 45]) === true, "two trailing ≤50 scores are degrading");

  // 8. Only the LAST TWO matter — a strong recovery clears the flag.
  assert(isDegradingTrajectory([40, 40, 80]) === false, "recovery step clears degrading");
  assert(isDegradingTrajectory([80, 45, 50]) === true, "two trailing low after a strong start is degrading");

  // 9. One weak step alone doesn't trigger (needs two in a row).
  assert(isDegradingTrajectory([80, 45]) === false && isDegradingTrajectory([45, 80]) === false,
    "a single weak step surrounded by strong ones is not degrading");

  // 10. Boundary: exactly DEGRADING_STEP_SCORE_MAX counts (≤, not <).
  assert(isDegradingTrajectory([DEGRADING_STEP_SCORE_MAX, DEGRADING_STEP_SCORE_MAX]) === true,
    "boundary score counts as degrading");
  assert(isDegradingTrajectory([DEGRADING_STEP_SCORE_MAX + 1, DEGRADING_STEP_SCORE_MAX]) === false,
    "one point above the ceiling does not count");

  // 11. Wire-level invariant: a hollow-success score from the real scorer trips the
  //     detector when it happens twice — the exact pairing the executor relies on.
  {
    const s = heuristicStepScore(input({ output: "" })).score;
    assert(isDegradingTrajectory([s, s]) === true, `two real hollow-success scores (${s}) should be degrading`);
  }

  // ── decideDegradingReplan (the executor's exact trigger branch) ──────────

  const trailLow = [
    { n: 1, score: 45, rationale: "Reported success but produced negligible output for the next step" },
    { n: 2, score: 50, rationale: "Reported success but produced negligible output for the next step" },
  ];
  const baseOpts = { pendingCount: 2, degradingReplanUsed: false, replanCount: 0, maxReplans: 2 };

  // 12. Happy path: two trailing hollow scores + work remaining + bounds free ⇒ trigger.
  {
    const d = decideDegradingReplan(trailLow, baseOpts);
    assert(d.trigger === true, "degrading trail with pending work triggers replan");
    assert(d.pivotN === 1, `pivot is the WEAKER of the last two (n=1, score 45), got n=${d.pivotN}`);
    assert(!!d.issue && d.issue.includes("45/100") && d.issue.includes("50/100"),
      `issue names both scores, got: ${d.issue}`);
  }

  // 13. Tie goes to the EARLIER step (<= comparison, matches executor semantics).
  {
    const tied = trailLow.map(t => ({ ...t, score: 48 }));
    const d = decideDegradingReplan(tied, baseOpts);
    assert(d.trigger === true && d.pivotN === 1, "tied scores pivot on the earlier step");
  }

  // 14. No pending work ⇒ never triggers (nothing left to replan).
  assert(decideDegradingReplan(trailLow, { ...baseOpts, pendingCount: 0 }).trigger === false,
    "no pending work suppresses the trigger");

  // 15. Fires at most once per plan.
  assert(decideDegradingReplan(trailLow, { ...baseOpts, degradingReplanUsed: true }).trigger === false,
    "already-used degrading replan suppresses the trigger");

  // 16. Shares the global replan budget (replanCount >= maxReplans ⇒ no trigger).
  assert(decideDegradingReplan(trailLow, { ...baseOpts, replanCount: 2 }).trigger === false,
    "exhausted replan budget suppresses the trigger");

  // 17. Healthy trail ⇒ no trigger; only the LAST TWO scores matter.
  {
    const healthy = [
      { n: 1, score: 40, rationale: "weak" },
      { n: 2, score: 40, rationale: "weak" },
      { n: 3, score: 85, rationale: "Step produced concrete output advancing the objective" },
    ];
    assert(decideDegradingReplan(healthy, baseOpts).trigger === false,
      "recovery in the last step clears the trigger even after earlier weak steps");
    assert(decideDegradingReplan([healthy[2]], baseOpts).trigger === false,
      "single-entry trail never triggers");
  }

  // 18. End-to-end pairing: two real hollow-success scores from the actual scorer
  //     drive a trigger with the scorer's own rationale in the issue text.
  {
    const r = heuristicStepScore(input({ output: "" }));
    const trail = [
      { n: 7, score: r.score, rationale: r.rationale },
      { n: 8, score: r.score, rationale: r.rationale },
    ];
    const d = decideDegradingReplan(trail, baseOpts);
    assert(d.trigger === true, "real hollow-success scores trigger the replan decision");
    assert(!!d.issue && d.issue.includes("negligible"), "issue carries the scorer's rationale");
  }

  console.log(`\nstep-reward: ${passed} passed, ${failed} failed`);
  // Force exit: importing the module transitively instantiates a pg pool handle
  // that otherwise keeps the process alive (node:test pg-pool hang gotcha).
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });

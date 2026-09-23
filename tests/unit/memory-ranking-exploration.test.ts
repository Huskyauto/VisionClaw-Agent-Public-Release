/**
 * Stage 1 SA-CTS cold-start exploration — unit coverage.
 *
 * Originally jury FIX 2026-06-28 (exploration shipped off-by-default). Bob
 * 2026-06-28 follow-up: exploration now runs ON by default (benefit of the
 * doubt) with an auto-switch circuit breaker that disables it on misbehaviour
 * (jury adjudicates whether the auto-off was valid). This file covers both.
 *
 * Query-free by design (no db.execute) so it never holds the pg pool open and
 * exits clean under run.sh (see memory: node-test-db-pool-hang).
 *
 * Asserts:
 *   1. `bonus` mode lifts a brand-new (0-impression) memory above an
 *      equal-semantic but proven memory — the cold-start lockout is broken.
 *   2. The bonus self-decays to 0 once a memory crosses the impression
 *      threshold (proven memories compete on merit).
 *   3. Bonus respects confidence (an unproven LOW-confidence fact is not
 *      blindly boosted over a proven HIGH-confidence one).
 *   4. Config parsing defaults ON; only explicit off-synonyms disable.
 *   5. Circuit breaker: faults trip it, a tripped breaker forces effective
 *      mode OFF, and reset / confirm transitions behave correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankMemories,
  explorationBonus,
  getExplorationConfigFromEnv,
  DEFAULT_EXPLORATION_CONFIG,
  effectiveExplorationConfig,
  noteExplorationFault,
  tripExplorationCircuit,
  resetExplorationCircuit,
  confirmExplorationCircuitOff,
  getExplorationCircuitState,
  __setExplorationCircuitForTest,
  type ExplorationConfig,
} from "../../server/memory-ranking";

// Disable fs persistence and start from a clean (not-tripped) breaker so the
// rankMemories tests below are deterministic regardless of any on-disk state.
__setExplorationCircuitForTest(false);

const OFF: ExplorationConfig = { mode: "off", bonusWeight: 0.1, impressionThreshold: 5 };
const BONUS: ExplorationConfig = { mode: "bonus", bonusWeight: 0.1, impressionThreshold: 5 };

function mem(id: number, fact: string, accessCount: number, extra: Record<string, any> = {}) {
  // No embedding ⇒ keyword path; keep facts distinct so MMR doesn't collapse.
  return { id, fact, category: "test", accessCount, lastAccessed: new Date(), ...extra };
}

test("explorationBonus: off ⇒ always 0", () => {
  assert.equal(explorationBonus(0, OFF), 0);
  assert.equal(explorationBonus(3, OFF), 0);
});

test("explorationBonus: full weight at 0 impressions, decays to 0 at threshold", () => {
  assert.equal(explorationBonus(0, BONUS), 0.1);
  assert.ok(Math.abs(explorationBonus(1, BONUS) - 0.08) < 1e-9);
  assert.equal(explorationBonus(5, BONUS), 0); // proven
  assert.equal(explorationBonus(10, BONUS), 0);
});

test("explorationBonus: deterministic (same inputs ⇒ same output)", () => {
  assert.equal(explorationBonus(2, BONUS), explorationBonus(2, BONUS));
});

test("default ranking is unchanged when exploration is explicitly off", () => {
  const memories = [mem(1, "alpha proven fact", 10), mem(2, "beta brand new fact", 0)];
  const ranked = rankMemories(memories, null, "alpha proven fact", { exploration: OFF });
  // The proven memory that matches the query stays on top; new memory does not jump it.
  assert.equal(ranked[0].id, 1);
});

test("bonus raises a fresh memory's score by the expected (conf-respecting) delta", () => {
  // accessCount also drives importance + frequency, so two same-text memories
  // do NOT tie in legacy scoring — the cold-start lockout is exactly that gap.
  // What the bonus must do: lift the FRESH memory's own score by ~bonusWeight
  // (times conf*qual, both 1.0 here), deterministically.
  const fresh = mem(2, "identical content here", 0);
  const off = rankMemories([fresh], null, "identical content here", {
    exploration: OFF,
    mmr: { enabled: false, lambda: 0.7 },
  });
  const on = rankMemories([fresh], null, "identical content here", {
    exploration: BONUS,
    mmr: { enabled: false, lambda: 0.7 },
  });
  const delta = on[0]._score - off[0]._score;
  assert.ok(Math.abs(delta - 0.1) < 1e-9, `expected +0.1 lift, got ${delta}`);
});

test("bonus breaks the cold-start lockout within the unproven cohort", () => {
  // Realistic cold-start: a brand-new (0-impression) memory vs a lightly-used
  // (2-impression, still below the proven threshold) one of identical semantics.
  // Legacy: the lightly-used one wins on frequency. With the bonus the fresh one
  // gets its chance to enter top-k.
  const lightlyUsed = mem(1, "identical content here", 2);
  const fresh = mem(2, "identical content here", 0);

  const off = rankMemories([lightlyUsed, fresh], null, "identical content here", {
    exploration: OFF,
    mmr: { enabled: false, lambda: 0.7 },
  });
  assert.equal(off[0].id, 1, "legacy: lightly-used outranks fresh (cold-start lockout)");

  const on = rankMemories([lightlyUsed, fresh], null, "identical content here", {
    exploration: BONUS,
    mmr: { enabled: false, lambda: 0.7 },
  });
  assert.equal(on[0].id, 2, "bonus: fresh memory breaks into the top slot");
});

test("default ON (no exploration option) breaks the cold-start lockout", () => {
  // Bob 2026-06-28: exploration is now the default. With no explicit config and
  // env unset, rankMemories should behave like BONUS, not OFF.
  __setExplorationCircuitForTest(false);
  const save = process.env.MEMORY_EXPLORATION_MODE;
  try {
    delete process.env.MEMORY_EXPLORATION_MODE;
    const lightlyUsed = mem(1, "identical content here", 2);
    const fresh = mem(2, "identical content here", 0);
    const ranked = rankMemories([lightlyUsed, fresh], null, "identical content here", {
      mmr: { enabled: false, lambda: 0.7 },
    });
    assert.equal(ranked[0].id, 2, "default-on: fresh memory breaks into the top slot");
  } finally {
    if (save === undefined) delete process.env.MEMORY_EXPLORATION_MODE;
    else process.env.MEMORY_EXPLORATION_MODE = save;
  }
});

test("bonus respects confidence — unproven low-confidence does NOT beat proven high-confidence", () => {
  const provenHiConf = mem(1, "identical content here", 10, { confidence: 1.0 });
  const freshLoConf = mem(2, "identical content here", 0, { confidence: 0.2 });
  const ranked = rankMemories([provenHiConf, freshLoConf], null, "identical content here", {
    exploration: BONUS,
    mmr: { enabled: false, lambda: 0.7 },
  });
  // (additive + 0.1) * 0.2  <  additive * 1.0  for additive in the normal range.
  assert.equal(ranked[0].id, 1);
});

test("cts mode degrades to bonus-equivalent scoring (Stage 2 reserved)", () => {
  const CTS: ExplorationConfig = { mode: "cts", bonusWeight: 0.1, impressionThreshold: 5 };
  // cts is not yet implemented → must score identically to bonus, not off.
  assert.equal(explorationBonus(0, CTS), explorationBonus(0, BONUS));
  assert.equal(explorationBonus(3, CTS), explorationBonus(3, BONUS));
  assert.notEqual(explorationBonus(0, CTS), explorationBonus(0, OFF));
});

test("env config defaults ON; only explicit off-synonyms disable", () => {
  const save = { ...process.env };
  try {
    // Unset ⇒ default ON (bonus), with default numeric knobs.
    delete process.env.MEMORY_EXPLORATION_MODE;
    assert.equal(getExplorationConfigFromEnv().mode, "bonus");
    assert.equal(getExplorationConfigFromEnv().bonusWeight, DEFAULT_EXPLORATION_CONFIG.bonusWeight);

    // Garbage / typo ⇒ benefit of the doubt ⇒ bonus (NOT off).
    process.env.MEMORY_EXPLORATION_MODE = "nonsense";
    assert.equal(getExplorationConfigFromEnv().mode, "bonus");

    // Explicit off-synonyms ⇒ off.
    for (const v of ["off", "false", "0", "no", "disable", "disabled", "OFF", " Off "]) {
      process.env.MEMORY_EXPLORATION_MODE = v;
      assert.equal(getExplorationConfigFromEnv().mode, "off", `"${v}" should disable`);
    }

    process.env.MEMORY_EXPLORATION_MODE = "BONUS";
    assert.equal(getExplorationConfigFromEnv().mode, "bonus");

    process.env.MEMORY_EXPLORATION_MODE = "cts";
    assert.equal(getExplorationConfigFromEnv().mode, "cts");

    // Numeric knobs still fail safe to defaults on out-of-range / invalid.
    process.env.MEMORY_EXPLORATION_BONUS_WEIGHT = "5"; // out of [0,1]
    assert.equal(getExplorationConfigFromEnv().bonusWeight, DEFAULT_EXPLORATION_CONFIG.bonusWeight);
    process.env.MEMORY_EXPLORATION_BONUS_WEIGHT = "0.25";
    assert.equal(getExplorationConfigFromEnv().bonusWeight, 0.25);

    process.env.MEMORY_EXPLORATION_IMPRESSION_THRESHOLD = "0"; // invalid
    assert.equal(getExplorationConfigFromEnv().impressionThreshold, DEFAULT_EXPLORATION_CONFIG.impressionThreshold);
    process.env.MEMORY_EXPLORATION_IMPRESSION_THRESHOLD = "8";
    assert.equal(getExplorationConfigFromEnv().impressionThreshold, 8);
  } finally {
    process.env = save;
  }
});

// ---------------------------------------------------------------------------
// Circuit breaker (the auto-switch).
// ---------------------------------------------------------------------------

test("circuit: clean state ⇒ not tripped, effective config passes through", () => {
  __setExplorationCircuitForTest(false);
  assert.equal(getExplorationCircuitState().tripped, false);
  assert.equal(getExplorationCircuitState().status, "ok");
  assert.equal(effectiveExplorationConfig(BONUS).mode, "bonus");
});

test("circuit: faults below threshold do NOT trip", () => {
  __setExplorationCircuitForTest(false);
  for (let i = 0; i < 4; i++) noteExplorationFault(`fault ${i}`);
  assert.equal(getExplorationCircuitState().tripped, false);
  assert.equal(effectiveExplorationConfig(BONUS).mode, "bonus");
});

test("circuit: faults at threshold trip the breaker and force effective mode OFF", () => {
  __setExplorationCircuitForTest(false);
  for (let i = 0; i < 5; i++) noteExplorationFault(`fault ${i}`);
  const state = getExplorationCircuitState();
  assert.equal(state.tripped, true);
  assert.equal(state.status, "tripped-pending-review");
  assert.ok(state.trippedAt, "trippedAt timestamp set");
  // The breaker is a one-way override: even an explicit BONUS request is off.
  assert.equal(effectiveExplorationConfig(BONUS).mode, "off");
});

test("circuit: a tripped breaker makes rankMemories behave like OFF", () => {
  __setExplorationCircuitForTest(false);
  tripExplorationCircuit("manual trip for test");
  const lightlyUsed = mem(1, "identical content here", 2);
  const fresh = mem(2, "identical content here", 0);
  const ranked = rankMemories([lightlyUsed, fresh], null, "identical content here", {
    exploration: BONUS, // requested ON, but breaker vetoes it
    mmr: { enabled: false, lambda: 0.7 },
  });
  assert.equal(ranked[0].id, 1, "tripped breaker ⇒ legacy scoring (no cold-start lift)");
});

test("circuit: reset (jury REJECT / false alarm) re-enables exploration", () => {
  __setExplorationCircuitForTest(false);
  tripExplorationCircuit("trip");
  assert.equal(getExplorationCircuitState().tripped, true);
  resetExplorationCircuit("jury REJECT — false alarm");
  const state = getExplorationCircuitState();
  assert.equal(state.tripped, false);
  assert.equal(state.status, "cleared-by-jury");
  assert.equal(effectiveExplorationConfig(BONUS).mode, "bonus");
});

test("circuit: confirm-off (jury ACCEPT) keeps exploration durably off", () => {
  __setExplorationCircuitForTest(false);
  tripExplorationCircuit("trip");
  confirmExplorationCircuitOff("jury ACCEPT — disabling was valid");
  const state = getExplorationCircuitState();
  assert.equal(state.tripped, true);
  assert.equal(state.status, "confirmed-off");
  assert.equal(effectiveExplorationConfig(BONUS).mode, "off");
});

test("circuit: double-trip keeps the original reason/timestamp", () => {
  __setExplorationCircuitForTest(false);
  tripExplorationCircuit("first reason");
  const first = getExplorationCircuitState();
  tripExplorationCircuit("second reason");
  const second = getExplorationCircuitState();
  assert.equal(second.reason, first.reason);
  assert.equal(second.trippedAt, first.trippedAt);
});

// Leave the module-global breaker clean for any later-loaded test file.
__setExplorationCircuitForTest(false);

// ---------------------------------------------------------------------------
// Jury-review script: pure verdict parsing + exit-code mapping (regression).
// Importing the script must NOT run main() (guarded by isMainModule).
// ---------------------------------------------------------------------------
test("parseJuryVerdict extracts the verdict token from jury stdout", async () => {
  const { parseJuryVerdict } = await import("../../scripts/exploration-circuit-review");
  assert.equal(parseJuryVerdict("Verdict: ACCEPT (majority 3/3)"), "ACCEPT");
  assert.equal(parseJuryVerdict("noise\nVerdict: REJECT (majority 2/3)\nmore"), "REJECT");
  assert.equal(parseJuryVerdict("Verdict: FIX"), "FIX");
  assert.equal(parseJuryVerdict("Verdict: ESCALATE (no majority)"), "ESCALATE");
  assert.equal(parseJuryVerdict("no verdict line here"), null);
  assert.equal(parseJuryVerdict(""), null);
});

test("exitCodeForVerdict maps verdicts to script exit codes", async () => {
  const { exitCodeForVerdict } = await import("../../scripts/exploration-circuit-review");
  assert.equal(exitCodeForVerdict("ACCEPT"), 0);
  assert.equal(exitCodeForVerdict("REJECT"), 0);
  assert.equal(exitCodeForVerdict(null), 3);
  assert.equal(exitCodeForVerdict("FIX"), 5);
  assert.equal(exitCodeForVerdict("ESCALATE"), 5);
});

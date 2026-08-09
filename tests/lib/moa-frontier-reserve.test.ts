/**
 * R125+137.26 — FRONTIER_RESERVE (Kimi-K3) backfill gate unit tests.
 *
 * Bob 2026-07-16: "add Kimi-K3 as a frontier but only as an extra if we need
 * it." The reserve is NOT part of the standing jury — it may fire ONLY as a
 * backfill when a main-round FRONTIER proposer fails, on the metered path.
 * These tests pin the pure gate (`shouldFireFrontierReserve`) so the reserve
 * can never silently leak into cheap/mixed/polarity pools, explicit proposer
 * sets, the metered-off path, or the total-failure escalate path.
 *
 * No LLM calls, no DB — pure predicate verification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFireFrontierReserve, FRONTIER_RESERVE } from "../../server/moa";

const FRONTIER_IDS = ["claude-opus-4-8", "gpt-5.6-sol", "gemini-3.5-flash", "deepseek/deepseek-v4-pro"];

function base() {
  return {
    useMetered: true,
    poolChoice: undefined as any,
    explicitProposerIds: false,
    successCount: 3,
    specCount: 4,
    proposerIds: [...FRONTIER_IDS],
  };
}

test("reserve id is kimi-k3 (single-entry reserve)", () => {
  assert.deepEqual(FRONTIER_RESERVE, ["moonshotai/kimi-k3"]);
});

test("fires on default (frontier) run with one failed proposer, metered on", () => {
  assert.equal(shouldFireFrontierReserve(base()), true);
});

test("fires on explicit pool='frontier'", () => {
  assert.equal(shouldFireFrontierReserve({ ...base(), poolChoice: "frontier" }), true);
});

test("NEVER fires when metered is off ($0 policy would swap it to modelfarm)", () => {
  assert.equal(shouldFireFrontierReserve({ ...base(), useMetered: false }), false);
});

test("NEVER fires for cheap/mixed/polarity pools", () => {
  for (const pool of ["cheap", "mixed", "polarity"] as const) {
    assert.equal(shouldFireFrontierReserve({ ...base(), poolChoice: pool }), false, `pool=${pool}`);
  }
});

test("NEVER fires for caller-explicit proposer sets", () => {
  assert.equal(shouldFireFrontierReserve({ ...base(), explicitProposerIds: true }), false);
});

test("NEVER fires on total failure (that is the escalate path)", () => {
  assert.equal(shouldFireFrontierReserve({ ...base(), successCount: 0 }), false);
});

test("does not fire when all proposers succeeded", () => {
  assert.equal(shouldFireFrontierReserve({ ...base(), successCount: 4 }), false);
});

test("does not fire when the reserve id is already a proposer", () => {
  assert.equal(
    shouldFireFrontierReserve({ ...base(), proposerIds: [...FRONTIER_IDS, "moonshotai/kimi-k3"] }),
    false,
  );
});

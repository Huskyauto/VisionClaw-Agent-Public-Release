/**
 * tests/unit/last-resort-model.test.ts
 *
 * LAST-RESORT super-expert escalation guard (Bob 2026-07-01): claude-fable-5
 * is METERED (caused 3× ~$20/day when defaulted 2026-06-11) and must NEVER be
 * reachable via generic routing. The ONLY sanctioned path is
 * resilientChatCompletion's terminal rung, which claims a bounded daily slot
 * BEFORE spending. This suite proves:
 *   1. findFallbackModel never returns the last-resort model from any generic
 *      failover pool (even when it is the only same-tier candidate).
 *   2. claimLastResortSlot enforces the daily cap (claim-before-spend) and the
 *      LAST_RESORT_MODEL_ENABLED kill-switch.
 *   3. The last-resort model is absent from the generic tierModels ladders.
 *
 * Run: node --import tsx --test tests/unit/last-resort-model.test.ts
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { findFallbackModel } from "../../server/model-failover";
import {
  LAST_RESORT_MODEL,
  claimLastResortSlot,
  lastResortEnabled,
} from "../../server/providers";
import { readFileSync } from "node:fs";

// Providers chain holds open handles (timers); force clean exit like the
// sibling resilient/dispatch suites.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// --- 1. generic failover pool exclusion ---------------------------------
test("findFallbackModel NEVER returns the last-resort model, even as sole same-tier candidate", () => {
  const pool = [
    { id: LAST_RESORT_MODEL, provider: "anthropic", tier: "powerful" },
  ] as any;
  const fb = findFallbackModel("claude-opus-4-8", pool);
  assert.equal(fb, null, "last-resort model must be filtered from generic failover candidates");
});

test("findFallbackModel still returns a normal candidate when one exists alongside the last-resort model", () => {
  const pool = [
    { id: LAST_RESORT_MODEL, provider: "anthropic", tier: "powerful" },
    { id: "gpt-4.1", provider: "openai", tier: "powerful" },
  ] as any;
  const fb = findFallbackModel("claude-opus-4-8", pool);
  assert.equal(fb?.id, "gpt-4.1");
});

// --- 2. daily-cap claim (claim-before-spend) ----------------------------
test("claimLastResortSlot enforces LAST_RESORT_DAILY_MAX and the enabled kill-switch", () => {
  const prevMax = process.env.LAST_RESORT_DAILY_MAX;
  const prevEnabled = process.env.LAST_RESORT_MODEL_ENABLED;
  try {
    process.env.LAST_RESORT_MODEL_ENABLED = "false";
    assert.equal(lastResortEnabled(), false);
    assert.equal(claimLastResortSlot("test"), false, "disabled lane must never claim");

    process.env.LAST_RESORT_MODEL_ENABLED = "true";
    process.env.LAST_RESORT_DAILY_MAX = "2";
    assert.equal(lastResortEnabled(), true);
    // Process-local counter starts fresh in this test process.
    assert.equal(claimLastResortSlot("test"), true, "claim 1/2");
    assert.equal(claimLastResortSlot("test"), true, "claim 2/2");
    assert.equal(claimLastResortSlot("test"), false, "cap hit — 3rd claim must be refused");
  } finally {
    if (prevMax === undefined) delete process.env.LAST_RESORT_DAILY_MAX; else process.env.LAST_RESORT_DAILY_MAX = prevMax;
    if (prevEnabled === undefined) delete process.env.LAST_RESORT_MODEL_ENABLED; else process.env.LAST_RESORT_MODEL_ENABLED = prevEnabled;
  }
});

// --- 3. static: not in generic tier ladders ------------------------------
test("last-resort model does not appear in the tierModels ladders (static source check)", () => {
  const src = readFileSync("server/providers.ts", "utf8");
  const ladderStart = src.indexOf("const tierModels");
  assert.ok(ladderStart > 0, "tierModels declaration found");
  // Bound the scan to the ladder object (ends at the next top-level export after it).
  const ladderEnd = src.indexOf("\nexport ", ladderStart);
  const ladderBlock = src.slice(ladderStart, ladderEnd > ladderStart ? ladderEnd : undefined);
  assert.ok(
    !ladderBlock.includes(LAST_RESORT_MODEL),
    `tierModels must not contain ${LAST_RESORT_MODEL} — it would become an availability default`,
  );
});
